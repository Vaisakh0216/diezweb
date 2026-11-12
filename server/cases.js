// Screening cases.
// Flow: admin creates a case (one-by-one or bulk) with Company + Service Request + Assignee
//       -> it lands in the officer's Cases queue (uncategorised)
//       -> officer completes the review (all fields mandatory)
//       -> the case is categorised into True Match / Heightened Monitoring / Red Flag / SAR.
import * as XLSX from 'xlsx';
import { col, insert, now, strip } from './db.js';
import * as T from './terms.js';

// Entered by the officer (all mandatory).
const REVIEW_FIELDS = ['app_type', 'bu', 'wc_reference', 'matched_party', 'alert_category', 'status'];
const LABELS = {
  app_type: 'Application Type', bu: 'BU', wc_reference: 'World-Check Reference', matched_party: 'Matched Individual/Company',
  alert_category: 'Alert Category', status: 'Status', module: 'Category',
};
const CHOICES = { app_type: T.APP_TYPES, bu: T.BUS, alert_category: T.ALERT_CATEGORIES, status: T.CASE_STATUSES };
const MODULE_NAME = { ...Object.fromEntries(T.MODULES.map((m) => [m.slug, m.name])), [T.NFA_SLUG]: 'No further action' };
const TEXT_MAX = 300;
const REASON_MAX = 1000;
const REMARK_MAX = 4000;
const DETAILS_MAX = 2000;
const TEMPLATE_MAX = 5000;
const recText = (rec, other) => (rec === T.OTHERS && other ? `Others: ${other}` : rec);

// every field of a case document (null when not set), so the API shape never changes
const CASE_FIELDS = ['id', 'request_no', 'company', 'module', 'assigned_to', 'app_type', 'wc_reference', 'matched_party', 'alert_category', 'status',
  'alert_result', 'false_reason', 'escalated_to', 'escalated_at', 'categorised_at', 'created_by', 'assigned_at', 'created_at', 'updated_at', 'bu', 'nfa_reason'];

/* Escalate to Manager: the officer writes the report (crime/alert details + inspection team notification) and their recommendation; the rest is auto-populated. */
function validateEscalation(b) {
  const findings = String(b?.findings ?? '').trim();
  if (!findings) return { error: 'Crime/alert details are required to escalate' };
  if (findings.length > DETAILS_MAX) return { error: `Crime/alert details are too long (max ${DETAILS_MAX} characters)` };
  const template = String(b?.notify_template ?? '').trim();
  if (!template) return { error: 'The inspection team notification is empty' };
  if (template.length > TEMPLATE_MAX) return { error: 'The inspection team notification is too long' };
  const rec = String(b?.investigator_rec ?? '').trim();
  const other = String(b?.investigator_rec_other ?? '').trim();
  if (!T.INVESTIGATOR_RECS.includes(rec)) return { error: 'Choose your recommendation for the manager' };
  if (rec === T.OTHERS && !other) return { error: 'Describe the "Others" recommendation' };
  if (other.length > TEXT_MAX) return { error: 'Recommendation description is too long' };
  return { esc: { findings, notify_template: template, investigator_rec: rec, investigator_rec_other: rec === T.OTHERS ? other : null } };
}

/**
 * Cases as the API returns them: the case plus assignee / creator / escalation-manager names, remark count,
 * Heightened Monitoring details (hm_*) and the latest escalation (esc_*).
 * `backFromManager`: escalated and the manager recommendation is recorded (back with the officer).
 */
