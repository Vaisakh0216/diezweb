import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import * as XLSX from 'xlsx';
import db, { DUTIES } from './db.js';

const app = express();
const PORT = process.env.PORT || 4000;
const SECRET = process.env.JWT_SECRET || 'edd-dev-secret-change-me';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

/* ---------------- helpers ---------------- */
const publicUser = (u) => u && ({
  id: u.id, name: u.name, email: u.email, role: u.role,
  duties: JSON.parse(u.duties || '[]'), status: u.status, created_at: u.created_at,
});

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    const { id } = jwt.verify(token, SECRET);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!u) throw new Error();
    req.user = publicUser(u);
    next();
  } catch { res.status(401).json({ error: 'Unauthorized' }); }
}
const adminOnly = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' });

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function normalizeDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return fmt(v);
  if (typeof v === 'number') { // Excel serial
    const p = XLSX.SSF.parse_date_code(v);
    return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/); // DD-MM-YYYY (day first)
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    let d = +m[1], mo = +m[2];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  const d = new Date(s);
  return isNaN(d) ? null : fmt(d);
}

function matchDuty(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase().replace(/[\s_-]+/g, '');
  return DUTIES.find((d) => d.toLowerCase().replace(/[\s_-]+/g, '') === s) || null;
}

function parseFile(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { rows, headers };
}

const guess = (headers, patterns) =>
  patterns.map((p) => headers.find((h) => p.test(h))).find(Boolean) || '';
const guessDuty = (h) => guess(h, [/^duty$/i, /duty/i, /category/i, /^type$/i, /type/i, /service/i]);
const guessDate = (h) => guess(h, [/^date$/i, /application.?date/i, /created.?date/i, /date/i]);

const serializeRow = (rows) => rows.map((r) => {
  const o = {};
  for (const [k, v] of Object.entries(r)) o[k] = v instanceof Date ? fmt(v) : v;
  return o;
});

/* ---------------- auth ---------------- */
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').toLowerCase().trim());
  if (!u || !bcrypt.compareSync(password || '', u.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });
  res.json({ token: jwt.sign({ id: u.id }, SECRET, { expiresIn: '12h' }), user: publicUser(u) });
});
app.get('/api/auth/me', auth, (req, res) => res.json(req.user));
app.get('/api/meta', (req, res) => res.json({ duties: DUTIES }));

/* ---------------- users ---------------- */
// All authenticated users can list users (needed for transfer target picker)
app.get('/api/users', auth, (req, res) => {
  const list = db.prepare('SELECT * FROM users ORDER BY role, name').all().map(publicUser);
  const counts = Object.fromEntries(db.prepare(
    "SELECT assigned_to, COUNT(*) c FROM edd_cases WHERE status!='Completed' GROUP BY assigned_to").all()
    .map((r) => [r.assigned_to, r.c]));
  res.json(list.map((u) => ({ ...u, open_cases: counts[u.id] || 0 })));
});

function validateUser(body, isNew) {
  const { name, email, password, role, duties } = body;
  if (!name?.trim()) return 'Name is required';
  if (!/^\S+@\S+\.\S+$/.test(email || '')) return 'Valid email is required';
  if (isNew && (!password || password.length < 6)) return 'Password must be at least 6 characters';
  if (!['admin', 'user'].includes(role)) return 'Invalid role';
  if (!Array.isArray(duties) || duties.some((d) => !DUTIES.includes(d))) return 'Invalid duties';
  return null;
}

app.post('/api/users', auth, adminOnly, (req, res) => {
  const err = validateUser(req.body, true);
  if (err) return res.status(400).json({ error: err });
  const { name, email, password, role, duties, status = 'active' } = req.body;
  try {
    const r = db.prepare('INSERT INTO users (name,email,password_hash,role,duties,status) VALUES (?,?,?,?,?,?)')
      .run(name.trim(), email.toLowerCase().trim(), bcrypt.hashSync(password, 10), role, JSON.stringify(duties), status);
    res.status(201).json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid)));
  } catch (e) {
    res.status(400).json({ error: e.message.includes('UNIQUE') ? 'Email already exists' : e.message });
  }
});

app.put('/api/users/:id', auth, adminOnly, (req, res) => {
  const err = validateUser(req.body, false);
  if (err) return res.status(400).json({ error: err });
  const { name, email, password, role, duties, status = 'active' } = req.body;
  const id = +req.params.id;
  try {
    db.prepare('UPDATE users SET name=?, email=?, role=?, duties=?, status=? WHERE id=?')
      .run(name.trim(), email.toLowerCase().trim(), role, JSON.stringify(duties), status, id);
    if (password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), id);
    res.json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)));
  } catch (e) {
    res.status(400).json({ error: e.message.includes('UNIQUE') ? 'Email already exists' : e.message });
  }
});

