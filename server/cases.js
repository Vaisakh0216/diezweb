// Screening cases.
// Flow: admin creates a case (one-by-one or bulk) with Company + Service Request + Assignee
//       -> it lands in the officer's Cases queue (uncategorised)
//       -> officer completes the review (all fields mandatory)
//       -> the case is categorised into True Match / Heightened Monitoring / Red Flag / SAR.
import * as XLSX from 'xlsx';
import db from './db.js';
import * as T from './terms.js';

// Entered by the officer (all mandatory). alert_result is derived from status, never entered.
const REVIEW_FIELDS = ['app_type', 'bu', 'wc_reference', 'matched_party', 'alert_category', 'status'];
const LABELS = {
  app_type: 'Application Type', bu: 'BU', wc_reference: 'World-Check Reference', matched_party: 'Matched Individual/Company',
  alert_category: 'Alert Category', status: 'Status', alert_result: 'Alert Result', module: 'Category',
};
const CHOICES = { app_type: T.APP_TYPES, bu: T.BUS, alert_category: T.ALERT_CATEGORIES, status: T.CASE_STATUSES };
const MODULE_NAME = Object.fromEntries(T.MODULES.map((m) => [m.slug, m.name]));
const TEXT_MAX = 300;
const REASON_MAX = 1000;
const REMARK_MAX = 4000;

const SELECT = `SELECT c.*, u.name assigned_name, cb.name created_by_name, eu.name escalated_name,
  (SELECT COUNT(*) FROM screening_case_remarks r WHERE r.case_id=c.id) remark_count,
  hm.hm_date, hm.bu hm_bu, hm.alert_category hm_alert_category, hm.crime_details hm_details,
  hm.investigator_name hm_investigator, hm.notify_template hm_template,
  e.id esc_id, e.bu esc_bu, e.findings esc_findings, e.investigator_name esc_investigator, e.alert_category esc_alert_category,
  e.investigator_rec esc_investigator_rec, e.investigator_rec_other esc_investigator_rec_other,
  e.manager_rec esc_manager_rec, e.manager_rec_other esc_manager_rec_other, e.manager_at esc_manager_at, mu.name esc_manager_by_name,
  e.decision esc_decision, e.decided_at esc_decided_at, du.name esc_decided_by_name
  FROM screening_cases c LEFT JOIN users u ON u.id=c.assigned_to LEFT JOIN users cb ON cb.id=c.created_by
  LEFT JOIN users eu ON eu.id=c.escalated_to LEFT JOIN screening_case_hm hm ON hm.case_id=c.id
  LEFT JOIN screening_case_escalations e ON e.id=(SELECT MAX(id) FROM screening_case_escalations WHERE case_id=c.id)
  LEFT JOIN users mu ON mu.id=e.manager_by LEFT JOIN users du ON du.id=e.decided_by`;
const DETAILS_MAX = 2000;
const TEMPLATE_MAX = 5000;
const recText = (rec, other) => (rec === T.OTHERS && other ? `Others: ${other}` : rec);
const nowSql = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/* Escalate to Manager: the officer writes the report (crime/alert details) and their recommendation; the rest is auto-populated. */
function validateEscalation(b) {
  const findings = String(b?.findings ?? '').trim();
  if (!findings) return { error: 'Crime/alert details are required to escalate' };
  if (findings.length > DETAILS_MAX) return { error: `Crime/alert details are too long (max ${DETAILS_MAX} characters)` };
  const rec = String(b?.investigator_rec ?? '').trim();
  const other = String(b?.investigator_rec_other ?? '').trim();
  if (!T.INVESTIGATOR_RECS.includes(rec)) return { error: 'Choose your recommendation for the manager' };
  if (rec === T.OTHERS && !other) return { error: 'Describe the "Others" recommendation' };
  if (other.length > TEXT_MAX) return { error: 'Recommendation description is too long' };
  return { esc: { findings, investigator_rec: rec, investigator_rec_other: rec === T.OTHERS ? other : null } };
}

