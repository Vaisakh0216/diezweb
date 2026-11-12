import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { connectDb, col, insert, now, strip } from './db.js';
import * as T from './terms.js';
import registerCaseRoutes from './cases.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = process.env.PORT || 4000;
const SECRET = process.env.JWT_SECRET || 'edd-dev-secret-change-me';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

// async route handlers: send errors to the error handler instead of leaving the request hanging
for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
  const orig = app[m].bind(app);
  app[m] = (path, ...handlers) => (handlers.length ? orig(path, ...handlers.map((h) => (typeof h === 'function' && h.length < 4
    ? (req, res, next) => { try { const r = h(req, res, next); if (r?.catch) r.catch(next); } catch (e) { next(e); } }
    : h))) : orig(path));
}

/* ================= helpers ================= */
// stored values are real arrays/objects in MongoDB (JSON text in data from older exports)
const J = (s, d = []) => { if (s == null) return d; if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch { return d; } };
const publicUser = (u) => u && ({
  id: u.id, name: u.name, email: u.email, role: u.role, title: u.title,
  duties: J(u.duties), bus: J(u.bus), aliases: u.aliases || '', status: u.status, created_at: u.created_at,
  escalation_manager: !!u.escalation_manager,
});
// only admins can receive escalations
const escFlag = (b) => (b.role === 'admin' && b.escalation_manager ? 1 : 0);
const getUser = async (id) => publicUser(await col('users').findOne({ id }));
const usersById = async () => Object.fromEntries((await col('users').find().toArray()).map((u) => [u.id, u]));
const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

async function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    const { id } = jwt.verify(token, SECRET);
    req.user = await getUser(id);
    if (!req.user) throw new Error();
  } catch { return res.status(401).json({ error: 'Unauthorized' }); }
  next();
}
const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' }));
const logEvent = (case_id, type, detail, by_user, from_user = null, to_user = null) =>
  insert('case_events', { case_id, type, detail: detail ?? null, from_user, to_user, by_user: by_user ?? null, at: now() });

/* ---------- dates ---------- */
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function toISODate(v, order = 'MDY') {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return fmt(new Date(v.getTime() + 12 * 3600e3)); // guard TZ drift
  if (typeof v === 'number') { const p = XLSX.SSF.parse_date_code(v); return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : null; }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let [a, b] = [+m[1], +m[2]];
    let [mo, d] = order === 'DMY' ? [b, a] : [a, b];
    if (mo > 12 && d <= 12) [mo, d] = [d, mo]; // auto-correct impossible month
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  const d = new Date(s);
  return isNaN(d) ? null : fmt(d);
}

/* ---------- file parsing & template detection ---------- */
const hnorm = (s) => String(s ?? '').toLowerCase().replace(/sorted\s+(ascending|descending)/i, '').replace(/[^a-z0-9#]/g, '');
const cleanHeader = hnorm;

function parseFile(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  for (const sheetName of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: true, blankrows: false });
    // locate header row: first row containing all detect columns of some template
    for (let r = 0; r < Math.min(grid.length, 40); r++) {
      const cells = grid[r].map(cleanHeader);
      for (const [system, tpl] of Object.entries(T.TEMPLATES)) {
        if (tpl.detect.every((h) => cells.includes(hnorm(h)))) {
          const headers = grid[r].map((h) => String(h ?? '').replace(/sorted\s+(ascending|descending)/i, '').trim());
          const idx = {};
          for (const [field, names] of Object.entries(tpl.cols)) {
            const i = names.map((n) => cells.indexOf(hnorm(n))).find((x) => x >= 0);
            idx[field] = i ?? -1;
          }
          const rows = [];
          for (let k = r + 1; k < grid.length; k++) {
            const line = grid[k];
            const reqNo = String(line[idx.request_no] ?? '').trim();
            if (!reqNo) continue; // blank / footer rows
            const raw = {};
            headers.forEach((h, i) => { if (h) raw[h] = line[i] instanceof Date ? fmt(line[i]) : line[i]; });
            const get = (f) => (idx[f] >= 0 ? line[idx[f]] : '');
            rows.push({ get, raw, reqNo });
          }
          return { system, tpl, headers: headers.filter(Boolean), rows };
        }
      }
    }
  }
  throw new Error('Unrecognised file. Expected a DSO, DAFZ or DCC Salesforce export.');
}

