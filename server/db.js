import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';

export const DUTIES = ['License Renewal', 'Test1', 'Test2', 'Test3', 'Others'];

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
  duties TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','on_leave')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  date_from TEXT, date_to TEXT,
  duty_column TEXT, date_column TEXT,
  total_rows INTEGER, matched_rows INTEGER, skipped_rows INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS edd_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id INTEGER REFERENCES uploads(id),
  duty TEXT NOT NULL,
  record_date TEXT,
  data TEXT NOT NULL,
  assigned_to INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES edd_cases(id),
  from_user INTEGER, to_user INTEGER NOT NULL,
  reason TEXT, by_user INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const adminExists = db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get();
if (!adminExists) {
  db.prepare('INSERT INTO users (name,email,password_hash,role,duties) VALUES (?,?,?,?,?)')
    .run('Administrator', 'admin@edd.local', bcrypt.hashSync('admin123', 10), 'admin', JSON.stringify(DUTIES));
  console.log('Seeded admin: admin@edd.local / admin123');
}

export default db;