async function hydrate(cases) {
  if (!cases.length) return [];
  const ids = cases.map((c) => c.id);
  const [users, rc, hms, escs] = await Promise.all([
    col('users').find({}, { projection: { id: 1, name: 1 } }).toArray(),
    col('screening_case_remarks').aggregate([{ $match: { case_id: { $in: ids } } }, { $group: { _id: '$case_id', n: { $sum: 1 } } }]).toArray(),
    col('screening_case_hm').find({ case_id: { $in: ids } }).toArray(),
    col('screening_case_escalations').find({ case_id: { $in: ids } }).sort({ id: 1 }).toArray(),
  ]);
  const name = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const R = Object.fromEntries(rc.map((r) => [r._id, r.n]));
  const H = Object.fromEntries(hms.map((h) => [h.case_id, h]));
  const E = {}; const back = new Set();
  for (const e of escs) {
    E[e.case_id] = e; // sorted by id: the last one wins
    if (e.manager_at != null && e.decided_at == null) back.add(e.case_id);
  }
  return cases.map((raw) => {
    const c = Object.fromEntries(CASE_FIELDS.map((f) => [f, raw[f] ?? null]));
    const hm = H[c.id]; const e = E[c.id];
    return Object.defineProperty({
      ...c,
      assigned_name: name[c.assigned_to] ?? null, created_by_name: name[c.created_by] ?? null, escalated_name: name[c.escalated_to] ?? null,
      remark_count: R[c.id] || 0,
      hm_date: hm?.hm_date ?? null, hm_bu: hm?.bu ?? null, hm_alert_category: hm?.alert_category ?? null, hm_details: hm?.crime_details ?? null,
      hm_investigator: hm?.investigator_name ?? null, hm_template: hm?.notify_template ?? null,
      esc_id: e?.id ?? null, esc_bu: e?.bu ?? null, esc_findings: e?.findings ?? null, esc_template: e?.notify_template ?? null,
      esc_investigator: e?.investigator_name ?? null, esc_alert_category: e?.alert_category ?? null,
      esc_investigator_rec: e?.investigator_rec ?? null, esc_investigator_rec_other: e?.investigator_rec_other ?? null,
      esc_manager_rec: e?.manager_rec ?? null, esc_manager_rec_other: e?.manager_rec_other ?? null, esc_manager_at: e?.manager_at ?? null,
      esc_manager_by_name: name[e?.manager_by] ?? null,
      esc_decision: e?.decision ?? null, esc_decided_at: e?.decided_at ?? null, esc_decided_by_name: name[e?.decided_by] ?? null,
    }, 'backFromManager', { value: c.status === T.ESCALATE && back.has(c.id), enumerable: false });
  });
}
const getCase = async (id) => (await hydrate(await col('screening_cases').find({ id }).toArray()))[0];
const logEvent = (case_id, type, detail, by_user, from_user = null, to_user = null) =>
  insert('screening_case_events', { case_id, type, detail: detail ?? null, from_user, to_user, by_user: by_user ?? null, at: now() });
const addRemark = (case_id, user_id, body) => insert('screening_case_remarks', { case_id, user_id, body, created_at: now() });

/* ---------- assignee matching (tolerates "Firaz" -> Firas Essghaier) ---------- */
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function matchUser(users, input, findOwner) {
  const s = String(input ?? '').trim();
  if (!s) return { user: null };
  const byEmail = users.find((u) => u.email === s.toLowerCase());
  if (byEmail) return { user: byEmail };
  const exact = findOwner(users, s) || users.find((u) => T.norm(u.name.split(/\s+/)[0]) === T.norm(s.split(/\s+/)[0]));
  if (exact) return { user: exact };
  const first = T.norm(s.split(/\s+/)[0]);
  const near = first.length >= 4 ? users.filter((u) => lev(first, T.norm(u.name.split(/\s+/)[0])) <= 1) : [];
  if (near.length === 1) return { user: near[0], fuzzy: true };
  return { user: null, error: near.length > 1 ? `"${s}" matches more than one user` : `No user matches "${s}"` };
}

/* ---------- bulk file parsing ---------- */
const H = {
  company: ['companyname', 'company', 'accountname'],
  request_no: ['servicerequest', 'servicerequest#', 'servicerequestno', 'servicerequestnumber', 'requestno', 'requestnumber', 'servicenumber', 'sr'],
  assign: ['assign', 'assignto', 'assignee', 'assignedto', 'officer'],
};
const hkey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9#]/g, '');
function parseBulk(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false, blankrows: false });
    for (let r = 0; r < Math.min(grid.length, 30); r++) {
      const cells = grid[r].map(hkey);
      const idx = Object.fromEntries(Object.entries(H).map(([k, names]) => [k, cells.findIndex((c) => names.includes(c))]));
      if (idx.company < 0 || idx.request_no < 0) continue;
      return grid.slice(r + 1).map((line, i) => ({
        row: r + i + 2,
        company: String(line[idx.company] ?? '').trim(),
        request_no: String(line[idx.request_no] ?? '').trim(),
        assign: idx.assign >= 0 ? String(line[idx.assign] ?? '').trim() : '',
      })).filter((x) => x.company || x.request_no || x.assign);
    }
  }
  throw new Error('Could not find the header row. Expected columns: Company name, Service Request, Assign.');
}

