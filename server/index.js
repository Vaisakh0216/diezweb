import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import * as XLSX from 'xlsx';
import db from './db.js';
import * as T from './terms.js';
import registerCaseRoutes from './cases.js';

const app = express();
const PORT = process.env.PORT || 4000;
const SECRET = process.env.JWT_SECRET || 'edd-dev-secret-change-me';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

/* ================= helpers ================= */
const J = (s, d = []) => { try { return JSON.parse(s); } catch { return d; } };
const publicUser = (u) => u && ({
  id: u.id, name: u.name, email: u.email, role: u.role, title: u.title,
  duties: J(u.duties), bus: J(u.bus), aliases: u.aliases, status: u.status, created_at: u.created_at,
  escalation_manager: !!u.escalation_manager,
});
// only admins can receive escalations
const escFlag = (b) => (b.role === 'admin' && b.escalation_manager ? 1 : 0);
const getUser = (id) => publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    const { id } = jwt.verify(token, SECRET);
    req.user = getUser(id);
    if (!req.user) throw new Error();
    next();
  } catch { res.status(401).json({ error: 'Unauthorized' }); }
}
const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' }));
const logEvent = (case_id, type, detail, by_user, from_user = null, to_user = null) =>
  db.prepare('INSERT INTO case_events (case_id,type,detail,by_user,from_user,to_user) VALUES (?,?,?,?,?,?)')
    .run(case_id, type, detail ?? null, by_user ?? null, from_user, to_user);

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

/* ================= auth & meta ================= */
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').toLowerCase().trim());
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
app.get('/api/users', auth, (req, res) => {
  const counts = Object.fromEntries(db.prepare('SELECT assigned_to, COUNT(*) c FROM edd_cases WHERE edd_status IS NULL GROUP BY assigned_to').all().map((r) => [r.assigned_to, r.c]));
  res.json(db.prepare('SELECT * FROM users ORDER BY role, name').all().map(publicUser).map((u) => ({ ...u, open_cases: counts[u.id] || 0 })));
});

function validateUser(b, isNew) {
  if (!b.name?.trim()) return 'Name is required';
  if (!/^\S+@\S+\.\S+$/.test(b.email || '')) return 'Valid email is required';
  if (isNew && (!b.password || b.password.length < 6)) return 'Password must be at least 6 characters';
  if (!['admin', 'user'].includes(b.role)) return 'Invalid role';
  if (b.title && !T.TITLES.includes(b.title)) return 'Invalid title';
  if (!Array.isArray(b.duties) || b.duties.some((d) => !T.APP_TYPES.includes(d))) return 'Invalid duties';
  if (!Array.isArray(b.bus) || b.bus.some((d) => !T.BUS.includes(d))) return 'Invalid business units';
  return null;
}
const dupErr = (e) => (e.message.includes('UNIQUE') ? 'Email already exists' : e.message);

app.post('/api/users', auth, adminOnly, (req, res) => {
  const b = req.body; const err = validateUser(b, true);
  if (err) return res.status(400).json({ error: err });
  try {
    const r = db.prepare('INSERT INTO users (name,email,password_hash,role,title,duties,bus,aliases,status,escalation_manager) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(b.name.trim(), b.email.toLowerCase().trim(), bcrypt.hashSync(b.password, 10), b.role, b.title || null,
        JSON.stringify(b.duties), JSON.stringify(b.bus), b.aliases || '', b.status || 'active', escFlag(b));
    res.status(201).json(getUser(r.lastInsertRowid));
  } catch (e) { res.status(400).json({ error: dupErr(e) }); }
});

app.put('/api/users/:id', auth, adminOnly, (req, res) => {
  const b = req.body; const err = validateUser(b, false);
  if (err) return res.status(400).json({ error: err });
  const id = +req.params.id;
  try {
    db.prepare('UPDATE users SET name=?, email=?, role=?, title=?, duties=?, bus=?, aliases=?, status=?, escalation_manager=? WHERE id=?')
      .run(b.name.trim(), b.email.toLowerCase().trim(), b.role, b.title || null, JSON.stringify(b.duties), JSON.stringify(b.bus), b.aliases || '', b.status || 'active', escFlag(b), id);
    if (b.password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(b.password, 10), id);
    res.json(getUser(id));
  } catch (e) { res.status(400).json({ error: dupErr(e) }); }
});