/* Heightened Monitoring pop-up: crime/alert details are entered; BU comes from the case, the rest is auto-populated. */
function validateHm(b, bu) {
  if (!b || typeof b !== 'object') return { error: 'Heightened Monitoring details are required', code: 'HM_REQUIRED' };
  const crime = String(b.crime_details ?? '').trim();
  const template = String(b.notify_template ?? '').trim();
  if (!crime) return { error: 'Crime/alert details are required' };
  if (crime.length > DETAILS_MAX) return { error: `Crime/alert details are too long (max ${DETAILS_MAX} characters)` };
  if (!template) return { error: 'The inspection team notification is empty' };
  if (template.length > TEMPLATE_MAX) return { error: 'The notification is too long' };
  return { hm: { bu, crime_details: crime, notify_template: template } };
}
const getCase = (id) => db.prepare(`${SELECT} WHERE c.id=?`).get(id);
const logEvent = (case_id, type, detail, by_user, from_user = null, to_user = null) =>
  db.prepare('INSERT INTO screening_case_events (case_id,type,detail,by_user,from_user,to_user) VALUES (?,?,?,?,?,?)')
    .run(case_id, type, detail ?? null, by_user ?? null, from_user, to_user);
const addRemark = (case_id, user_id, body) =>
  db.prepare('INSERT INTO screening_case_remarks (case_id,user_id,body) VALUES (?,?,?)').run(case_id, user_id, body);

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
function validateReview(c, b) {
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
  // Possible waits for a decision: only the listed next statuses are allowed.
  const next = T.NEXT_STATUSES[c.status];
  if (next && v.status !== c.status && !next.includes(v.status))
    return { error: `This case is waiting for a decision ("${c.status}"). Its status can only change to ${next.join(', ')}.` };
  v.alert_result = T.RESULT_FOR_STATUS[v.status] ?? null;

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
    const mgr = db.prepare("SELECT * FROM users WHERE id=? AND role='admin' AND escalation_manager=1").get(+b.escalated_to || 0);
    if (!mgr) return { error: 'Choose the manager this case is escalated to (an escalation manager)' };
    if (mgr.status !== 'active' && mgr.id !== c.escalated_to) return { error: `${mgr.name} is on leave` };
    v.escalated_to = mgr.id;
    const stillSameEscalation = c.status === T.ESCALATE && mgr.id === c.escalated_to && c.escalated_at;
    v.escalated_at = stillSameEscalation ? c.escalated_at : new Date().toISOString().replace('T', ' ').slice(0, 19);
  }

  const mod = b.module ? String(b.module) : null;
  if (mod && !T.MODULE_SLUGS.includes(mod)) return { error: 'Invalid category' };
  if (T.PENDING_STATUSES.includes(v.status) && mod && mod !== c.module)
    return { error: `A "${v.status}" case is waiting for a decision and cannot be categorised until it is True Match or False` };
  v.module = mod;
  v.categorised_at = mod === c.module ? c.categorised_at : mod ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null;
  return { v };
}