app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  const id = +req.params.id;
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself' });
  const open = db.prepare("SELECT COUNT(*) c FROM edd_cases WHERE assigned_to=? AND status!='Completed'").get(id).c;
  if (open) return res.status(400).json({ error: `User has ${open} open case(s). Transfer them first.` });
  db.prepare('UPDATE edd_cases SET assigned_to=NULL WHERE assigned_to=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ ok: true });
});

/* ---------------- EDD: upload ---------------- */
app.post('/api/edd/preview', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const { rows, headers } = parseFile(req.file.buffer);
    res.json({
      headers, total: rows.length, sample: serializeRow(rows.slice(0, 5)),
      dutyColumn: guessDuty(headers), dateColumn: guessDate(headers),
    });
  } catch (e) { res.status(400).json({ error: 'Could not parse file: ' + e.message }); }
});

app.post('/api/edd/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { dateFrom, dateTo } = req.body;
  if (!dateFrom || !dateTo) return res.status(400).json({ error: 'Date range is required' });
  if (dateFrom > dateTo) return res.status(400).json({ error: 'From date must be before To date' });

  let parsed;
  try { parsed = parseFile(req.file.buffer); }
  catch (e) { return res.status(400).json({ error: 'Could not parse file: ' + e.message }); }
  const { rows, headers } = parsed;
  const dutyColumn = req.body.dutyColumn || guessDuty(headers);
  const dateColumn = req.body.dateColumn || guessDate(headers);
  if (!headers.includes(dutyColumn)) return res.status(400).json({ error: 'Duty column not found in file' });
  if (!headers.includes(dateColumn)) return res.status(400).json({ error: 'Date column not found in file' });

  // Eligible assignees per duty
  const active = db.prepare("SELECT * FROM users WHERE status='active'").all().map(publicUser);
  const pool = {};
  for (const d of DUTIES) {
    pool[d] = req.user.role === 'admin'
      ? active.filter((u) => u.role === 'user' && u.duties.includes(d))
      : (req.user.duties.includes(d) ? [req.user] : []);
  }
  // Round robin starts with least-loaded user
  const load = Object.fromEntries(db.prepare(
    "SELECT assigned_to, COUNT(*) c FROM edd_cases WHERE status!='Completed' GROUP BY assigned_to").all()
    .map((r) => [r.assigned_to, r.c]));
  for (const d of DUTIES) pool[d].sort((a, b) => (load[a.id] || 0) - (load[b.id] || 0));
  const rr = Object.fromEntries(DUTIES.map((d) => [d, 0]));

  const stats = { total: rows.length, outOfRange: 0, noDate: 0, noDutyMatch: 0, notYourDuty: 0, matched: 0, unassigned: 0, perUser: {}, perDuty: {} };
  const toInsert = [];
  for (const row of serializeRow(rows)) {
    const date = normalizeDate(row[dateColumn]);
    if (!date) { stats.noDate++; continue; }
    if (date < dateFrom || date > dateTo) { stats.outOfRange++; continue; }
    const duty = matchDuty(row[dutyColumn]);
    if (!duty) { stats.noDutyMatch++; continue; }
    const p = pool[duty];
    if (req.user.role !== 'admin' && !p.length) { stats.notYourDuty++; continue; }
    let assignee = null;
    if (p.length) { assignee = p[rr[duty] % p.length]; rr[duty]++; }
    else stats.unassigned++;
    stats.matched++;
    stats.perDuty[duty] = (stats.perDuty[duty] || 0) + 1;
    if (assignee) stats.perUser[assignee.name] = (stats.perUser[assignee.name] || 0) + 1;
    toInsert.push({ duty, date, row, assignee: assignee?.id ?? null });
  }

  const tx = db.transaction(() => {
    const up = db.prepare(`INSERT INTO uploads (filename,uploaded_by,date_from,date_to,duty_column,date_column,total_rows,matched_rows,skipped_rows)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(req.file.originalname, req.user.id, dateFrom, dateTo, dutyColumn, dateColumn,
      stats.total, stats.matched, stats.total - stats.matched);
    const ins = db.prepare('INSERT INTO edd_cases (upload_id,duty,record_date,data,assigned_to) VALUES (?,?,?,?,?)');
    for (const r of toInsert) ins.run(up.lastInsertRowid, r.duty, r.date, JSON.stringify(r.row), r.assignee);
    return up.lastInsertRowid;
  });
  const uploadId = tx();
  res.json({ uploadId, dutyColumn, dateColumn, ...stats });
});

app.get('/api/edd/uploads', auth, (req, res) => {
  const where = req.user.role === 'admin' ? '' : 'WHERE u.uploaded_by = ' + req.user.id;
  res.json(db.prepare(`SELECT u.*, us.name uploaded_by_name FROM uploads u LEFT JOIN users us ON us.id=u.uploaded_by ${where} ORDER BY u.id DESC LIMIT 50`).all());
});

/* ---------------- EDD: cases ---------------- */
const CASE_SELECT = `SELECT c.*, u.name assigned_name, u.email assigned_email
  FROM edd_cases c LEFT JOIN users u ON u.id=c.assigned_to`;
const mapCase = (c) => ({ ...c, data: JSON.parse(c.data) });

function caseQuery(q, extraWhere = [], params = []) {
  const where = [...extraWhere];
  const p = [...params];
  if (q.duty) { where.push('c.duty=?'); p.push(q.duty); }
  if (q.status) { where.push('c.status=?'); p.push(q.status); }
  if (q.assignee) {
    if (q.assignee === 'unassigned') where.push('c.assigned_to IS NULL');
    else { where.push('c.assigned_to=?'); p.push(+q.assignee); }
  }
  if (q.from) { where.push('c.record_date>=?'); p.push(q.from); }
  if (q.to) { where.push('c.record_date<=?'); p.push(q.to); }
  if (q.search) { where.push('(c.data LIKE ? OR u.name LIKE ?)'); p.push(`%${q.search}%`, `%${q.search}%`); }
  const sql = `${CASE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.record_date DESC, c.id DESC`;
  return db.prepare(sql).all(...p).map(mapCase);
}

app.get('/api/edd/my-cases', auth, (req, res) => {
  res.json(caseQuery(req.query, ['c.assigned_to=?'], [req.user.id]));
});

// Master data: read-only view of everything, for every user
app.get('/api/edd/master', auth, (req, res) => res.json(caseQuery(req.query)));

app.get('/api/edd/stats', auth, (req, res) => {
  const mine = db.prepare('SELECT status, COUNT(*) c FROM edd_cases WHERE assigned_to=? GROUP BY status').all(req.user.id);
  const all = db.prepare('SELECT status, COUNT(*) c FROM edd_cases GROUP BY status').all();
  const unassigned = db.prepare('SELECT COUNT(*) c FROM edd_cases WHERE assigned_to IS NULL').get().c;
  res.json({ mine, all, unassigned });
});

const STATUSES = ['Pending', 'In Progress', 'Completed'];
app.patch('/api/edd/cases/:id', auth, (req, res) => {
  const c = db.prepare('SELECT * FROM edd_cases WHERE id=?').get(+req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  if (req.user.role !== 'admin' && c.assigned_to !== req.user.id) return res.status(403).json({ error: 'Not your case' });
  if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare("UPDATE edd_cases SET status=?, updated_at=datetime('now') WHERE id=?").run(req.body.status, c.id);
  res.json({ ok: true });
});

app.post('/api/edd/cases/transfer', auth, (req, res) => {
  const { caseIds, toUserId, reason } = req.body || {};
  if (!Array.isArray(caseIds) || !caseIds.length) return res.status(400).json({ error: 'No cases selected' });
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(+toUserId);
  if (!target) return res.status(400).json({ error: 'Target user not found' });
  if (target.status !== 'active') return res.status(400).json({ error: 'Target user is on leave' });

  const tx = db.transaction(() => {
    let n = 0;
    for (const id of caseIds) {
      const c = db.prepare('SELECT * FROM edd_cases WHERE id=?').get(+id);
      if (!c) continue;
      if (req.user.role !== 'admin' && c.assigned_to !== req.user.id) throw new Error(`Case #${id} is not yours`);
      if (c.assigned_to === target.id) continue;
      db.prepare("UPDATE edd_cases SET assigned_to=?, updated_at=datetime('now') WHERE id=?").run(target.id, c.id);
      db.prepare('INSERT INTO transfers (case_id,from_user,to_user,reason,by_user) VALUES (?,?,?,?,?)')
        .run(c.id, c.assigned_to, target.id, reason || '', req.user.id);
      n++;
    }
    return n;
  });
  try { res.json({ transferred: tx() }); }
  catch (e) { res.status(403).json({ error: e.message }); }
});

app.get('/api/edd/cases/:id/history', auth, (req, res) => {
  res.json(db.prepare(`SELECT t.*, f.name from_name, tu.name to_name, b.name by_name FROM transfers t
    LEFT JOIN users f ON f.id=t.from_user LEFT JOIN users tu ON tu.id=t.to_user LEFT JOIN users b ON b.id=t.by_user
    WHERE t.case_id=? ORDER BY t.id DESC`).all(+req.params.id));
});

app.listen(PORT, () => console.log(`EDD API running on http://localhost:${PORT}`));