function normaliseRow(system, tpl, row, defaultBu) {
  const g = row.get;
  const recordType = String(g('record_type') ?? '').trim();
  const owner = system === 'DSO'
    ? `${String(g('owner_first') ?? '').trim()} ${String(g('owner_last') ?? '').trim()}`.trim()
    : String(g('owner') ?? '').trim();
  let bu = system;
  if (system === 'DSO') bu = /^IFZA[_ ]/i.test(recordType) ? 'IFZA' : defaultBu;
  const stepStatus = String(g('step_status') ?? '').trim();
  return {
    request_no: row.reqNo,
    company: String(g('company') ?? '').trim(),
    created_date: toISODate(g('created'), tpl.dateOrder),
    record_type: recordType,
    app_type: T.mapAppType(system, recordType),
    owner_name: owner,
    bu,
    completed: system !== 'DSO' && /^completed$/i.test(stepStatus),
    closed_date: tpl.cols.closed ? toISODate(String(g('closed') ?? '').split(',')[0], 'DMY') : null,
    data: row.raw,
  };
}

/* ---------- assignment ---------- */
const simplify = (s) => T.norm(s).replace(/(.)\1+/g, '$1'); // "Matthew" ~ "Mathew"
function findOwner(users, ownerName) {
  if (!ownerName) return null;
  const full = simplify(ownerName);
  const first = simplify(ownerName.split(/\s+/)[0]);
  return users.find((u) => u.aliases.split(',').map(simplify).filter(Boolean).includes(full))
    || users.find((u) => simplify(u.name) === full)
    || users.find((u) => u.role === 'user' && simplify(u.name.split(/\s+/)[0]) === first)
    || null;
}

/** open (work queue) applications per officer */
async function openLoad() {
  const rows = await col('edd_cases').aggregate([{ $match: { edd_status: null } }, { $group: { _id: '$assigned_to', c: { $sum: 1 } } }]).toArray();
  return Object.fromEntries(rows.map((r) => [r._id, r.c]));
}

/* ================= auth & meta ================= */
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const u = await col('users').findOne({ email: String(email || '').toLowerCase().trim() });
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  res.json({ token: jwt.sign({ id: u.id }, SECRET, { expiresIn: '12h' }), user: publicUser(u) });
});
app.get('/api/auth/me', auth, (req, res) => res.json(req.user));
app.get('/api/meta', (req, res) => res.json({
  bus: T.BUS, dsoGroup: T.DSO_GROUP, eddStatuses: T.EDD_STATUSES, riskRatings: T.RISK_RATINGS, rootCauses: T.ROOT_CAUSES,
  titles: T.TITLES, appTypes: T.APP_TYPES, dsoTerms: T.DSO_TERMS, dafzDccTerms: T.DAFZ_DCC_TERMS, glossary: T.GLOSSARY,
  modules: T.MODULES, caseStatuses: T.CASE_STATUSES, alertCategories: T.ALERT_CATEGORIES,
  nfaSlug: T.NFA_SLUG, trueMatch: T.TRUE_MATCH, pendingStatuses: T.PENDING_STATUSES, decisionStatuses: T.DECISION_STATUSES, nextStatuses: T.NEXT_STATUSES,
  escalate: T.ESCALATE, possible: T.POSSIBLE, hmSlug: T.HM_SLUG, inspectionEmail: T.INSPECTION_TEAM_EMAIL,
  investigatorRecs: T.INVESTIGATOR_RECS, managerRecs: T.MANAGER_RECS, others: T.OTHERS, agreed: T.AGREED,
}));

