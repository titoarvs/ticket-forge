// Switches TicketForge between its hosted database (Supabase) and PostgreSQL on this computer, for
// when the hosted free plan is full, and back again later. All the data moves along: db:migrate-host
// copies it, checks every table, and freezes the side left behind ("moved") so nothing is written
// there by mistake. The deployed site keeps showing data but can't save until you move back.
//
//   npm run db:switch -- status   which database the app uses, how full it is, what is saved
//   npm run db:switch -- local    copy everything to local PostgreSQL, freeze the hosted one,
//                                 point .env at local
//   npm run db:switch -- hosted   copy everything back, re-open the hosted one, freeze local,
//                                 point .env back
//   Add --skip-drain when the cutover waits on transactions that aren't TicketForge's.
//
//   LOCAL_DATABASE_URL    the local database (default postgresql://<you>@localhost:5432/ticketforge,
//                         created when missing)
//   HOSTED_DATABASE_URL   saved by `local`: where `hosted` moves back to
// .env is copied to .env.before-db-switch before it changes. Restart `npm run dev` afterwards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { checkConnectionString, databaseUrl, endpointOf, pgConfig } from '../lib/db-config';
import { kindOf, usageOf, mb } from '../lib/db-usage';

const CUTOVER_KEY = 'db_cutover'; // lib/db/connection.ts
const ENV_FILE = process.env.DB_SWITCH_ENV_FILE || path.join(process.cwd(), '.env'); // override: tests
const MIGRATE_HOST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'db-migrate-host.ts');
const [cmd = '', ...flags] = process.argv.slice(2);

const log = (msg: string) => console.log(msg);
const fail = (msg: string): never => {
  console.error(`\n${msg}\n`);
  process.exit(1);
};

/** host:port/database, to tell whether two addresses are the same database. */
const dbKey = (url: string) => {
  const u = new URL(url);
  return `${u.hostname}:${u.port || 5432}${u.pathname}`.toLowerCase();
};

const localUrl = () =>
  (process.env.LOCAL_DATABASE_URL || '').trim() ||
  `postgresql://${encodeURIComponent(os.userInfo().username)}@localhost:5432/ticketforge`;

// ---------------------------------------------------------------- connections
async function connect(url: string, database?: string) {
  const { connectionString, ssl } = pgConfig(url);
  const u = new URL(connectionString);
  if (database) u.pathname = `/${database}`;
  const c = new pg.Client({ connectionString: u.toString(), ssl, connectionTimeoutMillis: 10000 });
  await c.connect();
  return c;
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>, database?: string) {
  const c = await connect(url, database);
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Creates the local database when it isn't there yet (from the server's `postgres` database). */
async function ensureLocalDatabase(url: string) {
  const name = decodeURIComponent(new URL(url).pathname.slice(1)) || 'ticketforge';
  await withClient(
    url,
    async (c) => {
      const found = (await c.query('select 1 from pg_database where datname = $1', [name]))
        .rowCount;
      if (found) return;
      await c.query(`create database "${name.replace(/"/g, '""')}"`);
      log(`Created the local database "${name}".`);
    },
    'postgres',
  );
}

/** The freeze marker of a database: 'open', 'hold' or 'moved'. */
const fenceOf = (url: string) =>
  withClient(url, async (c) => {
    if (!(await c.query("select to_regclass('public.app_meta') t")).rows[0].t) return 'open';
    const r = await c.query('select value from app_meta where key = $1', [CUTOVER_KEY]);
    return String(r.rows[0]?.value?.state || 'open');
  });

/** Removes the freeze marker, so the app can write there again. */
const reopen = (url: string) =>
  withClient(url, async (c) => {
    if ((await c.query("select to_regclass('public.app_meta') t")).rows[0].t)
      await c.query('delete from app_meta where key = $1', [CUTOVER_KEY]);
  });

const sizeOf = (url: string) =>
  withClient(url, async (c) =>
    Number((await c.query('select pg_database_size(current_database()) n')).rows[0].n),
  );

// ---------------------------------------------------------------- moving the data
/** Runs `db:migrate-host <step>` from `source` to `target`; true when it succeeded. */
function migrateHost(step: string, source: string, target: string, extra: Record<string, string>) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', MIGRATE_HOST, step, ...flags], {
    stdio: 'inherit',
    env: { ...process.env, ...extra, SOURCE_DATABASE_URL: source, TARGET_DATABASE_URL: target },
  });
  return r.status === 0;
}

/**
 * Copies everything and freezes the source. A source that can't be frozen (Supabase turns a full
 * free-plan database read-only) can't take writes anyway: then a clean `verify` is enough. `extra`:
 * environment for the migration tool.
 */