/* ---------- review validation (shared by every save; all fields mandatory) ---------- */
async function validateReview(c, b) {
  const v = {};
  for (const f of REVIEW_FIELDS) {
    const val = String(b[f] ?? '').trim();
    if (!val) return { error: `${LABELS[f]} is required` };
    if (CHOICES[f] && !CHOICES[f].includes(val)) return { error: `Invalid ${LABELS[f]}` };
    if (val.length > TEXT_MAX) return { error: `${LABELS[f]} is too long` };
    v[f] = val;
  }
  // An escalated case comes back (True Match / False) only after the manager's recommendation is recorded.
  if (c.status === T.ESCALATE && v.status !== T.ESCALATE && !c.esc_manager_rec)
    return { error: 'This case is waiting for the manager’s recommendation. Once it is recorded you can set True Match or False.' };
  // True Match only after an escalation is back with the manager's recommendation (or the case is already a True Match).
  if (v.status === T.TRUE_MATCH && c.status !== T.TRUE_MATCH && !(c.status === T.ESCALATE && c.esc_manager_rec))
    return { error: 'True Match can only be set after the case is escalated to a manager and the manager’s recommendation is recorded' };
  // Possible waits for a decision: only the listed next statuses are allowed.
  const next = T.NEXT_STATUSES[c.status];
  if (next && v.status !== c.status && !next.includes(v.status))
    return { error: `This case is waiting for a decision ("${c.status}"). Its status can only change to ${next.join(', ')}.` };

  v.false_reason = null;
  if (v.status === 'False') {
    const reason = String(b.false_reason ?? '').trim() || (c.status === 'False' ? c.false_reason : '');
    if (!reason) return { error: 'Give the reason for marking this case False' };
    if (reason.length > REASON_MAX) return { error: `Reason is too long (max ${REASON_MAX} characters)` };
    v.false_reason = reason;
  }

  // Escalation details are kept after the manager's decision comes back (history).
  v.escalated_to = c.escalated_to ?? null; v.escalated_at = c.escalated_at ?? null;
  if (v.status === T.ESCALATE) {
    const mgr = await col('users').findOne({ id: +b.escalated_to || 0, role: 'admin', escalation_manager: { $in: [1, true] } });
    if (!mgr) return { error: 'Choose the manager this case is escalated to (an escalation manager)' };
    if (mgr.status !== 'active' && mgr.id !== c.escalated_to) return { error: `${mgr.name} is on leave` };
    v.escalated_to = mgr.id;
    const stillSameEscalation = c.status === T.ESCALATE && mgr.id === c.escalated_to && c.escalated_at;
    v.escalated_at = stillSameEscalation ? c.escalated_at : now();
  }

  // Action plan: required for a True Match, not set otherwise.
  const mod = b.module ? String(b.module) : null;
  if (mod && !T.ACTION_PLANS.includes(mod)) return { error: 'Invalid action plan' };
  if (v.status === T.TRUE_MATCH && !mod) return { error: 'Choose the action plan for this True Match' };
  if (v.status !== T.TRUE_MATCH && mod && mod !== c.module) return { error: 'An action plan is chosen only for a True Match' };
  v.module = mod;
  v.nfa_reason = null;
  if (mod === T.NFA_SLUG) {
    const reason = String(b.nfa_reason ?? '').trim() || (c.module === T.NFA_SLUG ? c.nfa_reason : '');
    if (!reason) return { error: 'Give the reason for closing this case with no further action' };
    if (reason.length > REASON_MAX) return { error: `Reason is too long (max ${REASON_MAX} characters)` };
    v.nfa_reason = reason;
  }
  v.categorised_at = mod === c.module ? c.categorised_at : mod ? now() : null;
  return { v };
}