/* ================= users ================= */
app.get('/api/users', auth, async (req, res) => {
  const counts = await openLoad();
  const users = await col('users').find().sort({ role: 1, name: 1 }).toArray();
  res.json(users.map(publicUser).map((u) => ({ ...u, open_cases: counts[u.id] || 0 })));
});

function validateUser(b, isNew) {
  if (!b.name?.trim()) return 'Name is required';
  if (!/^\S+@\S+\.\S+$/.test(b.email || '')) return 'Valid email is required';
  if (isNew && (!b.password || b.password.length < 6)) return 'Password must be at least 6 characters';
  if (!['admin', 'user'].includes(b.role)) return 'Invalid role';
  if (b.title && !T.TITLES.includes(b.title)) return 'Invalid title';
  if (!Array.isArray(b.duties) || b.duties.some((d) => !T.APP_TYPES.includes(d))) return 'Invalid duties';
  if (!Array.isArray(b.bus) || b.bus.some((d) => !T.BUS.includes(d))) return 'Invalid business units';
  if (b.status && !['active', 'on_leave'].includes(b.status)) return 'Invalid status';
  return null;
}
const dupErr = (e) => (e.code === 11000 ? 'Email already exists' : e.message);

app.post('/api/users', auth, adminOnly, async (req, res) => {
  const b = req.body; const err = validateUser(b, true);
  if (err) return res.status(400).json({ error: err });
  try {
    const id = await insert('users', {
      name: b.name.trim(), email: b.email.toLowerCase().trim(), password_hash: bcrypt.hashSync(b.password, 10), role: b.role, title: b.title || null,
      duties: b.duties, bus: b.bus, aliases: b.aliases || '', status: b.status || 'active', created_at: now(), escalation_manager: escFlag(b),
    });
    res.status(201).json(await getUser(id));
  } catch (e) { res.status(400).json({ error: dupErr(e) }); }
});

app.put('/api/users/:id', auth, adminOnly, async (req, res) => {
  const b = req.body; const err = validateUser(b, false);
  if (err) return res.status(400).json({ error: err });
  const id = +req.params.id;
  try {
    const set = { name: b.name.trim(), email: b.email.toLowerCase().trim(), role: b.role, title: b.title || null, duties: b.duties, bus: b.bus,
      aliases: b.aliases || '', status: b.status || 'active', escalation_manager: escFlag(b) };
    if (b.password) set.password_hash = bcrypt.hashSync(b.password, 10);
    await col('users').updateOne({ id }, { $set: set });
    res.json(await getUser(id));
  } catch (e) { res.status(400).json({ error: dupErr(e) }); }
});

app.delete('/api/users/:id', auth, adminOnly, async (req, res) => {
  const id = +req.params.id;
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself' });
  const open = await col('edd_cases').countDocuments({ assigned_to: id, edd_status: { $ne: 'Approved' } });
  if (open) return res.status(400).json({ error: `User has ${open} open case(s). Transfer them first.` });
  await col('edd_cases').updateMany({ assigned_to: id }, { $set: { assigned_to: null } });
  for (const f of ['assigned_to', 'escalated_to', 'created_by']) await col('screening_cases').updateMany({ [f]: id }, { $set: { [f]: null } });
  await col('users').deleteOne({ id });
  res.json({ ok: true });
});