function move(source: string, target: string, extra: Record<string, string> = {}) {
  const step = (name: string) => migrateHost(name, source, target, extra);
  if (!step('copy')) fail('The copy failed (see above). Nothing was switched.');
  if (step('cutover')) return true;
  log('\nThe cutover could not freeze the source. Checking the copy instead…');
  if (!step('verify'))
    fail('The copy does not match the source (see above). Nothing was switched; run it again.');
  return false;
}

/** Connections other than ours: TicketForge servers (or anything else) still on the database. */
const othersOn = (url: string) =>
  withClient(url, async (c) => {
    const r = await c.query(
      `select count(*)::int n from pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'`,
    );
    return Number(r.rows[0].n);
  });

// ---------------------------------------------------------------- .env
/** Sets KEY=value lines in .env (a copy of the old file is kept first). */
function setEnv(values: Record<string, string>) {
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  fs.writeFileSync(`${ENV_FILE}.before-db-switch`, text, { mode: 0o600 });
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, () => line) : `${text.replace(/\n*$/, '\n')}${line}\n`;
  }
  fs.writeFileSync(ENV_FILE, text, { mode: 0o600 });
}

// ---------------------------------------------------------------- commands
async function status() {
  const url = databaseUrl();
  const kind = kindOf(url);
  const names = {
    supabase: 'Supabase',
    local: 'PostgreSQL on this computer',
    other: 'PostgreSQL',
    builtin: 'the built-in database',
  };
  log(`Database in use: ${names[kind]}${url ? ` (${endpointOf(url)})` : ''}`);
  if (!url) return;
  const u = usageOf(kind, await sizeOf(url));
  const share = u.percent != null ? ` (${u.percent}% of the 500 MB free plan)` : '';
  log(`Size: ${mb(u.sizeBytes)}${share}`);
  log(`Writes: ${(await fenceOf(url)) === 'open' ? 'open' : 'frozen (moved)'}`);
  const hosted = (process.env.HOSTED_DATABASE_URL || '').trim();
  if (kind === 'local')
    log(hosted ? 'Move back with: npm run db:switch -- hosted' : 'No HOSTED_DATABASE_URL saved.');
  else if (u.nearLimit) log('Near the free plan limit: npm run db:switch -- local');
}

async function toLocal() {
  const current = databaseUrl();
  if (!current)
    fail(
      'The app uses the built-in database (no DATABASE_URL): there is no hosted one to move from.',
    );
  const local = localUrl();
  checkConnectionString(local, 'LOCAL_DATABASE_URL');
  if (dbKey(current) === dbKey(local))
    fail('The app already uses the local database. Move back with: npm run db:switch -- hosted');
  log(`Moving from ${endpointOf(current)} to ${endpointOf(local)}…`);
  await ensureLocalDatabase(local);
  await reopen(local); // a local database frozen by an earlier move back
  const frozen = move(current, local);
  setEnv({ DATABASE_URL: local, HOSTED_DATABASE_URL: current, LOCAL_DATABASE_URL: local });
  log(
    `\nDone: .env now points at the local database (the hosted address is saved as HOSTED_DATABASE_URL).` +
      `${frozen ? ' The hosted database is frozen: the deployed site shows data but can’t save.' : ''}` +
      '\nRestart `npm run dev`. Move back later with: npm run db:switch -- hosted',
  );
}

async function toHosted() {
  const current = databaseUrl();
  const hosted = (process.env.HOSTED_DATABASE_URL || '').trim();
  if (!hosted) fail('No HOSTED_DATABASE_URL in .env: set it to your Supabase connection string.');
  checkConnectionString(hosted, 'HOSTED_DATABASE_URL');
  if (!current || dbKey(current) === dbKey(hosted))
    fail('The app already uses the hosted database, so there is nothing to move back.');
  log(`Moving from ${endpointOf(current)} back to ${endpointOf(hosted)}…`);
  log('(Supabase needs room for the data: upgrade the plan or free space there first.)');
  // The hosted database stays frozen while it is filled, so the deployed site can't write into a
  // half-copied database; it is re-opened once the copy is verified. The migration tool itself must
  // write there, so its own freeze check is off; that also skips its wait for servers on the local
  // database, so none may be running.
  const open = await othersOn(current);
  if (open)
    fail(
      `Stop TicketForge (npm run dev) first: ${open} other connection(s) are open on the local database.`,
    );
  move(current, hosted, { TICKETFORGE_CUTOVER_POLL_MS: '0' });
  await reopen(hosted);
  setEnv({ DATABASE_URL: hosted });
  log(
    '\nDone: .env points at the hosted database again, and it accepts writes. The local database is frozen.' +
      '\nRestart `npm run dev` (and redeploy if the deployed site needs it).',
  );
}

const COMMANDS: Record<string, () => Promise<void>> = {
  status,
  local: toLocal,
  hosted: toHosted,
};

const run = COMMANDS[cmd];
if (!run) fail('Usage: npm run db:switch -- status | local | hosted [--skip-drain]');
run().then(
  () => process.exit(0),
  (e) => fail(e.message),
);
