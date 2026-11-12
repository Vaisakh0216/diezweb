// Check the MongoDB connection settings without printing the password.
//   npm run check:mongo                      uses MONGODB_URI from server/.env
//   MONGODB_URI="mongodb+srv://..." npm run check:mongo   test another value (e.g. the one set on Hostinger)
import { MongoClient } from 'mongodb';
import { dbNameFrom, explainDbError, prepareDns } from './db.js';

const raw = process.env.MONGODB_URI ?? '';
const problems = [];
const ok = (s) => console.log(`  ✓ ${s}`);
const warn = (s) => { problems.push(s); console.log(`  ✗ ${s}`); };

console.log('MONGODB_URI');
if (!raw) { warn('MONGODB_URI is empty'); process.exit(1); }
if (/^\s|\s$/.test(raw)) warn('has spaces at the start or end: remove them');
if (/^["']|["']$/.test(raw.trim())) warn('is wrapped in quotes: on Hostinger, paste the value without quotes');
const uri = raw.trim().replace(/^["']|["']$/g, '');
const m = uri.match(/^(mongodb(?:\+srv)?):\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^/?]+)(\/[^?]*)?(\?.*)?$/);
if (!m) warn('does not look like mongodb+srv://USER:PASSWORD@HOST/DATABASE?options');
else {
  const [, scheme, user, pass = '', host, path = '', query = ''] = m;
  ok(`scheme   ${scheme}`);
  user ? ok(`user     ${decodeURIComponent(user)}`) : warn('no username before the password');
  if ((uri.match(/@/g) || []).length > 1) warn('contains more than one "@": an "@" inside the password must be written as %40, and there must be only one "@" before the host');
  if (!pass) warn('no password after the username');
  else {
    const decoded = (() => { try { return decodeURIComponent(pass); } catch { return pass; } })();
    console.log(`  · password ${decoded.length} characters (not shown)`);
    if (/<|>|db_password|password>/i.test(pass)) warn('password still contains the placeholder from Atlas (<db_password>): replace it with the real password, without < >');
    if (/[:/?#[\]@!$&'()*+,;=% ]/.test(pass) && !/%[0-9A-F]{2}/i.test(pass)) warn('password has special characters that must be URL-encoded (simplest: reset it to letters and digits only)');
  }
  ok(`host     ${host}`);
  ok(`database ${dbNameFrom(uri)}${process.env.MONGODB_DB ? ' (from MONGODB_DB)' : ''}${path && path !== '/' ? `  · path in URI: ${path}` : ''}`);
  if (/authSource=(?!admin)/i.test(query)) warn('authSource is not "admin": Atlas users sign in against admin, remove authSource from the URI');
}

console.log('\nConnecting…');
let client;
try {
  await prepareDns(uri);
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  await client.db('admin').command({ ping: 1 });
  ok('connected and signed in');
} catch (e) {
  warn(explainDbError(e));
  if (/auth/i.test(e.message)) {
    console.log(`
  "bad auth" means Atlas reached your cluster but does not accept this user/password. Check in Atlas:
   1. Database Access (in the SAME project as this cluster) lists the user exactly as above.
   2. Edit the user → Edit Password → set a new password (letters and digits), Update User,
      wait ~1 minute, then put that password in MONGODB_URI.
   3. Authentication Method is "Password" (SCRAM), and the user has a role such as "Read and write to any database".`);
  }
} finally { await client?.close(); }
process.exitCode = problems.length ? 1 : 0;
