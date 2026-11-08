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
`);

if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const ins = db.prepare('INSERT INTO users (name,email,password_hash,role,title,duties,bus,aliases) VALUES (?,?,?,?,?,?,?,?)');
  const tmp = bcrypt.hashSync('Welcome@123', 10);
  ins.run('Administrator', 'admin@edd.local', bcrypt.hashSync('admin123', 10), 'admin', 'Assistant Director', JSON.stringify(APP_TYPES), JSON.stringify(BUS), '');
  for (const t of TEAM) ins.run(t.name, t.email, tmp, t.role, t.title, JSON.stringify(t.duties), JSON.stringify(t.bus), t.aliases);
  console.log('Seeded admin@edd.local / admin123 and team (<firstname>@edd.local / Welcome@123)');
}

export default db;