export default function registerCaseRoutes(app, { auth, adminOnly, upload, publicUser, findOwner }) {
  const allUsers = () => db.prepare('SELECT * FROM users').all().map(publicUser);
  const canSee = (user, c) => user.role === 'admin' || c.assigned_to === user.id;
  const loadCase = (req, res, next) => {
    const c = getCase(+req.params.id);
    if (!c || !canSee(req.user, c)) return res.status(404).json({ error: 'Case not found' });
    req.scase = c; next();
  };

  /* sidebar counts per view: all | uncategorised | <module> */
  app.get('/api/cases/counts', auth, (req, res) => {
    const blank = () => ({ mine: 0, unassigned: 0, active: 0, escalated_to_me: 0, awaiting_my_rec: 0 });
    const out = { all: blank(), uncategorised: blank(), ...Object.fromEntries(T.MODULE_SLUGS.map((s) => [s, blank()])) };
    const rows = db.prepare(`SELECT COALESCE(module,'uncategorised') view,
      SUM(assigned_to=? AND status!='False') mine, SUM(assigned_to IS NULL AND status!='False') unassigned,
      SUM(status!='False') active, SUM(escalated_to=? AND status=?) escalated_to_me,
      SUM(escalated_to=? AND status=? AND NOT EXISTS (SELECT 1 FROM screening_case_escalations e
        WHERE e.case_id=c.id AND e.decided_at IS NULL AND e.manager_at IS NOT NULL)) awaiting_my_rec
      FROM screening_cases c GROUP BY view`).all(req.user.id, req.user.id, T.ESCALATE, req.user.id, T.ESCALATE);
    for (const r of rows) {
      if (!out[r.view]) continue;
      for (const k of Object.keys(out.all)) { out[r.view][k] = r[k] || 0; out.all[k] += r[k] || 0; }
    }
    res.json(out);
  });

  /* list. view: all | uncategorised | <module slug> */
  app.get('/api/cases', auth, (req, res) => {
    const q = req.query; const where = []; const p = [];
    if (q.view === 'uncategorised') where.push('c.module IS NULL');
    else if (T.MODULE_SLUGS.includes(q.view)) { where.push('c.module=?'); p.push(q.view); }
    const scope = req.user.role === 'admin' ? (q.scope || 'all') : 'mine';
    if (scope === 'mine') { where.push('c.assigned_to=?'); p.push(req.user.id); }
    if (scope === 'unassigned') where.push('c.assigned_to IS NULL');
    if (scope === 'escalated') { where.push('c.escalated_to=? AND (c.status=? OR c.alert_result=?)'); p.push(req.user.id, T.ESCALATE, T.ESCALATE); }
    if (q.assignee && req.user.role === 'admin') { where.push('c.assigned_to=?'); p.push(+q.assignee); }
    if (q.tab === 'active') where.push("c.status!='False'");
    if (q.tab === 'false') where.push("c.status='False'");
    if (q.search) { const s = `%${q.search}%`; where.push('(c.request_no LIKE ? OR c.company LIKE ? OR c.wc_reference LIKE ? OR c.matched_party LIKE ? OR c.bu LIKE ?)'); p.push(s, s, s, s, s); }
    res.json(db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.status='False', c.id DESC`).all(...p));
  });

  /* create one (uncategorised) */
  app.post('/api/cases', auth, adminOnly, (req, res) => {
    const company = String(req.body?.company ?? '').trim();
    const request_no = String(req.body?.request_no ?? '').trim();
    if (!company) return res.status(400).json({ error: 'Company name is required' });
    if (!request_no) return res.status(400).json({ error: 'Service Request is required' });
    if (company.length > TEXT_MAX || request_no.length > 100) return res.status(400).json({ error: 'Value too long' });
    let assignee = null;
    if (req.body.assigned_to) {
      assignee = db.prepare('SELECT * FROM users WHERE id=?').get(+req.body.assigned_to);
      if (!assignee) return res.status(400).json({ error: 'Assignee not found' });
      if (assignee.status !== 'active') return res.status(400).json({ error: `${assignee.name} is on leave` });
    }
    try {
      const id = db.prepare(`INSERT INTO screening_cases (company,request_no,assigned_to,created_by,assigned_at)
        VALUES (?,?,?,?,CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END)`)
        .run(company, request_no, assignee?.id ?? null, req.user.id, assignee?.id ?? null).lastInsertRowid;
      logEvent(id, 'created', 'Created manually', req.user.id, null, assignee?.id ?? null);
      res.status(201).json(getCase(id));
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: `A case for ${request_no} already exists` });
      throw e;
    }
  });

  /* bulk: commit=0 -> preview, commit=1 -> import valid rows */
  app.post('/api/cases/bulk', auth, adminOnly, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    let rows;
    try { rows = parseBulk(req.file.buffer); } catch (e) { return res.status(400).json({ error: e.message }); }
    if (!rows.length) return res.status(400).json({ error: 'The file has no case rows' });
    const users = allUsers();
    const exists = db.prepare('SELECT 1 FROM screening_cases WHERE request_no=?');
    const seen = new Set();
    const checked = rows.map((r) => {
      const out = { ...r, assignee: null, fuzzy: false, error: null };
      if (!r.company) out.error = 'Company name missing';
      else if (!r.request_no) out.error = 'Service Request missing';
      else if (seen.has(r.request_no.toLowerCase())) out.error = 'Duplicate in this file';
      else if (exists.get(r.request_no)) out.error = 'Case already exists';
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

    const ins = db.prepare(`INSERT INTO screening_cases (company,request_no,assigned_to,created_by,assigned_at)
      VALUES (?,?,?,?,CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END)`);
    db.transaction(() => {
      for (const r of valid) {
        const id = ins.run(r.company, r.request_no, r.assignee?.id ?? null, req.user.id, r.assignee?.id ?? null).lastInsertRowid;
        logEvent(id, 'created', `Bulk upload: ${req.file.originalname}`, req.user.id, null, r.assignee?.id ?? null);
      }
    })();
    res.json({ created: valid.length, skipped: checked.length - valid.length, rows: checked });
  });

  /* officer review: full form, every field mandatory */
  app.put('/api/cases/:id/review', auth, loadCase, (req, res) => {
    const c = req.scase;
    const { v, error } = validateReview(c, req.body || {});
    if (error) return res.status(400).json({ error });

    // Heightened Monitoring needs its extra details (once; sending them again updates them).
    let hm = null;
    if (v.module === T.HM_SLUG && (!c.hm_date || req.body.hm)) {
      const r = validateHm(req.body.hm, v.bu);
      if (r.error) return res.status(400).json({ error: r.error, code: r.code });
      hm = r.hm;
    }
    // Escalate to Manager needs the officer's recommendation (required when escalating, editable while open).
    let esc = null;
    if (v.status === T.ESCALATE && (c.status !== T.ESCALATE || !c.esc_id || c.esc_decided_at || req.body.escalation)) {
      const r = validateEscalation(req.body.escalation);
      if (r.error) return res.status(400).json({ error: r.error });
      esc = r.esc;
    }
    const changed = Object.keys(v).filter((k) => v[k] !== c[k]);
    if (!changed.length && !hm && !esc) return res.json(c);

    db.transaction(() => {
      if (esc) {
        const inv = c.assigned_to ? db.prepare('SELECT id, name FROM users WHERE id=?').get(c.assigned_to) : null;
        const investigator = inv || { id: req.user.id, name: req.user.name };
        // auto-populated for the manager: BU (entered on the case), company, alert category, investigator
        const row = { ...esc, case_id: c.id, escalated_at: v.escalated_at, escalated_to: v.escalated_to, escalated_by: req.user.id,
          bu: v.bu, company: c.company, alert_category: v.alert_category,
          investigator_id: investigator.id, investigator_name: investigator.name };
        const open = c.status === T.ESCALATE && c.esc_id && !c.esc_decided_at;
        if (open) {
          db.prepare(`UPDATE screening_case_escalations SET escalated_at=@escalated_at, escalated_to=@escalated_to, bu=@bu, alert_category=@alert_category,
            findings=@findings, investigator_rec=@investigator_rec, investigator_rec_other=@investigator_rec_other WHERE id=@id`).run({ ...row, id: c.esc_id });
          logEvent(c.id, 'updated', `Escalation report updated · Investigator recommendation: ${recText(esc.investigator_rec, esc.investigator_rec_other)}`, req.user.id);
        } else {
          db.prepare(`INSERT INTO screening_case_escalations (case_id,escalated_at,escalated_to,escalated_by,bu,company,alert_category,
            investigator_id,investigator_name,findings,investigator_rec,investigator_rec_other) VALUES (@case_id,@escalated_at,@escalated_to,@escalated_by,@bu,@company,
            @alert_category,@investigator_id,@investigator_name,@findings,@investigator_rec,@investigator_rec_other)`).run(row);
        }
      }
      // the case comes back from the manager: record the officer's True Match / False on the escalation
      if (c.status === T.ESCALATE && v.status !== T.ESCALATE && c.esc_id) {
        db.prepare('UPDATE screening_case_escalations SET decision=?, decided_by=?, decided_at=? WHERE id=?').run(v.status, req.user.id, nowSql(), c.esc_id);
        logEvent(c.id, 'decision', `After manager recommendation (${recText(c.esc_manager_rec, c.esc_manager_rec_other)}): ${v.status}`, req.user.id);
      }
      if (hm) {
        const inv = c.assigned_to ? db.prepare('SELECT id, name FROM users WHERE id=?').get(c.assigned_to) : null;
        const investigator = inv || { id: req.user.id, name: req.user.name };
        db.prepare(`INSERT INTO screening_case_hm (case_id,bu,company,alert_category,crime_details,investigator_id,investigator_name,notify_template,recorded_by)
          VALUES (@case_id,@bu,@company,@alert_category,@crime_details,@investigator_id,@investigator_name,@notify_template,@recorded_by)
          ON CONFLICT(case_id) DO UPDATE SET bu=@bu, alert_category=@alert_category, crime_details=@crime_details,
            notify_template=@notify_template, recorded_by=@recorded_by, updated_at=datetime('now')`)
          .run({ case_id: c.id, ...hm, company: c.company, alert_category: v.alert_category, investigator_id: investigator.id,
            investigator_name: investigator.name, recorded_by: req.user.id });
        logEvent(c.id, 'monitoring', `${c.hm_date ? 'Updated' : 'Recorded'} Heightened Monitoring details · BU: ${hm.bu}`, req.user.id);
      }
      if (!changed.length) return;
      // keep the BU shown in the HM / open escalation details in step with the case
      if (changed.includes('bu')) {
        if (c.hm_date && !hm) db.prepare('UPDATE screening_case_hm SET bu=? WHERE case_id=?').run(v.bu, c.id);
        if (c.esc_id && !c.esc_decided_at && !esc) db.prepare('UPDATE screening_case_escalations SET bu=? WHERE id=?').run(v.bu, c.esc_id);
      }
      db.prepare(`UPDATE screening_cases SET ${Object.keys(v).map((k) => `${k}=@${k}`).join(', ')}, updated_at=datetime('now') WHERE id=@id`)
        .run({ ...v, id: c.id });
      const plain = ['app_type', 'bu', 'wc_reference', 'matched_party', 'alert_category'].filter((f) => changed.includes(f));
      if (plain.length) logEvent(c.id, 'updated', plain.map((f) => `${LABELS[f]}: ${v[f]}`).join(' · '), req.user.id);
      if (changed.includes('status'))
        logEvent(c.id, 'status', `${c.status} → ${v.status} · Alert Result: ${v.alert_result || '—'}`, req.user.id);
      if (v.status === T.ESCALATE && (v.escalated_to !== c.escalated_to || c.status !== T.ESCALATE))
        logEvent(c.id, 'escalated', `Officer recommendation: ${recText(esc?.investigator_rec, esc?.investigator_rec_other) || '—'} · waiting for the manager’s decision`, req.user.id, null, v.escalated_to);
      if (v.false_reason && v.false_reason !== c.false_reason) addRemark(c.id, req.user.id, `Reason for False: ${v.false_reason}`);
      if (changed.includes('module'))
        logEvent(c.id, 'categorised', `${c.module ? MODULE_NAME[c.module] : 'Uncategorised'} → ${v.module ? MODULE_NAME[v.module] : 'Uncategorised'}`, req.user.id);
    })();
    res.json(getCase(c.id));
  });

  /* manager (admin), inside the case: the manager recommendation (required); the report comes from the officer. Editable while the case is escalated. */
  app.put('/api/cases/:id/manager-recommendation', auth, adminOnly, loadCase, (req, res) => {
    const c = req.scase; const b = req.body || {};
    if (c.status !== T.ESCALATE || !c.esc_id || c.esc_decided_at) return res.status(400).json({ error: 'This case is not escalated to a manager' });
    const rec = String(b.manager_rec ?? '').trim();
    const other = String(b.manager_rec_other ?? '').trim();
    if (!T.MANAGER_RECS.includes(rec)) return res.status(400).json({ error: 'Manager recommendation is required' });
    if (rec === T.OTHERS && !other) return res.status(400).json({ error: 'Describe the "Others" recommendation' });
    if (other.length > TEXT_MAX) return res.status(400).json({ error: 'Recommendation description is too long' });

    db.transaction(() => {
      db.prepare('UPDATE screening_case_escalations SET manager_rec=?, manager_rec_other=?, manager_by=?, manager_at=? WHERE id=?')
        .run(rec, rec === T.OTHERS ? other : null, req.user.id, nowSql(), c.esc_id);
      db.prepare("UPDATE screening_cases SET updated_at=datetime('now') WHERE id=?").run(c.id);
      logEvent(c.id, 'manager', `${c.esc_manager_rec ? 'Updated' : 'Recorded'} manager recommendation: ${recText(rec, other)}`, req.user.id, null, c.assigned_to);
    })();
    res.json(getCase(c.id));
  });

  /* assign / reassign (admin) */
  app.post('/api/cases/assign', auth, adminOnly, (req, res) => {
    const { caseIds, toUserId, reason } = req.body || {};
    if (!Array.isArray(caseIds) || !caseIds.length) return res.status(400).json({ error: 'No cases selected' });
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(+toUserId);
    if (!target) return res.status(400).json({ error: 'User not found' });
    if (target.status !== 'active') return res.status(400).json({ error: `${target.name} is on leave` });
    const n = db.transaction(() => {
      let k = 0;
      for (const id of caseIds) {
        const c = db.prepare('SELECT * FROM screening_cases WHERE id=?').get(+id);
        if (!c || c.assigned_to === target.id) continue;
        db.prepare("UPDATE screening_cases SET assigned_to=?, assigned_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(target.id, c.id);
        logEvent(c.id, 'assigned', String(reason ?? '').trim().slice(0, TEXT_MAX), req.user.id, c.assigned_to, target.id);
        k++;
      }
      return k;
    })();
    res.json({ assigned: n });
  });

  /* delete (admin). Snapshot kept in screening_case_deletions for audit. */
  app.post('/api/cases/delete', auth, adminOnly, (req, res) => {
    const { caseIds, reason } = req.body || {};
    const why = String(reason ?? '').trim();
    if (!Array.isArray(caseIds) || !caseIds.length) return res.status(400).json({ error: 'No cases selected' });
    if (!why) return res.status(400).json({ error: 'Give a reason for deleting' });
    if (why.length > REASON_MAX) return res.status(400).json({ error: `Reason is too long (max ${REASON_MAX} characters)` });
    const n = db.transaction(() => {
      let k = 0;
      for (const id of caseIds) {
        const c = db.prepare('SELECT * FROM screening_cases WHERE id=?').get(+id);
        if (!c) continue;
        const snapshot = {
          case: c,
          remarks: db.prepare('SELECT * FROM screening_case_remarks WHERE case_id=? ORDER BY id').all(c.id),
          events: db.prepare('SELECT * FROM screening_case_events WHERE case_id=? ORDER BY id').all(c.id),
          heightened_monitoring: db.prepare('SELECT * FROM screening_case_hm WHERE case_id=?').get(c.id) || null,
          escalations: db.prepare('SELECT * FROM screening_case_escalations WHERE case_id=? ORDER BY id').all(c.id),
        };
        db.prepare('INSERT INTO screening_case_deletions (case_id,request_no,company,snapshot,reason,deleted_by) VALUES (?,?,?,?,?,?)')
          .run(c.id, c.request_no, c.company, JSON.stringify(snapshot), why, req.user.id);
        db.prepare('DELETE FROM screening_cases WHERE id=?').run(c.id); // remarks + events cascade
        k++;
      }
      return k;
    })();
    res.json({ deleted: n });
  });

  app.get('/api/cases/:id/history', auth, loadCase, (req, res) => {
    res.json(db.prepare(`SELECT e.*, f.name from_name, t.name to_name, b.name by_name FROM screening_case_events e
      LEFT JOIN users f ON f.id=e.from_user LEFT JOIN users t ON t.id=e.to_user LEFT JOIN users b ON b.id=e.by_user
      WHERE e.case_id=? ORDER BY e.id DESC`).all(req.scase.id));
  });

  /* remarks (append-only) */
  const listRemarks = (id) => db.prepare(`SELECT r.id, r.case_id, r.body, r.created_at, r.user_id, u.name user_name, u.role user_role, u.title user_title
    FROM screening_case_remarks r LEFT JOIN users u ON u.id=r.user_id WHERE r.case_id=? ORDER BY r.id`).all(id);
  app.get('/api/cases/:id/remarks', auth, loadCase, (req, res) => res.json(listRemarks(req.scase.id)));
  app.post('/api/cases/:id/remarks', auth, loadCase, (req, res) => {
    const body = String(req.body?.body ?? '').trim();
    if (!body) return res.status(400).json({ error: 'Remark cannot be empty' });
    if (body.length > REMARK_MAX) return res.status(400).json({ error: `Remark is too long (max ${REMARK_MAX} characters)` });
    addRemark(req.scase.id, req.user.id, body);
    db.prepare("UPDATE screening_cases SET updated_at=datetime('now') WHERE id=?").run(req.scase.id);
    res.status(201).json(listRemarks(req.scase.id));
  });
}