app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  const id = +req.params.id;
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself' });
  const open = db.prepare("SELECT COUNT(*) c FROM edd_cases WHERE assigned_to=? AND (edd_status IS NULL OR edd_status!='Approved')").get(id).c;
  if (open) return res.status(400).json({ error: `User has ${open} open case(s). Transfer them first.` });
  db.prepare('UPDATE edd_cases SET assigned_to=NULL WHERE assigned_to=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
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

app.post('/api/edd/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { dateFrom, dateTo, defaultBu = 'DSO' } = req.body;
  if (!dateFrom || !dateTo) return res.status(400).json({ error: 'Date range is required' });
  if (dateFrom > dateTo) return res.status(400).json({ error: 'From date must be before To date' });
  if (!T.DSO_GROUP.includes(defaultBu)) return res.status(400).json({ error: 'Invalid default BU' });

  let parsed;
  try { parsed = parseFile(req.file.buffer); } catch (e) { return res.status(400).json({ error: e.message }); }
  const { system, tpl, rows } = parsed;

  const users = db.prepare('SELECT * FROM users').all().map(publicUser);
  const active = users.filter((u) => u.status === 'active');
  const load = Object.fromEntries(db.prepare('SELECT assigned_to, COUNT(*) c FROM edd_cases WHERE edd_status IS NULL GROUP BY assigned_to').all().map((r) => [r.assigned_to, r.c]));
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
  const findCase = db.prepare('SELECT * FROM edd_cases WHERE bu=? AND request_no=?');

  const tx = db.transaction(() => {
    const up = db.prepare('INSERT INTO uploads (filename,system,uploaded_by,date_from,date_to) VALUES (?,?,?,?,?)')
      .run(req.file.originalname, system, req.user.id, dateFrom, dateTo);
    const uploadId = up.lastInsertRowid;
    const ins = db.prepare(`INSERT INTO edd_cases (upload_id,system,bu,request_no,company,created_date,record_type,app_type,owner_name,assigned_to,edd_status,status_at,is_history,closed_date,data)
      VALUES (@upload_id,@system,@bu,@request_no,@company,@created_date,@record_type,@app_type,@owner_name,@assigned_to,@edd_status,@status_at,@is_history,@closed_date,@data)`);

    for (const raw of rows) {
      const r = normaliseRow(system, tpl, raw, defaultBu);
      if (!r.created_date) { S.noDate++; continue; }
      if (r.created_date < dateFrom || r.created_date > dateTo) { S.outOfRange++; continue; }
      if (!r.app_type) { S.unmapped++; S.unmappedTypes[r.record_type || '(blank)'] = (S.unmappedTypes[r.record_type || '(blank)'] || 0) + 1; continue; }
      const key = `${r.bu}|${r.request_no}`;
      if (seen.has(key)) { S.dupInFile++; continue; }
      seen.add(key);

      const existing = findCase.get(r.bu, r.request_no);
      if (existing) {
        if (existing.edd_status === 'Approved') { S.alreadyApproved++; continue; }
        if (r.completed) { // closed in Salesforce -> history
          db.prepare("UPDATE edd_cases SET edd_status='Approved', is_history=1, closed_date=?, status_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(r.closed_date, existing.id);
          logEvent(existing.id, 'history', 'Marked completed by Salesforce export', req.user.id);
          S.history++; continue;
        }
        if (existing.edd_status === null) { S.alreadyOpen++; continue; }
        if (!isAdmin && existing.assigned_to !== req.user.id) { S.notYours++; continue; }
        // Requested / Returned -> client has submitted the form: back to work queue
        db.prepare(`UPDATE edd_cases SET edd_status=NULL, resubmission_count=resubmission_count+1, resubmitted_at=datetime('now'),
          updated_at=datetime('now'), data=? WHERE id=?`).run(JSON.stringify(r.data), existing.id);
        logEvent(existing.id, 'resubmitted', `Previously "${existing.edd_status}"`, req.user.id);
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
      const id = ins.run({
        upload_id: uploadId, system, bu: r.bu, request_no: r.request_no, company: r.company, created_date: r.created_date,
        record_type: r.record_type, app_type: r.app_type, owner_name: r.owner_name, assigned_to: assignee?.id ?? null,
        edd_status: r.completed ? 'Approved' : null, status_at: r.completed ? new Date().toISOString() : null,
        is_history: r.completed ? 1 : 0, closed_date: r.closed_date, data: JSON.stringify(r.data),
      }).lastInsertRowid;
      logEvent(id, r.completed ? 'history' : 'created', r.completed ? 'Imported as completed (history)' : `Imported from ${system}`, req.user.id, null, assignee?.id ?? null);
      if (r.completed) { S.history++; continue; }
      S.newCases++;
      if (assignee) S.perUser[assignee.name] = (S.perUser[assignee.name] || 0) + 1; else S.unassigned++;
    }
    db.prepare('UPDATE uploads SET stats=? WHERE id=?').run(JSON.stringify(S), uploadId);
  });
  tx();
  res.json(S);
});

app.get('/api/edd/uploads', auth, (req, res) => {
  const where = req.user.role === 'admin' ? '' : 'WHERE u.uploaded_by=' + req.user.id;
  res.json(db.prepare(`SELECT u.*, us.name uploaded_by_name FROM uploads u LEFT JOIN users us ON us.id=u.uploaded_by ${where} ORDER BY u.id DESC LIMIT 30`).all()
    .map((u) => ({ ...u, stats: J(u.stats, {}) })));
});

/* ================= EDD cases ================= */
const SELECT = `SELECT c.*, u.name assigned_name,
  (SELECT COUNT(*) FROM case_remarks r WHERE r.case_id=c.id) remark_count
  FROM edd_cases c LEFT JOIN users u ON u.id=c.assigned_to`;
const mapCase = (c) => ({ ...c, data: J(c.data, {}), root_causes: J(c.root_causes), is_new: c.resubmission_count === 0 });

function query(q, where = [], p = []) {
  where = [...where]; p = [...p];
  if (q.tab === 'work') where.push('c.edd_status IS NULL');
  if (q.tab === 'awaiting') where.push("c.edd_status IN ('Requested','Returned for reupload')");
  if (q.tab === 'approved') where.push("c.edd_status='Approved'");
  if (q.view === 'lr') where.push("c.app_type='License Renewal'");
  if (q.view === 'other') where.push("c.app_type!='License Renewal'");
  if (q.bu) { where.push('c.bu=?'); p.push(q.bu); }
  if (q.app_type) { where.push('c.app_type=?'); p.push(q.app_type); }
  if (q.status) { if (q.status === 'Open') where.push('c.edd_status IS NULL'); else { where.push('c.edd_status=?'); p.push(q.status); } }
  if (q.risk) { where.push('c.risk_rating=?'); p.push(q.risk); }
  if (q.assignee) { if (q.assignee === 'unassigned') where.push('c.assigned_to IS NULL'); else { where.push('c.assigned_to=?'); p.push(+q.assignee); } }
  if (q.from) { where.push('c.created_date>=?'); p.push(q.from); }
  if (q.to) { where.push('c.created_date<=?'); p.push(q.to); }
  if (q.search) { const s = `%${q.search}%`; where.push('(c.request_no LIKE ? OR c.company LIKE ? OR c.record_type LIKE ? OR u.name LIKE ?)'); p.push(s, s, s, s); }
  return db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.resubmitted_at IS NULL, c.resubmitted_at DESC, c.created_date DESC, c.id DESC`).all(...p).map(mapCase);
}

app.get('/api/edd/my-cases', auth, (req, res) => {
  const scope = req.user.role === 'admin' ? req.query.scope : 'mine';
  if (scope === 'all') return res.json(query(req.query));
  if (scope === 'unassigned') return res.json(query({ ...req.query, assignee: 'unassigned' }));
  res.json(query(req.query, ['c.assigned_to=?'], [req.user.id]));
});
app.get('/api/edd/master', auth, (req, res) => res.json(query(req.query)));

app.get('/api/edd/counts', auth, (req, res) => {
  const scope = req.user.role === 'admin' ? req.query.scope : 'mine';
  const w = scope === 'all' ? '1=1' : scope === 'unassigned' ? 'assigned_to IS NULL' : `assigned_to=${req.user.id}`;
  const row = db.prepare(`SELECT
    SUM(edd_status IS NULL AND app_type='License Renewal') work_lr,
    SUM(edd_status IS NULL AND app_type!='License Renewal') work_other,
    SUM(edd_status IN ('Requested','Returned for reupload') AND app_type='License Renewal') awaiting_lr,
    SUM(edd_status IN ('Requested','Returned for reupload') AND app_type!='License Renewal') awaiting_other,
    SUM(edd_status='Approved' AND app_type='License Renewal') approved_lr,
    SUM(edd_status='Approved' AND app_type!='License Renewal') approved_other,
    SUM(edd_status IS NULL AND resubmission_count>0) resubmitted,
    SUM(edd_status IS NULL AND resubmission_count=0) new_apps
    FROM edd_cases WHERE ${w}`).get();
  const all = db.prepare(`SELECT COUNT(*) total, SUM(assigned_to IS NULL AND edd_status IS NULL) unassigned FROM edd_cases`).get();
  res.json({ ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v || 0])), total: all.total, unassigned: all.unassigned || 0 });
});

/* admin overview: workload per officer (EDD + screening cases) */
app.get('/api/edd/team', auth, adminOnly, (req, res) => {
  const edd = db.prepare(`SELECT assigned_to uid,
    SUM(edd_status IS NULL) open, SUM(edd_status IS NULL AND resubmission_count=0) new_apps,
    SUM(edd_status IS NULL AND resubmission_count>0) resubmitted,
    SUM(edd_status IS NULL AND app_type='License Renewal') open_lr,
    SUM(edd_status IN ('Requested','Returned for reupload')) awaiting,
    SUM(edd_status='Requested') requested, SUM(edd_status='Returned for reupload') returned,
    SUM(edd_status='Approved') approved,
    SUM(edd_status IS NOT 'Approved' AND risk_rating='High') high_risk,
    MIN(CASE WHEN edd_status IS NULL THEN created_date END) oldest_open,
    COUNT(*) total
    FROM edd_cases WHERE assigned_to IS NOT NULL GROUP BY assigned_to`).all();
  // approvals recorded in the app in the last 30 days (imported history is not counted)
  const recent = db.prepare(`SELECT c.assigned_to uid, COUNT(DISTINCT e.case_id) n FROM case_events e JOIN edd_cases c ON c.id=e.case_id
    WHERE e.type='status' AND e.detail LIKE '%→ Approved' AND e.at >= datetime('now','-30 days') GROUP BY c.assigned_to`).all();
  const scr = db.prepare(`SELECT assigned_to uid, SUM(status!='False') cases_active,
    SUM(status IN (?, ?)) cases_pending FROM screening_cases WHERE assigned_to IS NOT NULL GROUP BY assigned_to`).all(T.POSSIBLE, T.ESCALATE);
  // escalated cases waiting for this manager's recommendation
  const escw = db.prepare(`SELECT c.escalated_to uid, COUNT(*) n FROM screening_cases c WHERE c.status=? AND c.escalated_to IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM screening_case_escalations e WHERE e.case_id=c.id AND e.decided_at IS NULL AND e.manager_at IS NOT NULL)
    GROUP BY c.escalated_to`).all(T.ESCALATE);
  const last = db.prepare(`SELECT by_user uid, MAX(at) at FROM (
    SELECT by_user, at FROM case_events UNION ALL SELECT by_user, at FROM screening_case_events) WHERE by_user IS NOT NULL GROUP BY by_user`).all();
  const by = (rows) => Object.fromEntries(rows.map((r) => [r.uid, r]));
  const E = by(edd), S = by(scr), L = by(last), R = by(recent), W = by(escw);
  const zero = { open: 0, new_apps: 0, resubmitted: 0, open_lr: 0, awaiting: 0, requested: 0, returned: 0, approved: 0, high_risk: 0, oldest_open: null, total: 0 };
  const users = db.prepare('SELECT * FROM users ORDER BY role DESC, name').all().map(publicUser)
    // officers and assistant managers always; other admins only when they hold cases
    .filter((u) => u.role === 'user' || /assistant manager/i.test(u.title || '') || E[u.id] || S[u.id]);
  res.json(users.map((u) => {
    const { uid, ...e } = E[u.id] || zero;
    return {
      id: u.id, name: u.name, title: u.title, role: u.role, status: u.status, bus: u.bus, duties: u.duties,
      ...Object.fromEntries(Object.entries({ ...zero, ...e }).map(([k, v]) => [k, k === 'oldest_open' ? v : v || 0])),
      approved_30d: R[u.id]?.n || 0, cases_active: S[u.id]?.cases_active || 0, cases_pending: S[u.id]?.cases_pending || 0,
      escalations_waiting: W[u.id]?.n || 0, last_activity: L[u.id]?.at || null,
    };
  }));
});

app.patch('/api/edd/cases/:id', auth, (req, res) => {
  const c = db.prepare('SELECT * FROM edd_cases WHERE id=?').get(+req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  if (req.user.role !== 'admin' && c.assigned_to !== req.user.id) return res.status(403).json({ error: 'Not your case' });
  const b = req.body || {};
  const risk = 'risk_rating' in b ? (b.risk_rating || null) : c.risk_rating;
  const roots = 'root_causes' in b ? b.root_causes : J(c.root_causes);
  if (risk && !T.RISK_RATINGS.includes(risk)) return res.status(400).json({ error: 'Invalid risk rating' });
  if (!Array.isArray(roots) || roots.some((r) => !T.ROOT_CAUSES.includes(r))) return res.status(400).json({ error: 'Invalid root cause' });

  let status = c.edd_status;
  if ('edd_status' in b) {
    status = b.edd_status || null;
    if (status && !T.EDD_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid EDD status' });
    if (status && c.resubmission_count === 0 && (!risk || !roots.length))
      return res.status(400).json({ error: 'New application: set Risk Rating and Root Cause before changing the EDD Status' });
  }
  db.prepare(`UPDATE edd_cases SET risk_rating=?, root_causes=?, edd_status=?, status_at=CASE WHEN ? THEN datetime('now') ELSE status_at END,
    updated_at=datetime('now') WHERE id=?`).run(risk, JSON.stringify(roots), status, status !== c.edd_status ? 1 : 0, c.id);
  if (status !== c.edd_status) logEvent(c.id, 'status', `${c.edd_status || 'Open'} → ${status || 'Open'}`, req.user.id);
  res.json(mapCase(db.prepare(`${SELECT} WHERE c.id=?`).get(c.id)));
});

app.post('/api/edd/cases/transfer', auth, (req, res) => {
  const { caseIds, toUserId, reason } = req.body || {};
  if (!Array.isArray(caseIds) || !caseIds.length) return res.status(400).json({ error: 'No cases selected' });
  const target = getUser(+toUserId);
  if (!target) return res.status(400).json({ error: 'Target user not found' });
  if (target.status !== 'active') return res.status(400).json({ error: 'Target user is on leave' });
  const tx = db.transaction(() => {
    let n = 0;
    for (const id of caseIds) {
      const c = db.prepare('SELECT * FROM edd_cases WHERE id=?').get(+id);
      if (!c || c.assigned_to === target.id) continue;
      if (req.user.role !== 'admin' && c.assigned_to !== req.user.id) throw new Error(`Case ${c.request_no} is not yours`);
      db.prepare("UPDATE edd_cases SET assigned_to=?, updated_at=datetime('now') WHERE id=?").run(target.id, c.id);
      logEvent(c.id, 'transfer', reason || '', req.user.id, c.assigned_to, target.id);
      n++;
    }
    return n;
  });
  try { res.json({ transferred: tx() }); } catch (e) { res.status(403).json({ error: e.message }); }
});

app.get('/api/edd/cases/:id/history', auth, (req, res) => {
  res.json(db.prepare(`SELECT e.*, f.name from_name, t.name to_name, b.name by_name FROM case_events e
    LEFT JOIN users f ON f.id=e.from_user LEFT JOIN users t ON t.id=e.to_user LEFT JOIN users b ON b.id=e.by_user
    WHERE e.case_id=? ORDER BY e.id DESC`).all(+req.params.id));
});

/* ---------- remarks (officer/admin communication per case; append-only) ---------- */
const REMARK_MAX = 4000;
const listRemarks = (caseId) => db.prepare(`SELECT r.id, r.case_id, r.body, r.created_at, r.user_id, u.name user_name, u.role user_role, u.title user_title
  FROM case_remarks r LEFT JOIN users u ON u.id=r.user_id WHERE r.case_id=? ORDER BY r.id`).all(caseId);

app.get('/api/edd/cases/:id/remarks', auth, (req, res) => {
  if (!db.prepare('SELECT 1 FROM edd_cases WHERE id=?').get(+req.params.id)) return res.status(404).json({ error: 'Case not found' });
  res.json(listRemarks(+req.params.id));
});

app.post('/api/edd/cases/:id/remarks', auth, (req, res) => {
  const c = db.prepare('SELECT id FROM edd_cases WHERE id=?').get(+req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'Remark cannot be empty' });
  if (body.length > REMARK_MAX) return res.status(400).json({ error: `Remark is too long (max ${REMARK_MAX} characters)` });
  db.prepare('INSERT INTO case_remarks (case_id,user_id,body) VALUES (?,?,?)').run(c.id, req.user.id, body);
  db.prepare("UPDATE edd_cases SET updated_at=datetime('now') WHERE id=?").run(c.id);
  res.status(201).json(listRemarks(c.id));
});

registerCaseRoutes(app,{ auth, adminOnly, upload, publicUser, findOwner });

app.listen(PORT,() => console.log(`EDD API running on http://localhost:${PORT}`));
