// Moves TicketForge's data from one PostgreSQL host to another, and proves the copy is complete.
// Full procedure: docs/postgres-host-migration.md.
//
//   SOURCE_DATABASE_URL   the host the app uses now (default: DATABASE_URL)
//   TARGET_DATABASE_URL   the host to move to
//   SOURCE_PGSSL / TARGET_PGSSL   SSL mode per side (default: PGSSL, then ?sslmode= of each URL)
//
//   npm run db:migrate-host -- copy      create the tables on the target and copy every row. Safe while the app is in use,
//                                        and repeatable: rows already there are updated only when they differ.
//   npm run db:migrate-host -- verify    compare row counts and checksums of every table (a report is written)
//   npm run db:migrate-host -- cutover   the final step: hold writes on the source, copy the last changes (and remove rows
//                                        deleted since), verify, then mark the source "moved". Stops and re-opens the source
//                                        when anything doesn't match. Add --keep-hold to keep writes on hold until `finish`.
//   npm run db:migrate-host -- finish    mark the source "moved" (after `cutover --keep-hold`)
//   npm run db:migrate-host -- release   re-open the source for writes (abort a cutover, or reuse the old host later)
//
// The source is only ever read, apart from the cutover marker in its app_meta table. Nothing is changed when either
// connection string is wrong or unreachable: both are checked before the first write.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { checkConnectionString, endpointOf, pgConfig, connectTimeoutMs, databaseUrl, hostOf } from '../lib/db-config';
import { TABLES, CUTOVER_KEY, FENCE_POLL_MS, DATA_DIR, connectionFailure, useOwner, migrate, dbInfo } from '../lib/db';

const [cmd = '', ...flags] = process.argv.slice(2);
const KEEP_HOLD = flags.includes('--keep-hold');
const SKIP_DRAIN = flags.includes('--skip-drain');
const DRAIN_MAX_MS = 60000;

const sourceUrl = (process.env.SOURCE_DATABASE_URL || databaseUrl()).trim();
const targetUrl = (process.env.TARGET_DATABASE_URL || '').trim();
const fail = (msg: string): never => { console.error(`\n${msg}\n`); process.exit(1); };

const qi = (s: string) => `"${s.replace(/"/g, '""')}"`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (msg: string) => console.log(msg);

/** Rows that belong to the move itself, not to the data: never copied and never compared. */
const FILTER: Record<string, string> = { app_meta: `key <> '${CUTOVER_KEY}'` };
const where = (table: string) => (FILTER[table] ? ` where ${FILTER[table]}` : '');
/** Tables with large binary columns: smaller batches keep memory low. */
const BIG = new Set(['files', 'screenshots', 'drive_docs', 'code_jobs']);

type Client = any; // a node-postgres client
type Side = { name: 'source' | 'target'; url: string; env: Record<string, string | undefined>; client?: Client };
const source: Side = { name: 'source', url: sourceUrl, env: { ...process.env, PGSSL: process.env.SOURCE_PGSSL ?? process.env.PGSSL } };
const target: Side = { name: 'target', url: targetUrl, env: { ...process.env, PGSSL: process.env.TARGET_PGSSL ?? process.env.PGSSL } };

/** Opens a connection that behaves like the app's own writer (versions and rows are copied as they are, not re-numbered). */
async function open(side: Side) {
  const { connectionString, ssl } = pgConfig(side.url, side.env);
  const c = new pg.Client({ connectionString, ssl, connectionTimeoutMillis: connectTimeoutMs(), application_name: 'ticketforge-migrate' });
  c.on('error', (e) => console.error(`${side.name} connection error: ${e.message}`));
  try { await c.connect(); } catch (e) { throw new Error(`The ${side.name} database: ${connectionFailure(e, endpointOf(side.url)).message}`); }
  await c.query(`select set_config('TimeZone', 'UTC', false), set_config('app.writer', '2', false), set_config('app.system', 'on', false)`);
  side.client = c;
  return c;
}

function checkConfig(needTarget: boolean) {
  if (!sourceUrl) fail('Set SOURCE_DATABASE_URL (or DATABASE_URL) to the PostgreSQL host the app uses now.');
  checkConnectionString(sourceUrl, 'SOURCE_DATABASE_URL');
  if (!needTarget) return;
  if (!targetUrl) fail('Set TARGET_DATABASE_URL to the PostgreSQL host you are moving to.');
  checkConnectionString(targetUrl, 'TARGET_DATABASE_URL');
  const key = (u: string) => { const x = new URL(u); return `${x.hostname}:${x.port || 5432}${x.pathname}`.toLowerCase(); };
  if (key(sourceUrl) === key(targetUrl)) fail('SOURCE_DATABASE_URL and TARGET_DATABASE_URL point at the same database. Nothing to move.');
}

