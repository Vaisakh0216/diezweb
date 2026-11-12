// MongoDB data layer.
// Collections mirror the former SQLite tables (users, uploads, edd_cases, case_events, case_remarks, screening_cases,
// screening_case_events, screening_case_remarks, screening_case_hm, screening_case_escalations, screening_case_deletions).
// Every document keeps a numeric `id` (also used as `_id`), generated from the `counters` collection, so URLs and the
// API stay exactly as before. Timestamps are UTC strings "YYYY-MM-DD HH:MM:SS".
import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';
import { TEAM, APP_TYPES, BUS } from './terms.js';

export const COLLECTIONS = ['users', 'uploads', 'edd_cases', 'case_events', 'case_remarks', 'screening_cases', 'screening_case_events',
  'screening_case_remarks', 'screening_case_hm', 'screening_case_escalations', 'screening_case_deletions'];

let client;
let database;
/** connection state for /api/health and the "database unavailable" answer */
export const dbState = { ready: false, error: null, attempts: 0 };

/** Database name: MONGODB_DB, else the name in MONGODB_URI, else "diez_aml". */
export function dbNameFrom(uri) {
  if (process.env.MONGODB_DB) return process.env.MONGODB_DB;
  const m = String(uri || '').match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/);
  return m?.[1] || 'diez_aml';
}

export const col = (name) => database.collection(name);
/** current time as the app stores it: UTC "YYYY-MM-DD HH:MM:SS" */
export const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
/** document without Mongo's _id (the API exposes `id`) */
export const strip = (d) => { if (!d) return d; const { _id, ...rest } = d; return rest; };

/** next numeric id for a collection */
export async function nextId(name) {
  const r = await col('counters').findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  return r.seq;
}
/** insert with a new numeric id; returns the id */
export async function insert(name, doc) {
  const id = await nextId(name);
  await col(name).insertOne({ _id: id, id, ...doc });
  return id;
}

/** plain-language reason for a failed connection */
export function explainDbError(e) {
  const m = String(e?.message || e);
  if (/MONGODB_URI is not set/.test(m)) return m;
  if (/tlsv1 alert|SSL alert number 80|Server selection timed out|ETIMEDOUT/i.test(m))
    return 'MongoDB Atlas refused the connection: add this server to Atlas → Network Access (e.g. 0.0.0.0/0).';
  if (/ENOTFOUND|querySrv/i.test(m)) return 'MongoDB cluster address not found: check the host in MONGODB_URI.';
  if (/auth|bad auth|Authentication failed/i.test(m)) return 'MongoDB rejected the username/password in MONGODB_URI (Atlas → Database Access).';
  return `MongoDB connection failed: ${m}`;
}

export async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set (server/.env locally, Environment variables on Hostinger).');
  dbState.attempts++;
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  database = client.db(dbNameFrom(uri));

  // indexes (unique keys the app relies on)
  await col('users').createIndex({ email: 1 }, { unique: true });
  await col('edd_cases').createIndex({ bu: 1, request_no: 1 }, { unique: true });
  await col('edd_cases').createIndex({ assigned_to: 1, edd_status: 1 });
  await col('screening_cases').createIndex({ request_no: 1 }, { unique: true });
  await col('screening_cases').createIndex({ assigned_to: 1, status: 1 });
  for (const c of ['case_events', 'case_remarks', 'screening_case_events', 'screening_case_remarks', 'screening_case_escalations'])
    await col(c).createIndex({ case_id: 1, id: 1 });

  // counters never fall behind existing ids (e.g. after seeding from SQLite)
  for (const name of COLLECTIONS) {
    const top = await col(name).find({}, { projection: { id: 1 } }).sort({ id: -1 }).limit(1).next();
    if (top?.id) await col('counters').updateOne({ _id: name }, { $max: { seq: top.id } }, { upsert: true });
  }

  // first start on an empty database: demo team (change these passwords after the first sign-in)
  if (!(await col('users').findOne({}))) {
    const tmp = bcrypt.hashSync('Welcome@123', 10);
    const base = { aliases: '', status: 'active', created_at: now() };
    await insert('users', { ...base, name: 'Administrator', email: 'admin@edd.local', password_hash: bcrypt.hashSync('admin123', 10), role: 'admin',
      title: 'Assistant Director', duties: APP_TYPES, bus: BUS, escalation_manager: 0 });
    for (const t of TEAM) {
      await insert('users', { ...base, name: t.name, email: t.email, password_hash: tmp, role: t.role, title: t.title, duties: t.duties, bus: t.bus,
        aliases: t.aliases, escalation_manager: t.role === 'admin' && ['yaser@edd.local', 'raneem@edd.local'].includes(t.email) ? 1 : 0 });
    }
    console.log('Seeded admin@edd.local / admin123 and team (<firstname>@edd.local / Welcome@123)');
  }
  dbState.ready = true; dbState.error = null;
  console.log(`MongoDB connected: database "${database.databaseName}"`);
  return database;
}
