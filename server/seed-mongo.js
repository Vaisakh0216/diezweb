// Copy the data from the old SQLite database (server/edd.db) into MongoDB: one collection per table.
// Documents get exactly the shape the app uses (numeric `id`, also as `_id`; timestamps as text).
//
//   npm run seed:mongo -- --dry-run   show what would be copied (no connection to MongoDB)
//   npm run seed:mongo -- --drop      empty each collection first, then copy (use this for the first copy)
//   npm run seed:mongo                upsert by id (re-runnable: same id -> replaced, no duplicates)
//
// Reads MONGODB_URI / MONGODB_DB (see db.js) and DB_PATH (old SQLite file; default server/edd.db) from server/.env.
// SQLite is opened read-only.
import Database from 'better-sqlite3';
import { MongoClient } from 'mongodb';
import { fileURLToPath } from 'node:url';
import { dbNameFrom } from './db.js';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const DROP = args.has('--drop');

const DB_PATH = process.env.DB_PATH || fileURLToPath(new URL('./edd.db', import.meta.url));
const sqlite = new Database(DB_PATH, { readonly: true, fileMustExist: true });

// columns stored as JSON text in SQLite -> real arrays/objects in MongoDB
const JSON_COLS = { users: ['duties', 'bus'], uploads: ['stats'], edd_cases: ['root_causes', 'data'], screening_case_deletions: ['snapshot'] };
// tables without an "id" column: the key used as _id
const KEY = { screening_case_hm: 'case_id' };
// legacy tables kept in SQLite only for history
const SKIP = new Set(['module_cases', 'module_case_events', 'module_case_remarks']);

function toDoc(table, row) {
  const doc = { _id: row[KEY[table] || 'id'], ...row };
  for (const k of JSON_COLS[table] || []) { try { doc[k] = row[k] == null ? null : JSON.parse(row[k]); } catch { /* keep text */ } }
  return doc;
}

const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map((t) => t.name).filter((t) => !SKIP.has(t));

console.log(`SQLite: ${DB_PATH}`);
if (DRY) {
  for (const t of tables) {
    const rows = sqlite.prepare(`SELECT * FROM ${t}`).all();
    console.log(`  ${t.padEnd(28)} ${String(rows.length).padStart(5)} documents`);
  }
  const sample = sqlite.prepare('SELECT * FROM users LIMIT 1').get();
  if (sample) console.log('\nSample (users):', JSON.stringify(toDoc('users', { ...sample, password_hash: '<hidden>' })));
  console.log('\nDry run: nothing was written.');
  process.exit(0);
}

const URI = process.env.MONGODB_URI;
if (!URI) { console.error('MONGODB_URI is not set (server/.env).'); process.exit(1); }
const client = new MongoClient(URI, { serverSelectionTimeoutMS: 15000 });
try {
  await client.connect();
  const dbName = dbNameFrom(URI);
  const target = client.db(dbName);
  console.log(`MongoDB: database "${dbName}"${DROP ? ' (collections emptied first)' : ''}`);
  for (const t of tables) {
    const docs = sqlite.prepare(`SELECT * FROM ${t}`).all().map((r) => toDoc(t, r));
    const col = target.collection(t);
    if (DROP) await col.deleteMany({});
    if (docs.length) {
      await col.bulkWrite(docs.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })), { ordered: false });
    }
    console.log(`  ${t.padEnd(28)} ${String(docs.length).padStart(5)} documents`);
    // new records continue after the copied ids
    const max = Math.max(0, ...docs.map((d) => d.id || 0));
    if (max) await target.collection('counters').updateOne({ _id: t }, { $max: { seq: max } }, { upsert: true });
  }
  // indexes the app's lookups would use
  await target.collection('users').createIndex({ email: 1 }, { unique: true });
  await target.collection('edd_cases').createIndex({ bu: 1, request_no: 1 }, { unique: true });
  await target.collection('edd_cases').createIndex({ assigned_to: 1, edd_status: 1 });
  await target.collection('screening_cases').createIndex({ request_no: 1 }, { unique: true });
  await target.collection('screening_cases').createIndex({ assigned_to: 1, status: 1 });
  for (const c of ['case_events', 'case_remarks', 'screening_case_events', 'screening_case_remarks', 'screening_case_escalations'])
    await target.collection(c).createIndex({ case_id: 1 });
  console.log('Done.');
} catch (e) {
  console.error('Seeding failed:', e.message);
  if (/ENOTFOUND|querySrv/.test(e.message)) console.error('Check the cluster address in MONGODB_URI.');
  if (/auth/i.test(e.message)) console.error('Check the username/password in MONGODB_URI (Atlas → Database Access).');
  if (/timed out|Server selection/i.test(e.message)) console.error('Allow this computer’s IP in Atlas → Network Access.');
  process.exitCode = 1;
} finally {
  await client.close();
}
