import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { TEAM, APP_TYPES, BUS } from './terms.js';

const db = new Database(fileURLToPath(new URL('./edd.db', import.meta.url)));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','user')),
  title TEXT,
  duties TEXT NOT NULL DEFAULT '[]',   -- application types
  bus TEXT NOT NULL DEFAULT '[]',      -- business units
  aliases TEXT NOT NULL DEFAULT '',    -- Salesforce owner names, comma separated
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','on_leave')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  system TEXT,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  date_from TEXT, date_to TEXT,
  stats TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS edd_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id INTEGER REFERENCES uploads(id),
  system TEXT NOT NULL,
  bu TEXT NOT NULL,
  request_no TEXT NOT NULL,
  company TEXT,
  created_date TEXT,
  record_type TEXT,
  app_type TEXT NOT NULL,
  owner_name TEXT,
  assigned_to INTEGER REFERENCES users(id),
  risk_rating TEXT,
  root_causes TEXT NOT NULL DEFAULT '[]',
  edd_status TEXT,                     -- NULL = in work queue
  status_at TEXT,
  resubmission_count INTEGER NOT NULL DEFAULT 0,
  resubmitted_at TEXT,
  is_history INTEGER NOT NULL DEFAULT 0,
  closed_date TEXT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(bu, request_no)
);
CREATE TABLE IF NOT EXISTS case_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES edd_cases(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                  -- created | resubmitted | status | transfer | history
  detail TEXT,
  from_user INTEGER, to_user INTEGER,
  by_user INTEGER,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Officer/admin findings & discussion per case. Append-only (audit trail).
CREATE TABLE IF NOT EXISTS case_remarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES edd_cases(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_case_remarks_case ON case_remarks(case_id, id);

-- Screening cases. Admin creates (company + service request + assignee), uncategorised.
-- The officer completes the review; the case is then categorised into a module
-- (true-match | heightened-monitoring | red-flag | sar).
CREATE TABLE IF NOT EXISTS screening_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_no TEXT NOT NULL UNIQUE,
  company TEXT NOT NULL,
  module TEXT,                         -- NULL = not yet categorised
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  app_type TEXT,
  wc_reference TEXT,
  matched_party TEXT,
  alert_category TEXT,
  status TEXT NOT NULL DEFAULT 'Under Review',
  alert_result TEXT,
  false_reason TEXT,                   -- required when status = False
  escalated_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  escalated_at TEXT,
  categorised_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_screening_cases_assignee ON screening_cases(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_screening_cases_module ON screening_cases(module, status);
CREATE TABLE IF NOT EXISTS screening_case_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES screening_cases(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                  -- created | assigned | updated | status | escalated | categorised
  detail TEXT,
  from_user INTEGER, to_user INTEGER,
  by_user INTEGER,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS screening_case_remarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES screening_cases(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_screening_case_remarks_case ON screening_case_remarks(case_id, id);
-- Extra details captured when a case is categorised as Heightened Monitoring.
-- company / alert_category / investigator are stored as they were at that moment.
CREATE TABLE IF NOT EXISTS screening_case_hm (
  case_id INTEGER PRIMARY KEY REFERENCES screening_cases(id) ON DELETE CASCADE,
  hm_date TEXT NOT NULL DEFAULT (datetime('now')),
  bu TEXT NOT NULL,
  company TEXT NOT NULL,
  alert_category TEXT,
  crime_details TEXT NOT NULL,
  investigator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  investigator_name TEXT,
  notify_template TEXT NOT NULL,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Audit trail for deleted cases: full snapshot (case + remarks + activity) and who/why.
CREATE TABLE IF NOT EXISTS screening_case_deletions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  request_no TEXT NOT NULL,
  company TEXT,
  snapshot TEXT NOT NULL,
  reason TEXT NOT NULL,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// One-time migration from the first version (module_cases: module required, old status list).
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='module_cases'").get()) {
  db.transaction(() => {
    db.exec(`
      INSERT OR IGNORE INTO screening_cases (id,request_no,company,module,assigned_to,app_type,wc_reference,matched_party,alert_category,
        status,alert_result,created_by,assigned_at,created_at,updated_at)
      SELECT id,request_no,company,module,assigned_to,app_type,wc_reference,matched_party,alert_category,
        CASE status WHEN 'Escalated' THEN 'Escalate to Manager' ELSE 'Under Review' END,
        CASE alert_result WHEN 'False Positive' THEN 'False Match' WHEN 'Inconclusive' THEN 'Possible' ELSE alert_result END,
        created_by,assigned_at,created_at,updated_at
      FROM module_cases;
      INSERT OR IGNORE INTO screening_case_events (id,case_id,type,detail,from_user,to_user,by_user,at)
        SELECT id,case_id,type,detail,from_user,to_user,by_user,at FROM module_case_events WHERE case_id IN (SELECT id FROM screening_cases);
      INSERT OR IGNORE INTO screening_case_remarks (id,case_id,user_id,body,created_at)
        SELECT id,case_id,user_id,body,created_at FROM module_case_remarks WHERE case_id IN (SELECT id FROM screening_cases);
      DROP TABLE module_case_remarks; DROP TABLE module_case_events; DROP TABLE module_cases;
    `);
  })();
  console.log('Migrated module_cases -> screening_cases');
}

if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const ins = db.prepare('INSERT INTO users (name,email,password_hash,role,title,duties,bus,aliases) VALUES (?,?,?,?,?,?,?,?)');
  const tmp = bcrypt.hashSync('Welcome@123', 10);
  ins.run('Administrator', 'admin@edd.local', bcrypt.hashSync('admin123', 10), 'admin', 'Assistant Director', JSON.stringify(APP_TYPES), JSON.stringify(BUS), '');
  for (const t of TEAM) ins.run(t.name, t.email, tmp, t.role, t.title, JSON.stringify(t.duties), JSON.stringify(t.bus), t.aliases);
  console.log('Seeded admin@edd.local / admin123 and team (<firstname>@edd.local / Welcome@123)');
}

// One row per escalation to a manager, shown inside the case.
// Officer: escalates + investigator recommendation. Manager: findings + manager recommendation (required).
// Officer then records True Match / False (decision, decided_*).
const ESCALATIONS_SQL = `CREATE TABLE screening_case_escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES screening_cases(id) ON DELETE CASCADE,
  escalated_at TEXT NOT NULL,
  escalated_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  escalated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  bu TEXT,
  company TEXT NOT NULL,
  alert_category TEXT,
  investigator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  investigator_name TEXT,
  investigator_rec TEXT NOT NULL,
  investigator_rec_other TEXT,
  findings TEXT,
  manager_rec TEXT,
  manager_rec_other TEXT,
  manager_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  manager_at TEXT,
  decision TEXT,
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT
)`;
const escCols = db.prepare('PRAGMA table_info(screening_case_escalations)').all();
if (!escCols.length) db.exec(ESCALATIONS_SQL);
else if (!escCols.some((c) => c.name === 'manager_at')) {
  // first version required BU/findings from the officer: rebuild, keeping any rows
  db.transaction(() => {
    db.exec('ALTER TABLE screening_case_escalations RENAME TO screening_case_escalations_v1');
    db.exec(ESCALATIONS_SQL);
    db.exec(`INSERT INTO screening_case_escalations (id,case_id,escalated_at,escalated_to,escalated_by,bu,company,alert_category,investigator_id,
      investigator_name,investigator_rec,investigator_rec_other,findings,manager_rec,manager_rec_other,manager_by,manager_at,decision,decided_by,decided_at)
      SELECT id,case_id,escalated_at,escalated_to,escalated_by,bu,company,alert_category,investigator_id,investigator_name,investigator_rec,
      investigator_rec_other,findings,manager_rec,manager_rec_other,decided_by,decided_at,decision,decided_by,decided_at FROM screening_case_escalations_v1`);
    db.exec('DROP TABLE screening_case_escalations_v1');
  })();
}
db.exec('CREATE INDEX IF NOT EXISTS idx_escalations_case ON screening_case_escalations(case_id, id)');

// BU of a screening case: entered by the officer in the review (backfilled from HM/escalation or the request prefix).
if (!db.prepare('PRAGMA table_info(screening_cases)').all().some((c) => c.name === 'bu')) {
  db.transaction(() => {
    db.exec('ALTER TABLE screening_cases ADD COLUMN bu TEXT');
    db.exec(`UPDATE screening_cases SET bu = COALESCE(
      (SELECT bu FROM screening_case_hm h WHERE h.case_id=screening_cases.id),
      (SELECT bu FROM screening_case_escalations e WHERE e.case_id=screening_cases.id AND e.bu IS NOT NULL ORDER BY e.id DESC LIMIT 1))`);
    const set = db.prepare('UPDATE screening_cases SET bu=? WHERE id=?');
    for (const r of db.prepare('SELECT id, request_no FROM screening_cases WHERE bu IS NULL').all()) {
      const b = BUS.find((x) => String(r.request_no).toUpperCase().startsWith(`${x}-`));
      if (b) set.run(b, r.id);
    }
  })();
}

// "No further action" action plan: the officer's reason for closing the case.
if (!db.prepare('PRAGMA table_info(screening_cases)').all().some((c) => c.name === 'nfa_reason')) {
  db.exec('ALTER TABLE screening_cases ADD COLUMN nfa_reason TEXT');
}

// Escalation report: the "Notify inspection team" message written by the officer.
if (!db.prepare('PRAGMA table_info(screening_case_escalations)').all().some((c) => c.name === 'notify_template')) {
  db.exec('ALTER TABLE screening_case_escalations ADD COLUMN notify_template TEXT');
}

// Escalation managers: admins who receive "Escalate to Manager" cases (initially Yaser and Raneem).
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'escalation_manager')) {
  db.exec('ALTER TABLE users ADD COLUMN escalation_manager INTEGER NOT NULL DEFAULT 0');
  db.prepare("UPDATE users SET escalation_manager=1 WHERE role='admin' AND email IN ('yaser@edd.local','raneem@edd.local')").run();
}

export default db;