/* ================= EDD upload ================= */
app.post('/api/edd/preview', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const { system, tpl, headers, rows } = parseFile(req.file.buffer);
    const sample = rows.slice(0, 5).map((r) => normaliseRow(system, tpl, r, 'DSO'));
    const needsBu = system === 'DSO' && rows.some((r) => !/^IFZA[_ ]/i.test(String(r.get('record_type'))));
    const dates = rows.map((r) => toISODate(r.get('created'), tpl.dateOrder)).filter(Boolean).sort();
    res.json({ system, headers, total: rows.length, sample, needsBu, minDate: dates[0], maxDate: dates.at(-1) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/edd/upload', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { dateFrom, dateTo, defaultBu = 'DSO' } = req.body;
  if (!dateFrom || !dateTo) return res.status(400).json({ error: 'Date range is required' });
  if (dateFrom > dateTo) return res.status(400).json({ error: 'From date must be before To date' });
  if (!T.DSO_GROUP.includes(defaultBu)) return res.status(400).json({ error: 'Invalid default BU' });

  let parsed;
  try { parsed = parseFile(req.file.buffer); } catch (e) { return res.status(400).json({ error: e.message }); }
  const { system, tpl, rows } = parsed;

  const users = (await col('users').find().toArray()).map(publicUser);
  const active = users.filter((u) => u.status === 'active');
  const load = await openLoad();
  const isAdmin = req.user.role === 'admin';

  const pickAssignee = (r) => {
    const owner = findOwner(users, r.owner_name);
    if (owner && owner.status === 'active') return owner;
    const pool = active.filter((u) => u.role === 'user' && u.duties.includes(r.app_type) && u.bus.includes(r.bu));
    if (!pool.length) return null;
    pool.sort((a, b) => (load[a.id] || 0) - (load[b.id] || 0));
    load[pool[0].id] = (load[pool[0].id] || 0) + 1;
    return pool[0];
  };

  const S = { system, total: rows.length, outOfRange: 0, noDate: 0, unmapped: 0, unmappedTypes: {}, dupInFile: 0, notYours: 0,
    newCases: 0, resubmitted: 0, history: 0, alreadyOpen: 0, alreadyApproved: 0, unassigned: 0, perUser: {} };
  const seen = new Set();

  const uploadId = await insert('uploads', { filename: req.file.originalname, system, uploaded_by: req.user.id, date_from: dateFrom, date_to: dateTo,
    stats: null, created_at: now() });

  for (const raw of rows) {
    const r = normaliseRow(system, tpl, raw, defaultBu);
    if (!r.created_date) { S.noDate++; continue; }
    if (r.created_date < dateFrom || r.created_date > dateTo) { S.outOfRange++; continue; }
    if (!r.app_type) { S.unmapped++; S.unmappedTypes[r.record_type || '(blank)'] = (S.unmappedTypes[r.record_type || '(blank)'] || 0) + 1; continue; }
    const key = `${r.bu}|${r.request_no}`;
    if (seen.has(key)) { S.dupInFile++; continue; }
    seen.add(key);

    const existing = await col('edd_cases').findOne({ bu: r.bu, request_no: r.request_no });
    if (existing) {
      if (existing.edd_status === 'Approved') { S.alreadyApproved++; continue; }
      if (r.completed) { // closed in Salesforce -> history
        await col('edd_cases').updateOne({ id: existing.id }, { $set: { edd_status: 'Approved', is_history: 1, closed_date: r.closed_date, status_at: now(), updated_at: now() } });
        await logEvent(existing.id, 'history', 'Marked completed by Salesforce export', req.user.id);
        S.history++; continue;
      }
      if (existing.edd_status == null) { S.alreadyOpen++; continue; }
      if (!isAdmin && existing.assigned_to !== req.user.id) { S.notYours++; continue; }
      // Requested / Returned -> client has submitted the form: back to work queue
      await col('edd_cases').updateOne({ id: existing.id }, { $set: { edd_status: null, resubmitted_at: now(), updated_at: now(), data: r.data },
        $inc: { resubmission_count: 1 } });
      await logEvent(existing.id, 'resubmitted', `Previously "${existing.edd_status}"`, req.user.id);
      S.resubmitted++;
      const who = users.find((u) => u.id === existing.assigned_to);
      if (who) S.perUser[who.name] = (S.perUser[who.name] || 0) + 1;
      continue;
    }

    // New case
    let assignee = r.completed ? findOwner(users, r.owner_name) : pickAssignee(r);
    if (!isAdmin && !r.completed) {
      if (!(assignee?.id === req.user.id || (req.user.duties.includes(r.app_type) && req.user.bus.includes(r.bu)))) { S.notYours++; continue; }
      assignee = req.user;
    }
    const id = await insert('edd_cases', {
      upload_id: uploadId, system, bu: r.bu, request_no: r.request_no, company: r.company, created_date: r.created_date,
      record_type: r.record_type, app_type: r.app_type, owner_name: r.owner_name, assigned_to: assignee?.id ?? null,
      risk_rating: null, root_causes: [], edd_status: r.completed ? 'Approved' : null, status_at: r.completed ? new Date().toISOString() : null,
      resubmission_count: 0, resubmitted_at: null, is_history: r.completed ? 1 : 0, closed_date: r.closed_date, data: r.data,
      created_at: now(), updated_at: now(),
    });
    await logEvent(id, r.completed ? 'history' : 'created', r.completed ? 'Imported as completed (history)' : `Imported from ${system}`, req.user.id, null, assignee?.id ?? null);
    if (r.completed) { S.history++; continue; }
    S.newCases++;
    if (assignee) S.perUser[assignee.name] = (S.perUser[assignee.name] || 0) + 1; else S.unassigned++;
  }
  await col('uploads').updateOne({ id: uploadId }, { $set: { stats: S } });
  res.json(S);
});

app.get('/api/edd/uploads', auth, async (req, res) => {
  const filter = req.user.role === 'admin' ? {} : { uploaded_by: req.user.id };
  const [ups, U] = await Promise.all([col('uploads').find(filter).sort({ id: -1 }).limit(30).toArray(), usersById()]);
  res.json(ups.map((u) => ({ ...strip(u), uploaded_by_name: U[u.uploaded_by]?.name ?? null, stats: J(u.stats, {}) })));
});

/* ================= EDD cases ================= */
/** case as the API returns it: assignee name, remark count, parsed fields */
async function hydrateEdd(cases) {
  const ids = cases.map((c) => c.id);
  const [U, rc] = await Promise.all([usersById(),
    col('case_remarks').aggregate([{ $match: { case_id: { $in: ids } } }, { $group: { _id: '$case_id', n: { $sum: 1 } } }]).toArray()]);
  const R = Object.fromEntries(rc.map((r) => [r._id, r.n]));
  return cases.map((c) => ({ ...strip(c), assigned_name: U[c.assigned_to]?.name ?? null, remark_count: R[c.id] || 0,
    data: J(c.data, {}), root_causes: J(c.root_causes), is_new: (c.resubmission_count || 0) === 0 }));
}

async function query(q, base = {}) {
  const f = { ...base };
  const and = [];
  if (q.tab === 'work') f.edd_status = null;
  if (q.tab === 'awaiting') f.edd_status = { $in: ['Requested', 'Returned for reupload'] };
  if (q.tab === 'approved') f.edd_status = 'Approved';
  if (q.view === 'lr') f.app_type = 'License Renewal';
  if (q.view === 'other') and.push({ app_type: { $ne: 'License Renewal' } });
  if (q.bu) f.bu = q.bu;
  if (q.app_type) and.push({ app_type: q.app_type });
  if (q.status) f.edd_status = q.status === 'Open' ? null : q.status;
  if (q.risk) f.risk_rating = q.risk;
  if (q.assignee) f.assigned_to = q.assignee === 'unassigned' ? null : +q.assignee;
  if (q.from || q.to) f.created_date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  if (q.search) {
    const r = rx(q.search);
    const who = (await col('users').find({ name: r }, { projection: { id: 1 } }).toArray()).map((u) => u.id);
    and.push({ $or: [{ request_no: r }, { company: r }, { record_type: r }, ...(who.length ? [{ assigned_to: { $in: who } }] : [])] });
  }
  if (and.length) f.$and = and;
  const cases = await col('edd_cases').find(f).toArray();
  // resubmitted first (newest), then newest created
  cases.sort((a, b) => (a.resubmitted_at == null) - (b.resubmitted_at == null)
    || String(b.resubmitted_at || '').localeCompare(String(a.resubmitted_at || ''))
    || String(b.created_date || '').localeCompare(String(a.created_date || '')) || b.id - a.id);
  return hydrateEdd(cases);
}

app.get('/api/edd/my-cases', auth, async (req, res) => {
  const scope = req.user.role === 'admin' ? req.query.scope : 'mine';
  if (scope === 'all') return res.json(await query(req.query));
  if (scope === 'unassigned') return res.json(await query({ ...req.query, assignee: 'unassigned' }));
  res.json(await query({ ...req.query, assignee: undefined }, { assigned_to: req.user.id }));
});
app.get('/api/edd/master', auth, async (req, res) => res.json(await query(req.query)));

app.get('/api/edd/counts', auth, async (req, res) => {
  const scope = req.user.role === 'admin' ? req.query.scope : 'mine';
  const f = scope === 'all' ? {} : scope === 'unassigned' ? { assigned_to: null } : { assigned_to: req.user.id };
  const proj = { projection: { edd_status: 1, app_type: 1, resubmission_count: 1, assigned_to: 1 } };
  const [rows, all] = await Promise.all([col('edd_cases').find(f, proj).toArray(), col('edd_cases').find({}, proj).toArray()]);
  const LR = (c) => c.app_type === 'License Renewal';
  const open = (c) => c.edd_status == null;
  const awaiting = (c) => ['Requested', 'Returned for reupload'].includes(c.edd_status);
  const n = (fn) => rows.filter(fn).length;
  res.json({
    work_lr: n((c) => open(c) && LR(c)), work_other: n((c) => open(c) && !LR(c)),
    awaiting_lr: n((c) => awaiting(c) && LR(c)), awaiting_other: n((c) => awaiting(c) && !LR(c)),
    approved_lr: n((c) => c.edd_status === 'Approved' && LR(c)), approved_other: n((c) => c.edd_status === 'Approved' && !LR(c)),
    resubmitted: n((c) => open(c) && c.resubmission_count > 0), new_apps: n((c) => open(c) && !(c.resubmission_count > 0)),
    total: all.length, unassigned: all.filter((c) => c.assigned_to == null && open(c)).length,
  });
});

/* admin overview: workload per officer (EDD + screening cases) */
app.get('/api/edd/team', auth, adminOnly, async (req, res) => {
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().replace('T', ' ').slice(0, 19);
  const [edd, approvals, scr, escs, lastA, lastB, users] = await Promise.all([
    col('edd_cases').find({ assigned_to: { $ne: null } }, { projection: { id: 1, assigned_to: 1, edd_status: 1, resubmission_count: 1, app_type: 1, risk_rating: 1, created_date: 1 } }).toArray(),
    // approvals recorded in the app in the last 30 days (imported history is not counted)
    col('case_events').find({ type: 'status', detail: /→ Approved$/, at: { $gte: cutoff } }, { projection: { case_id: 1 } }).toArray(),
    col('screening_cases').find({}, { projection: { id: 1, assigned_to: 1, escalated_to: 1, status: 1 } }).toArray(),
    col('screening_case_escalations').find({ decided_at: null, manager_at: { $ne: null } }, { projection: { case_id: 1 } }).toArray(),
    col('case_events').aggregate([{ $match: { by_user: { $ne: null } } }, { $group: { _id: '$by_user', at: { $max: '$at' } } }]).toArray(),
    col('screening_case_events').aggregate([{ $match: { by_user: { $ne: null } } }, { $group: { _id: '$by_user', at: { $max: '$at' } } }]).toArray(),
    col('users').find().sort({ role: -1, name: 1 }).toArray(),
  ]);
  const zero = () => ({ open: 0, new_apps: 0, resubmitted: 0, open_lr: 0, awaiting: 0, requested: 0, returned: 0, approved: 0, high_risk: 0, oldest_open: null, total: 0 });
  const E = {};
  for (const c of edd) {
    const e = (E[c.assigned_to] ??= zero());
    const open = c.edd_status == null;
    e.total++;
    if (open) {
      e.open++; if (c.resubmission_count > 0) e.resubmitted++; else e.new_apps++;
      if (c.app_type === 'License Renewal') e.open_lr++;
      if (c.created_date && (!e.oldest_open || c.created_date < e.oldest_open)) e.oldest_open = c.created_date;
    }
    if (c.edd_status === 'Requested') { e.requested++; e.awaiting++; }
    if (c.edd_status === 'Returned for reupload') { e.returned++; e.awaiting++; }
    if (c.edd_status === 'Approved') e.approved++;
    if (c.edd_status !== 'Approved' && c.risk_rating === 'High') e.high_risk++;
  }
  const owner = Object.fromEntries(edd.map((c) => [c.id, c.assigned_to]));
  const R = {};
  for (const id of new Set(approvals.map((a) => a.case_id))) if (owner[id] != null) R[owner[id]] = (R[owner[id]] || 0) + 1;
  const S = {};
  for (const c of scr) {
    if (c.assigned_to == null) continue;
    const s = (S[c.assigned_to] ??= { cases_active: 0, cases_pending: 0 });
    if (c.status !== 'False') s.cases_active++;
    if ([T.POSSIBLE, T.ESCALATE].includes(c.status)) s.cases_pending++;
  }
  // escalated cases waiting for this manager's recommendation
  const recommended = new Set(escs.map((e) => e.case_id));
  const W = {};
  for (const c of scr) if (c.status === T.ESCALATE && c.escalated_to != null && !recommended.has(c.id)) W[c.escalated_to] = (W[c.escalated_to] || 0) + 1;
  const L = {};
  for (const r of [...lastA, ...lastB]) if (!L[r._id] || r.at > L[r._id]) L[r._id] = r.at;

  res.json(users.map(publicUser)
    // officers and assistant managers always; other admins only when they hold cases
    .filter((u) => u.role === 'user' || /assistant manager/i.test(u.title || '') || E[u.id] || S[u.id])
    .map((u) => ({
      id: u.id, name: u.name, title: u.title, role: u.role, status: u.status, bus: u.bus, duties: u.duties,
      ...(E[u.id] || zero()),
      approved_30d: R[u.id] || 0, cases_active: S[u.id]?.cases_active || 0, cases_pending: S[u.id]?.cases_pending || 0,
      escalations_waiting: W[u.id] || 0, last_activity: L[u.id] || null,
    })));
});

app.patch('/api/edd/cases/:id', auth, async (req, res) => {
  const c = await col('edd_cases').findOne({ id: +req.params.id });
  if (!c) return res.status(404).json({ error: 'Case not found' });
  if (req.user.role !== 'admin' && c.assigned_to !== req.user.id) return res.status(403).json({ error: 'Not your case' });
  const b = req.body || {};
  const risk = 'risk_rating' in b ? (b.risk_rating || null) : c.risk_rating;
  const roots = 'root_causes' in b ? b.root_causes : J(c.root_causes);
  if (risk && !T.RISK_RATINGS.includes(risk)) return res.status(400).json({ error: 'Invalid risk rating' });
  if (!Array.isArray(roots) || roots.some((r) => !T.ROOT_CAUSES.includes(r))) return res.status(400).json({ error: 'Invalid root cause' });

  let status = c.edd_status ?? null;
  if ('edd_status' in b) {
    status = b.edd_status || null;
    if (status && !T.EDD_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid EDD status' });
    if (status && (c.resubmission_count || 0) === 0 && (!risk || !roots.length))
      return res.status(400).json({ error: 'New application: set Risk Rating and Root Cause before changing the EDD Status' });
  }
  const changed = status !== (c.edd_status ?? null);
  await col('edd_cases').updateOne({ id: c.id }, { $set: { risk_rating: risk, root_causes: roots, edd_status: status, updated_at: now(),
    ...(changed ? { status_at: now() } : {}) } });
  if (changed) await logEvent(c.id, 'status', `${c.edd_status || 'Open'} → ${status || 'Open'}`, req.user.id);
  res.json((await hydrateEdd([await col('edd_cases').findOne({ id: c.id })]))[0]);
});

app.post('/api/edd/cases/transfer', auth, async (req, res) => {
  const { caseIds, toUserId, reason } = req.body || {};
  if (!Array.isArray(caseIds) || !caseIds.length) return res.status(400).json({ error: 'No cases selected' });
  const target = await getUser(+toUserId);
  if (!target) return res.status(400).json({ error: 'Target user not found' });
  if (target.status !== 'active') return res.status(400).json({ error: 'Target user is on leave' });
  const list = await col('edd_cases').find({ id: { $in: caseIds.map(Number) } }).toArray();
  // check every case first, so nothing moves if one is not allowed
  const bad = req.user.role !== 'admin' && list.find((c) => c.assigned_to !== target.id && c.assigned_to !== req.user.id);
  if (bad) return res.status(403).json({ error: `Case ${bad.request_no} is not yours` });
  let n = 0;
  for (const c of list) {
    if (c.assigned_to === target.id) continue;
    await col('edd_cases').updateOne({ id: c.id }, { $set: { assigned_to: target.id, updated_at: now() } });
    await logEvent(c.id, 'transfer', reason || '', req.user.id, c.assigned_to ?? null, target.id);
    n++;
  }
  res.json({ transferred: n });
});

/** activity rows with the names of the people involved */
export async function historyOf(collection, caseId) {
  const [events, U] = await Promise.all([col(collection).find({ case_id: caseId }).sort({ id: -1 }).toArray(), usersById()]);
  return events.map((e) => ({ ...strip(e), from_name: U[e.from_user]?.name ?? null, to_name: U[e.to_user]?.name ?? null, by_name: U[e.by_user]?.name ?? null }));
}
/** remarks with author details, oldest first */
export async function remarksOf(collection, caseId) {
  const [rows, U] = await Promise.all([col(collection).find({ case_id: caseId }).sort({ id: 1 }).toArray(), usersById()]);
  return rows.map((r) => ({ id: r.id, case_id: r.case_id, body: r.body, created_at: r.created_at, user_id: r.user_id,
    user_name: U[r.user_id]?.name ?? null, user_role: U[r.user_id]?.role ?? null, user_title: U[r.user_id]?.title ?? null }));
}

app.get('/api/edd/cases/:id/history', auth, async (req, res) => res.json(await historyOf('case_events', +req.params.id)));

/* ---------- remarks (officer/admin communication per case; append-only) ---------- */
const REMARK_MAX = 4000;
app.get('/api/edd/cases/:id/remarks', auth, async (req, res) => {
  if (!(await col('edd_cases').findOne({ id: +req.params.id }, { projection: { id: 1 } }))) return res.status(404).json({ error: 'Case not found' });
  res.json(await remarksOf('case_remarks', +req.params.id));
});

app.post('/api/edd/cases/:id/remarks', auth, async (req, res) => {
  const c = await col('edd_cases').findOne({ id: +req.params.id }, { projection: { id: 1 } });
  if (!c) return res.status(404).json({ error: 'Case not found' });
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'Remark cannot be empty' });
  if (body.length > REMARK_MAX) return res.status(400).json({ error: `Remark is too long (max ${REMARK_MAX} characters)` });
  await insert('case_remarks', { case_id: c.id, user_id: req.user.id, body, created_at: now() });
  await col('edd_cases').updateOne({ id: c.id }, { $set: { updated_at: now() } });
  res.status(201).json(await remarksOf('case_remarks', c.id));
});

registerCaseRoutes(app, { auth, adminOnly, upload, publicUser, findOwner, usersById, historyOf, remarksOf, rx });

// Production: serve the built website (client/dist) from the same server, so /api works on the same domain.
const CLIENT_DIST = fileURLToPath(new URL('../client/dist', import.meta.url));
if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  // any other path is a page of the app (React router)
  app.get('*', (req, res) => res.sendFile(`${CLIENT_DIST}/index.html`));
}

// unexpected errors: log them, answer with JSON
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

await connectDb();
app.listen(PORT, () => console.log(`EDD API running on http://localhost:${PORT}`));