// ---------------------------------------------------------------- table facts
type Info = { all: string[]; cols: string[]; pk: string[] };
async function infoOf(c: Client, table: string): Promise<Info | null> {
  const cols = (await c.query(`select column_name, is_generated from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [table])).rows;
  if (!cols.length) return null;
  const pk = (await c.query(`select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = $1::regclass and i.indisprimary order by array_position(i.indkey::int2[], a.attnum)`, [qi(table)])).rows.map((r) => r.attname);
  return { all: cols.map((r) => r.column_name), cols: cols.filter((r) => r.is_generated !== 'ALWAYS').map((r) => r.column_name), pk };
}

/** Parents before the tables that refer to them, so foreign keys hold while rows are copied. */
async function insertOrder(c: Client) {
  const fks = (await c.query(`select conrelid::regclass::text child, confrelid::regclass::text parent from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace`)).rows;
  const deps = new Map<string, Set<string>>(TABLES.map((t) => [t, new Set<string>()]));
  for (const { child, parent } of fks) if (child !== parent && deps.has(child) && deps.has(parent)) deps.get(child)!.add(parent);
  const out: string[] = [], left = new Set(TABLES);
  while (left.size) {
    const ready = TABLES.filter((t) => left.has(t) && [...deps.get(t)!].every((d) => !left.has(d)));
    if (!ready.length) { out.push(...left); break; }
    for (const t of ready) { out.push(t); left.delete(t); }
  }
  return out;
}

// ---------------------------------------------------------------- copy
/** Reads a table from the source (inside one consistent snapshot) in batches and upserts each batch into the target. */
async function copyTable(table: string, from: Info, to: Info) {
  const src = source.client!, dst = target.client!;
  if (!to.pk.length) throw new Error(`Table ${table} has no primary key on the target, so it can't be copied safely.`);
  const cols = to.cols.filter((c) => from.all.includes(c));
  const list = cols.map(qi).join(', ');
  const data = cols.filter((c) => !to.pk.includes(c));
  const upsert = `insert into ${qi(table)} as t (${list}) select ${list} from jsonb_populate_recordset(null::${qi(table)}, $1::jsonb)
    on conflict (${to.pk.map(qi).join(', ')}) ` + (data.length
    ? `do update set ${data.map((c) => `${qi(c)} = excluded.${qi(c)}`).join(', ')}
       where (${data.map((c) => `t.${qi(c)}`).join(', ')}) is distinct from (${data.map((c) => `excluded.${qi(c)}`).join(', ')})`
    : 'do nothing');
  const batch = BIG.has(table) ? 10 : 500;
  let seen = 0, written = 0;
  await src.query(`declare tf_copy no scroll cursor for select to_jsonb(t)::text as j from ${qi(table)} t${where(table)}`);
  try {
    for (;;) {
      const { rows } = await src.query(`fetch ${batch} from tf_copy`);
      if (!rows.length) break;
      seen += rows.length;
      written += (await dst.query(upsert, [`[${rows.map((r) => r.j).join(',')}]`])).rowCount || 0;
    }
  } finally { await src.query('close tf_copy').catch(() => {}); }
  return { seen, written };
}

/** Removes rows from the target that no longer exist on the source (deleted since an earlier copy). */
async function pruneTable(table: string, to: Info) {
  const src = source.client!, dst = target.client!;
  const key = `concat_ws(chr(31), ${to.pk.map((c) => `${qi(c)}::text`).join(', ')})`;
  await dst.query('create temp table if not exists tf_keys (kv text primary key)');
  await dst.query('truncate tf_keys');
  await src.query(`declare tf_keys_cur no scroll cursor for select ${key} as k from ${qi(table)}${where(table)}`);
  try {
    for (;;) {
      const { rows } = await src.query('fetch 5000 from tf_keys_cur');
      if (!rows.length) break;
      await dst.query('insert into tf_keys select * from jsonb_array_elements_text($1::jsonb) on conflict do nothing', [JSON.stringify(rows.map((r) => r.k))]);
    }
  } finally { await src.query('close tf_keys_cur').catch(() => {}); }
  const filter = FILTER[table] ? ` and ${FILTER[table]}` : '';
  return (await dst.query(`delete from ${qi(table)} where not exists (select 1 from tf_keys x where x.kv = ${key})${filter}`)).rowCount || 0;
}

/** Serial columns on the target continue after the highest copied id. */
async function fixSequences(table: string, to: Info) {
  const dst = target.client!;
  for (const col of to.all) {
    const seq = (await dst.query('select pg_get_serial_sequence($1, $2) s', [qi(table), col])).rows[0]?.s;
    if (seq) await dst.query(`select setval($1::regclass, coalesce((select max(${qi(col)}) from ${qi(table)}), 1), (select max(${qi(col)}) is not null from ${qi(table)}))`, [seq]);
  }
}

/** Creates the tables, policies and triggers on the target exactly as the app would on first start. */
async function prepareTarget() {
  process.env.DATABASE_URL = target.url;
  delete process.env.SUPABASE_DB_URL;
  if (target.env.PGSSL !== undefined) process.env.PGSSL = target.env.PGSSL; else delete process.env.PGSSL;
  useOwner(true);
  await migrate();
  log(`Target tables ready on ${dbInfo.label}.`);
}

async function copyAll({ prune }: { prune: boolean }) {
  const src = source.client!, dst = target.client!;
  const order = await insertOrder(dst);
  await src.query('begin isolation level repeatable read read only'); // one snapshot for every table
  try {
    const have = new Set((await src.query(`select tablename from pg_tables where schemaname = 'public'`)).rows.map((r) => r.tablename));
    const infos = new Map<string, { from: Info; to: Info }>();
    for (const t of order) {
      if (!have.has(t)) { log(`${t}: not on the source, skipped`); continue; }
      const [from, to] = [await infoOf(src, t), await infoOf(dst, t)];
      if (!from || !to) { log(`${t}: not on the ${from ? 'target' : 'source'}, skipped`); continue; }
      infos.set(t, { from, to });
    }
    for (const t of order) {
      const i = infos.get(t);
      if (!i) continue;
      const r = await copyTable(t, i.from, i.to);
      await fixSequences(t, i.to);
      log(`${t}: ${r.seen} rows read, ${r.written} written`);
    }
    if (prune) {
      for (const t of [...order].reverse()) {
        const i = infos.get(t);
        if (!i) continue;
        const n = await pruneTable(t, i.to);
        if (n) log(`${t}: ${n} rows removed (deleted on the source since the last copy)`);
      }
    }
  } finally { await src.query('rollback').catch(() => {}); }
}

// ---------------------------------------------------------------- verify
type Row = { table: string; sourceRows: string; targetRows: string; sourceChecksum: string; targetChecksum: string; ok: boolean };
/** Row count and an order-independent checksum (sum of a 64-bit hash of each row as JSON, so column order doesn't matter). */
async function fingerprint(c: Client, table: string, skip: string[]) {
  const r = (await c.query(`select count(*)::text n, coalesce(sum(('x' || substr(md5((to_jsonb(t) - $1::text[])::text), 1, 16))::bit(64)::bigint::numeric), 0)::text h from ${qi(table)} t${where(table)}`, [skip])).rows[0];
  return { rows: r.n as string, checksum: r.h as string };
}
async function verifyAll() {
  const src = source.client!, dst = target.client!;
  const rows: Row[] = [];
  for (const table of await insertOrder(dst)) {
    const [from, to] = [await infoOf(src, table), await infoOf(dst, table)];
    if (!from || !to) { rows.push({ table, sourceRows: from ? '' : 'missing', targetRows: to ? '' : 'missing', sourceChecksum: '', targetChecksum: '', ok: !from && !to }); continue; }
    const common = from.all.filter((c) => to.all.includes(c));
    const [a, b] = [await fingerprint(src, table, from.all.filter((c) => !common.includes(c))), await fingerprint(dst, table, to.all.filter((c) => !common.includes(c)))];
    rows.push({ table, sourceRows: a.rows, targetRows: b.rows, sourceChecksum: a.checksum, targetChecksum: b.checksum, ok: a.rows === b.rows && a.checksum === b.checksum });
  }
  return rows;
}
function report(mode: string, rows: Row[]) {
  const ok = rows.every((r) => r.ok);
  const dir = path.join(DATA_DIR, 'migration-reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `db-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ mode, at: new Date().toISOString(), source: endpointOf(sourceUrl), target: endpointOf(targetUrl), ok, tables: rows }, null, 2));
  console.table(rows.map((r) => ({ table: r.table, 'source rows': r.sourceRows, 'target rows': r.targetRows, 'source checksum': r.sourceChecksum, 'target checksum': r.targetChecksum, match: r.ok ? 'yes' : 'NO' })));
  log(ok ? `All ${rows.length} tables match (row counts and checksums). Report: ${file}` : `MISMATCH in: ${rows.filter((r) => !r.ok).map((r) => r.table).join(', ')}. Report: ${file}`);
  return ok;
}

// ---------------------------------------------------------------- the cutover marker on the source
async function setFence(state: 'hold' | 'moved' | 'open') {
  const c = source.client!;
  if (state === 'open') await c.query('delete from app_meta where key = $1', [CUTOVER_KEY]);
  else await c.query(`insert into app_meta (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`,
    [CUTOVER_KEY, JSON.stringify({ state, at: new Date().toISOString(), to: hostOf(targetUrl) })]);
}

/** Waits until every server has seen the hold and the writes that started before it have finished. */
async function drain() {
  const c = source.client!;
  const since = (await c.query('select clock_timestamp()::text t')).rows[0].t;
  if (FENCE_POLL_MS) await sleep(FENCE_POLL_MS * 2 + 500);
  if (SKIP_DRAIN) return;
  const t0 = Date.now();
  for (;;) {
    const n = (await c.query(`select count(*)::int n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()
      and backend_type = 'client backend' and xact_start is not null and xact_start < $1::timestamptz and state <> 'idle'`, [since])).rows[0].n;
    if (!n) return;
    if (Date.now() - t0 > DRAIN_MAX_MS) throw new Error(`${n} transaction(s) on the source were still running after ${DRAIN_MAX_MS / 1000}s. Check what keeps them open, or run again with --skip-drain if they are not TicketForge.`);
    await sleep(500);
  }
}

// ---------------------------------------------------------------- commands
async function main() {
  if (!['copy', 'verify', 'cutover', 'finish', 'release'].includes(cmd)) {
    fail('Usage: npm run db:migrate-host -- copy | verify | cutover [--keep-hold] [--skip-drain] | finish | release\nSee docs/postgres-host-migration.md.');
  }
  const needTarget = cmd !== 'release' && cmd !== 'finish';
  checkConfig(needTarget);
  // Both ends are checked before anything is written.
  await open(source);
  if (needTarget) await open(target);
  log(`Source: ${endpointOf(sourceUrl)}${needTarget ? `\nTarget: ${endpointOf(targetUrl)}` : ''}`);

  if (cmd === 'release') { await setFence('open'); log('The source accepts writes again.'); return; }
  if (cmd === 'finish') { await setFence('moved'); log('The source is marked "moved": servers still on it refuse writes (the browser retries them on the new host).'); return; }

  if (cmd === 'verify') { if (!report('verify', await verifyAll())) process.exitCode = 1; return; }

  await prepareTarget();
  if (cmd === 'copy') {
    await copyAll({ prune: false });
    log('Copied. Run it again to catch up, then `cutover`. (`verify` shows differences while the app is still in use.)');
    return;
  }

  // cutover
  log('Holding writes on the source...');
  await setFence('hold');
  try {
    await drain();
    log('Copying the last changes...');
    await copyAll({ prune: true });
    const rows = await verifyAll();
    if (!report('cutover', rows)) throw new Error('The target does not match the source, so the cutover was stopped. Nothing was lost: the source accepts writes again.');
  } catch (e) {
    await setFence('open').catch((x) => console.error(`Could not re-open the source: ${x.message}. Run \`npm run db:migrate-host -- release\`.`));
    throw e;
  }
  if (KEEP_HOLD) { log('Verified. Writes stay on hold on the source (servers wait up to 30 s, then answer with a retryable error). Switch to the new host now, then run `finish`.'); return; }
  await setFence('moved');
  log('Verified. The source is marked "moved". Send traffic to the servers that use the new host now.');
}

main().then(
  async () => { await Promise.allSettled([source.client?.end(), target.client?.end()]); process.exit(process.exitCode || 0); },
  async (e) => { console.error(`\n${e.message}\n`); await Promise.allSettled([source.client?.end(), target.client?.end()]); process.exit(1); },
);