export default function registerCaseRoutes(app, { auth, adminOnly, upload, publicUser, findOwner, historyOf, remarksOf, rx }) {
  const allUsers = async () => (await col('users').find().toArray()).map(publicUser);
  // Everyone may view any case (officers: view-only Master Data); only admins and the assigned officer may change it.
  const canEdit = (user, c) => user.role === 'admin' || c.assigned_to === user.id;
  const loadCase = async (req, res, next) => {
    const c = await getCase(+req.params.id);
    if (!c) return res.status(404).json({ error: 'Case not found' });
    req.scase = c; next();
  };
  const ownCase = (req, res, next) => (canEdit(req.user, req.scase) ? next()
    : res.status(403).json({ error: 'This case is not assigned to you (view only)' }));
  const DECIDED = (c) => T.DECISION_STATUSES.includes(c.status);

  /* sidebar counts per view: all | uncategorised | <module> */
  app.get('/api/cases/counts', auth, async (req, res) => {
    const me = req.user.id;
    const blank = () => ({ mine: 0, unassigned: 0, active: 0, open: 0, mine_open: 0, mine_working: 0, mine_pending: 0, escalated_to_me: 0, awaiting_my_rec: 0 });
    const out = { all: blank(), uncategorised: blank(), ...Object.fromEntries(T.MODULE_SLUGS.map((s) => [s, blank()])) };
    const cases = await hydrate(await col('screening_cases').find().toArray());
    for (const c of cases) {
      const back = c.backFromManager;
      const k = {
        mine: c.assigned_to === me && c.status !== 'False',
        unassigned: c.assigned_to == null && c.status !== 'False',
        active: c.status !== 'False',
        open: !DECIDED(c) && !back,
        mine_open: c.assigned_to === me && !DECIDED(c),
        mine_working: c.assigned_to === me && ((!DECIDED(c) && c.status !== T.ESCALATE) || back),
        mine_pending: c.assigned_to === me && c.status === T.ESCALATE && !back,
        escalated_to_me: c.escalated_to === me && c.status === T.ESCALATE,
        awaiting_my_rec: c.escalated_to === me && c.status === T.ESCALATE && !back,
      };
      const view = c.module || 'uncategorised';
      for (const [key, hit] of Object.entries(k)) if (hit) { if (out[view]) out[view][key]++; out.all[key]++; }
    }
    res.json(out);
  });

  /* list. view: all | uncategorised | <module slug> */
  app.get('/api/cases', auth, async (req, res) => {
    const q = req.query; const f = {};
    if (q.view === 'uncategorised') f.module = null;
    else if (T.ACTION_PLANS.includes(q.view)) f.module = q.view;
    // officers: their own cases, or every case (view-only Master Data) with scope=all
    const isAdm = req.user.role === 'admin';
    const scope = isAdm ? (q.scope || 'all') : q.scope === 'all' ? 'all' : 'mine';
    if (scope === 'mine') f.assigned_to = req.user.id;
    if (scope === 'unassigned') f.assigned_to = null;
    if (scope === 'escalated') { f.escalated_to = req.user.id; f.status = T.ESCALATE; }
    if (q.assignee && isAdm) f.assigned_to = +q.assignee;
    if (q.search) { const r = rx(q.search); f.$or = [{ request_no: r }, { company: r }, { wc_reference: r }, { matched_party: r }, { bu: r }]; }
    let list = await hydrate(await col('screening_cases').find(f).toArray());
    const tab = {
      active: (c) => c.status !== 'False',
      false: (c) => c.status === 'False',
      // All Cases: open = still waiting for a decision · completed = closed as True Match / False
      // admins: a case leaves Active (goes to Completed) once the manager recommendation is recorded
      open: (c) => !DECIDED(c) && !(isAdm && c.backFromManager),
      completed: (c) => DECIDED(c) || (isAdm && c.backFromManager),
      // My Cases: working = the officer's to act on · pending = escalated to a manager
      working: (c) => (!DECIDED(c) && c.status !== T.ESCALATE) || c.backFromManager,
      pending: (c) => c.status === T.ESCALATE && !c.backFromManager,
    }[q.tab];
    if (tab) list = list.filter(tab);
    list.sort((a, b) => (a.status === 'False') - (b.status === 'False') || b.id - a.id);
    res.json(list);
  });

  /* create one (uncategorised) */
  app.post('/api/cases', auth, adminOnly, async (req, res) => {
    const company = String(req.body?.company ?? '').trim();
    const request_no = String(req.body?.request_no ?? '').trim();
    if (!company) return res.status(400).json({ error: 'Company name is required' });
    if (!request_no) return res.status(400).json({ error: 'Service Request is required' });
    if (company.length > TEXT_MAX || request_no.length > 100) return res.status(400).json({ error: 'Value too long' });
    let assignee = null;
    if (req.body.assigned_to) {
      assignee = await col('users').findOne({ id: +req.body.assigned_to });
      if (!assignee) return res.status(400).json({ error: 'Assignee not found' });
      if (assignee.status !== 'active') return res.status(400).json({ error: `${assignee.name} is on leave` });
    }
    try {
      const id = await insert('screening_cases', newCase(company, request_no, assignee?.id ?? null, req.user.id));
      await logEvent(id, 'created', 'Created manually', req.user.id, null, assignee?.id ?? null);
      res.status(201).json(await getCase(id));
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: `A case for ${request_no} already exists` });
      throw e;
    }
  });
  const newCase = (company, request_no, assigned_to, created_by) => ({
    request_no, company, module: null, assigned_to, app_type: null, wc_reference: null, matched_party: null, alert_category: null,
    status: 'Under Review', alert_result: null, false_reason: null, escalated_to: null, escalated_at: null, categorised_at: null,
    created_by, assigned_at: assigned_to ? now() : null, created_at: now(), updated_at: now(), bu: null, nfa_reason: null,
  });

  /* bulk: commit=0 -> preview, commit=1 -> import valid rows */
  app.post('/api/cases/bulk', auth, adminOnly, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    let rows;
    try { rows = parseBulk(req.file.buffer); } catch (e) { return res.status(400).json({ error: e.message }); }
    if (!rows.length) return res.status(400).json({ error: 'The file has no case rows' });
    const users = await allUsers();
    const existing = new Set((await col('screening_cases').find({ request_no: { $in: rows.map((r) => r.request_no) } }, { projection: { request_no: 1 } })
      .toArray()).map((c) => c.request_no));
    const seen = new Set();
    const checked = rows.map((r) => {
      const out = { ...r, assignee: null, fuzzy: false, error: null };
      if (!r.company) out.error = 'Company name missing';
      else if (!r.request_no) out.error = 'Service Request missing';
      else if (seen.has(r.request_no.toLowerCase())) out.error = 'Duplicate in this file';
      else if (existing.has(r.request_no)) out.error = 'Case already exists';
      seen.add(r.request_no.toLowerCase());
      const m = matchUser(users, r.assign, findOwner);
      if (m.user) {
        out.assignee = { id: m.user.id, name: m.user.name }; out.fuzzy = !!m.fuzzy;
        if (m.user.status !== 'active') out.error ??= `${m.user.name} is on leave`;
      } else if (m.error) out.error ??= m.error;
      return out;
    });
    const valid = checked.filter((r) => !r.error);
    if (req.body.commit !== '1') return res.json({ rows: checked, valid: valid.length, invalid: checked.length - valid.length });

    for (const r of valid) {
      const id = await insert('screening_cases', newCase(r.company, r.request_no, r.assignee?.id ?? null, req.user.id));
      await logEvent(id, 'created', `Bulk upload: ${req.file.originalname}`, req.user.id, null, r.assignee?.id ?? null);
    }
    res.json({ created: valid.length, skipped: checked.length - valid.length, rows: checked });
  });

  /* officer review: full form, every field mandatory */
  app.put('/api/cases/:id/review', auth, loadCase, ownCase, async (req, res) => {
    const c = req.scase;
    const { v, error } = await validateReview(c, req.body || {});
    if (error) return res.status(400).json({ error });

    // Heightened Monitoring: its details come from the escalation report (a True Match is always escalated first).
    let hm = null;
    if (v.module === T.HM_SLUG && !c.hm_date)
      hm = { bu: v.bu, crime_details: c.esc_findings || '—', notify_template: c.esc_template || '' };
    // Escalate to Manager needs the officer's recommendation (required when escalating, editable while open).
    let esc = null;
    if (v.status === T.ESCALATE && (c.status !== T.ESCALATE || !c.esc_id || c.esc_decided_at || req.body.escalation)) {
      const r = validateEscalation(req.body.escalation);
      if (r.error) return res.status(400).json({ error: r.error });
      esc = r.esc;
    }
    const changed = Object.keys(v).filter((k) => v[k] !== c[k]);
    if (!changed.length && !hm && !esc) return res.json(c);

    const investigatorOf = async () => (c.assigned_to ? await col('users').findOne({ id: c.assigned_to }) : null) || req.user;
    if (esc) {
      const investigator = await investigatorOf();
      // auto-populated for the manager: BU (entered on the case), company, alert category, investigator
      const row = { ...esc, escalated_at: v.escalated_at, escalated_to: v.escalated_to, bu: v.bu, alert_category: v.alert_category };
      const open = c.status === T.ESCALATE && c.esc_id && !c.esc_decided_at;
      if (open) {
        await col('screening_case_escalations').updateOne({ id: c.esc_id }, { $set: row });
        await logEvent(c.id, 'updated', `Escalation report updated · Investigator recommendation: ${recText(esc.investigator_rec, esc.investigator_rec_other)}`, req.user.id);
      } else {
        await insert('screening_case_escalations', { case_id: c.id, ...row, escalated_by: req.user.id, company: c.company,
          investigator_id: investigator.id, investigator_name: investigator.name,
          manager_rec: null, manager_rec_other: null, manager_by: null, manager_at: null, decision: null, decided_by: null, decided_at: null });
      }
    }
    // the case comes back from the manager: record the officer's True Match / False on the escalation
    if (c.status === T.ESCALATE && v.status !== T.ESCALATE && c.esc_id) {
      await col('screening_case_escalations').updateOne({ id: c.esc_id }, { $set: { decision: v.status, decided_by: req.user.id, decided_at: now() } });
      await logEvent(c.id, 'decision', `After manager recommendation (${recText(c.esc_manager_rec, c.esc_manager_rec_other)}): ${v.status}`, req.user.id);
    }
    if (hm) {
      const investigator = await investigatorOf();
      await col('screening_case_hm').updateOne({ _id: c.id }, {
        $set: { ...hm, company: c.company, alert_category: v.alert_category, investigator_id: investigator.id, investigator_name: investigator.name,
          recorded_by: req.user.id, updated_at: now() },
        $setOnInsert: { case_id: c.id, hm_date: now() },
      }, { upsert: true });
      await logEvent(c.id, 'monitoring', `Heightened Monitoring recorded from the escalation report · BU: ${hm.bu}`, req.user.id);
    }
    if (changed.length) {
      // keep the BU shown in the HM / open escalation details in step with the case
      if (changed.includes('bu')) {
        if (c.hm_date && !hm) await col('screening_case_hm').updateOne({ case_id: c.id }, { $set: { bu: v.bu } });
        if (c.esc_id && !c.esc_decided_at && !esc) await col('screening_case_escalations').updateOne({ id: c.esc_id }, { $set: { bu: v.bu } });
      }
      await col('screening_cases').updateOne({ id: c.id }, { $set: { ...v, updated_at: now() } });
      const plain = ['app_type', 'bu', 'wc_reference', 'matched_party', 'alert_category'].filter((f) => changed.includes(f));
      if (plain.length) await logEvent(c.id, 'updated', plain.map((f) => `${LABELS[f]}: ${v[f]}`).join(' · '), req.user.id);
      if (changed.includes('status')) await logEvent(c.id, 'status', `${c.status} → ${v.status}`, req.user.id);
      if (v.status === T.ESCALATE && (v.escalated_to !== c.escalated_to || c.status !== T.ESCALATE))
        await logEvent(c.id, 'escalated', `Officer recommendation: ${recText(esc?.investigator_rec, esc?.investigator_rec_other) || '—'} · waiting for the manager’s decision`, req.user.id, null, v.escalated_to);
      if (v.false_reason && v.false_reason !== c.false_reason) await addRemark(c.id, req.user.id, `Reason for False: ${v.false_reason}`);
      if (v.nfa_reason && v.nfa_reason !== c.nfa_reason) await addRemark(c.id, req.user.id, `Reason for no further action: ${v.nfa_reason}`);
      if (changed.includes('module'))
        await logEvent(c.id, 'categorised', `Action plan: ${c.module ? MODULE_NAME[c.module] : 'None'} → ${v.module ? MODULE_NAME[v.module] : 'None'}`, req.user.id);
    }
    res.json(await getCase(c.id));
  });

  /* manager (admin), inside the case: the manager recommendation (required); the report comes from the officer. Editable while the case is escalated. */
  app.put('/api/cases/:id/manager-recommendation', auth, adminOnly, loadCase, async (req, res) => {
    const c = req.scase; const b = req.body || {};
    if (c.status !== T.ESCALATE || !c.esc_id || c.esc_decided_at) return res.status(400).json({ error: 'This case is not escalated to a manager' });
    const rec = String(b.manager_rec ?? '').trim();
    const other = String(b.manager_rec_other ?? '').trim();
    if (!T.MANAGER_RECS.includes(rec)) return res.status(400).json({ error: 'Manager recommendation is required' });
    if (rec === T.OTHERS && !other) return res.status(400).json({ error: 'Describe the "Others" recommendation' });
    if (other.length > TEXT_MAX) return res.status(400).json({ error: 'Recommendation description is too long' });

    await col('screening_case_escalations').updateOne({ id: c.esc_id },
      { $set: { manager_rec: rec, manager_rec_other: rec === T.OTHERS ? other : null, manager_by: req.user.id, manager_at: now() } });
    await col('screening_cases').updateOne({ id: c.id }, { $set: { updated_at: now() } });
    await logEvent(c.id, 'manager', `${c.esc_manager_rec ? 'Updated' : 'Recorded'} manager recommendation: ${recText(rec, other)}`, req.user.id, null, c.assigned_to);
    res.json(await getCase(c.id));
  });

  /* assign / reassign (admin) */
  app.post('/api/cases/assign', auth, adminOnly, async (req, res) => {
    const { caseIds, toUserId, reason } = req.body || {};
    if (!Array.isArray(caseIds) || !caseIds.length) return res.status(400).json({ error: 'No cases selected' });
    const target = await col('users').findOne({ id: +toUserId });
    if (!target) return res.status(400).json({ error: 'User not found' });
    if (target.status !== 'active') return res.status(400).json({ error: `${target.name} is on leave` });
    let k = 0;
    for (const c of await col('screening_cases').find({ id: { $in: caseIds.map(Number) } }).toArray()) {
      if (c.assigned_to === target.id) continue;
      await col('screening_cases').updateOne({ id: c.id }, { $set: { assigned_to: target.id, assigned_at: now(), updated_at: now() } });
      await logEvent(c.id, 'assigned', String(reason ?? '').trim().slice(0, TEXT_MAX), req.user.id, c.assigned_to ?? null, target.id);
      k++;
    }
    res.json({ assigned: k });
  });

  /* delete (admin). Snapshot kept in screening_case_deletions for audit. */
  app.post('/api/cases/delete', auth, adminOnly, async (req, res) => {
    const { caseIds, reason } = req.body || {};
    const why = String(reason ?? '').trim();
    if (!Array.isArray(caseIds) || !caseIds.length) return res.status(400).json({ error: 'No cases selected' });
    if (!why) return res.status(400).json({ error: 'Give a reason for deleting' });
    if (why.length > REASON_MAX) return res.status(400).json({ error: `Reason is too long (max ${REASON_MAX} characters)` });
    let k = 0;
    for (const c of await col('screening_cases').find({ id: { $in: caseIds.map(Number) } }).toArray()) {
      const of = (name) => col(name).find({ case_id: c.id }).sort({ id: 1 }).toArray().then((r) => r.map(strip));
      const snapshot = {
        case: strip(c),
        remarks: await of('screening_case_remarks'),
        events: await of('screening_case_events'),
        heightened_monitoring: strip(await col('screening_case_hm').findOne({ case_id: c.id })) || null,
        escalations: await of('screening_case_escalations'),
      };
      await insert('screening_case_deletions', { case_id: c.id, request_no: c.request_no, company: c.company, snapshot, reason: why,
        deleted_by: req.user.id, deleted_at: now() });
      for (const name of ['screening_case_remarks', 'screening_case_events', 'screening_case_hm', 'screening_case_escalations'])
        await col(name).deleteMany({ case_id: c.id });
      await col('screening_cases').deleteOne({ id: c.id });
      k++;
    }
    res.json({ deleted: k });
  });

  app.get('/api/cases/:id/history', auth, loadCase, async (req, res) => res.json(await historyOf('screening_case_events', req.scase.id)));

  /* remarks (append-only) */
  app.get('/api/cases/:id/remarks', auth, loadCase, async (req, res) => res.json(await remarksOf('screening_case_remarks', req.scase.id)));
  app.post('/api/cases/:id/remarks', auth, loadCase, ownCase, async (req, res) => {
    const body = String(req.body?.body ?? '').trim();
    if (!body) return res.status(400).json({ error: 'Remark cannot be empty' });
    if (body.length > REMARK_MAX) return res.status(400).json({ error: `Remark is too long (max ${REMARK_MAX} characters)` });
    await addRemark(req.scase.id, req.user.id, body);
    await col('screening_cases').updateOne({ id: req.scase.id }, { $set: { updated_at: now() } });
    res.status(201).json(await remarksOf('screening_case_remarks', req.scase.id));
  });
}
