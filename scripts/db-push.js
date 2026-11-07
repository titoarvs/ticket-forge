// Copies everything from the local database (data/db) to the database in DATABASE_URL (e.g. Supabase).
// Rows that already exist there are left alone. Usage: set DATABASE_URL in .env, then `npm run db:push`.
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { migrate, q, dbInfo, DATA_DIR } from '../lib/db.js';

const localDir = path.join(DATA_DIR, 'db');
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) { console.error('Set DATABASE_URL (your Supabase connection string) in .env first.'); process.exit(1); }
if (!fs.existsSync(localDir)) { console.error('No local database found in data/db.'); process.exit(1); }

const TABLES = [
  ['roles', ['permissions']], ['users', ['project_access']], ['projects', ['data']], ['issues', ['data']],
  ['invites', ['project_access']], ['password_resets', []], ['app_meta', ['value']],
];

await migrate();
console.log(`Target: ${dbInfo.label}`);
const local = new PGlite(localDir);
for (const [table, jsonCols] of TABLES) {
  const { rows } = await local.query(`select * from ${table}`);
  let copied = 0;
  for (const row of rows) {
    const cols = Object.keys(row);
    const vals = cols.map((c) => (jsonCols.includes(c) ? JSON.stringify(row[c]) : row[c]));
    const res = await q(`insert into ${table} (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) on conflict do nothing`, vals);
    copied += res.rowCount || 0;
  }
  console.log(`${table}: ${copied} of ${rows.length} rows copied`);
}
await local.close();
console.log('Done. Restart TicketForge to use the new database.');
process.exit(0);
