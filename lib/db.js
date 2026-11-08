// Database access. Uses Supabase (or any PostgreSQL) when DATABASE_URL is set,
// otherwise an embedded local Postgres (PGlite) stored in data/db so the app runs with no setup.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

// Paths are resolved from the project folder (where you run `npm start`), so they also work when bundled by Next.js.
export const ROOT = process.env.TICKETFORGE_ROOT || process.cwd();
/** Serverless hosting (Vercel, AWS Lambda, Netlify): read-only app folder, no long-running processes. */
export const SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY || ROOT.startsWith('/var/task'));
// On serverless only the temporary folder is writable, and it doesn't last between requests.
export const DATA_DIR = process.env.TICKETFORGE_DATA ? path.resolve(process.env.TICKETFORGE_DATA)
  : SERVERLESS ? path.join(os.tmpdir(), 'ticketforge') : path.join(ROOT, 'data');

const G = globalThis.__ticketforgeDb ??= { impl: null, info: { kind: null, label: '', rls: null }, als: new AsyncLocalStorage(), owner: false };
G.als ??= new AsyncLocalStorage();
export const dbInfo = G.info;

// ---------------------------------------------------------------- row-level security context
// On PostgreSQL every query runs as the restricted role APP_ROLE with the signed-in user's id set, so the
// RLS policies (see setupRls) decide which rows it can see or change. Sign-in, invites and startup tasks
// run in "system" context. Scripts and migrations run as the table owner.
export const APP_ROLE = 'ticketforge_app';
/** extra: other request facts, e.g. { local } = the app was opened on this computer. */
export const asUser = (userId, fn, user, extra = {}) => G.als.run({ ...extra, userId: userId || '', user }, fn);
export const asSystem = (fn) => G.als.run({ system: true }, fn);
export const currentContext = () => G.als.getStore() || {};
export const useOwner = (on = true) => { G.owner = on; };
const rlsActive = () => dbInfo.kind === 'postgres' && Boolean(dbInfo.rls?.appRole) && !G.owner && process.env.TICKETFORGE_RLS !== 'off';
// Every statement runs inside a transaction that first sets the role and user *for that transaction only*
// (set_config(..., true)). Nothing is left on the connection, so this stays correct behind connection
// poolers in session or transaction mode (Supabase Supavisor on 5432 or 6543, PgBouncer). Owner mode sets
// the role back to the connecting user, in case a shared connection still carries one.
function beginSql(client) {
  let role = 'none', uid = '', sys = '';
  if (rlsActive()) { const c = currentContext(); role = APP_ROLE; uid = c.userId || ''; sys = c.system ? 'on' : ''; }
  const lit = (v) => client.escapeLiteral(String(v));
  return `begin; select set_config('role', ${lit(role)}, true), set_config('app.user_id', ${lit(uid)}, true), set_config('app.system', ${lit(sys)}, true)`;
}
async function inTx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query(beginSql(client));
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) { await client.query('rollback').catch(() => {}); throw e; }
  finally { client.release(); }
}
const POOL_HINT = 'Supabase limits how many connections the Session pooler (port 5432) accepts, and every running copy of '
  + 'TicketForge (and every db:push) uses some. Stop copies you don\'t need, lower PG_POOL_MAX (default 5), or switch '
  + 'DATABASE_URL to the Transaction pooler (port 6543), which TicketForge supports.';
const explain = (e) => {
  if (/EMAXCONNSESSION|max clients reached/i.test(e?.message || '')) e.message = `${e.message}. ${POOL_HINT}`;
  return e;
};

async function connect() {
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (url) {
    const { default: pg } = await import('pg');
    const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
    const local = /^(localhost|127\.0\.0\.1|::1)$/.test(host);
    const ssl = process.env.PGSSL === 'disable' || local ? false : { rejectUnauthorized: process.env.PGSSL === 'verify' };
    const pool = new pg.Pool({ connectionString: url, ssl, max: Number(process.env.PG_POOL_MAX) || 5, idleTimeoutMillis: 10000 });
    pool.on('error', (e) => console.error('Postgres pool error:', e.message));
    try {
      await pool.query('select 1');
    } catch (e) {
      if (e.code === 'ENOTFOUND' && /^db\.[a-z0-9]+\.supabase\.co$/i.test(host)) {
        throw new Error(`Can't reach ${host}. Supabase's direct connection is IPv6-only and your network doesn't support IPv6.\n`
          + 'Use the Session pooler string instead: Supabase → Project Settings → Database → Connection string → URI → "Session pooler" (port 5432),\n'
          + `e.g. postgresql://postgres.${host.split('.')[1]}:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`);
      }
      if (e.code === '28P01') throw new Error('The database rejected the password in DATABASE_URL. Check it (and URL-encode special characters such as @ # / as %40 %23 %2F).');
      throw explain(e);
    }
    dbInfo.kind = 'postgres';
    dbInfo.label = /supabase\.(co|com)/.test(host) ? `Supabase (${host})` : `PostgreSQL (${host})`;
    return {
      query: (sql, params) => inTx(pool, (client) => client.query(sql, params)).catch((e) => { throw explain(e); }),
      tx: (fn) => inTx(pool, (client) => fn({ query: (s, p) => client.query(s, p) })).catch((e) => { throw explain(e); }),
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = path.join(DATA_DIR, 'db');
  fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  dbInfo.kind = 'local';
  dbInfo.label = SERVERLESS ? 'Temporary local database (erased often on serverless hosting: set DATABASE_URL)' : 'Local database (data/db)';
  let chain = Promise.resolve();
  return {
    query: (sql, params) => db.query(sql, params),
    // PGlite is single-connection: serialise transactions.
    tx(fn) {
      const run = chain.then(() => db.transaction((t) => fn({ query: (s, p) => t.query(s, p) })));
      chain = run.catch(() => {});
      return run;
    },
    close: () => db.close(),
  };
}

export async function db() {
  G.impl ??= connect().catch((e) => { G.impl = null; throw e; });
  return G.impl;
}
export const q = async (sql, params) => (await db()).query(sql, params);
export const tx = async (fn) => (await db()).tx(fn);
/** Same as q / tx but in system context (sign-in system, startup). */
export const qs = (sql, params) => asSystem(() => q(sql, params));
export const txs = (fn) => asSystem(() => tx(fn));

const SCHEMA = `
create table if not exists roles (
  id text primary key,
  name text not null,
  description text not null default '',
  permissions jsonb not null default '[]',
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists users (
  id text primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  role_id text not null references roles(id),
  project_access jsonb not null default '"all"',
  is_owner boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create table if not exists sessions (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text not null default ''
);
create table if not exists invites (
  id text primary key,
  email text not null,
  name text not null default '',
  role_id text not null references roles(id),
  project_access jsonb not null default '"all"',
  message text not null default '',
  token_hash text not null unique,
  invited_by text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  emailed boolean not null default false
);
create table if not exists password_resets (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create table if not exists projects (
  id text primary key,
  name text not null,
  key text not null,
  data jsonb not null,
  version integer not null default 1,
  created_by text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists issues (
  project_id text not null references projects(id) on delete cascade,
  id text not null,
  position double precision not null default 0,
  data jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);
create index if not exists issues_project_pos on issues(project_id, position);
create table if not exists app_meta (
  key text primary key,
  value jsonb not null
);
create table if not exists notifications (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  project_id text,
  issue_id text,
  kind text not null,
  title text not null,
  body text not null default '',
  link text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user on notifications(user_id, created_at desc);
create table if not exists screenshots (
  id text primary key,
  project_id text not null,
  issue_id text,
  tc_id text not null,
  status text not null default 'Fail',
  error text not null default '',
  mime text not null default 'image/jpeg',
  bytes integer not null default 0,
  data bytea not null,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists screenshots_tc on screenshots(project_id, tc_id, created_at desc);
`;

export async function migrate() {
  const d = await db();
  const wasOwner = G.owner;
  G.owner = true;
  try {
    if (dbInfo.kind === 'postgres') await checkPrivileges(d);
    for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await d.query(stmt);
    if (dbInfo.kind === 'postgres') await setupRls(d);
  } finally { G.owner = wasOwner; }
}

/** Fails early with a fix when the database user can't create TicketForge's tables. */
async function checkPrivileges(d) {
  const r = (await d.query(`select current_user u, has_schema_privilege(current_user, 'public', 'CREATE') can_create,
    (select count(*)::int from pg_tables where schemaname = 'public' and tablename = any($1)) existing`, [TABLES])).rows[0];
  if (r.can_create) return;
  const who = r.u.replace(/"/g, '""');
  throw new Error(`permission denied for schema public: the database user "${r.u}" in DATABASE_URL can't create tables there `
    + `(${r.existing} of ${TABLES.length} TicketForge tables exist). Since PostgreSQL 15 only the database owner can, by default. Fix it as `
    + `the database owner or a superuser, e.g. psql "<admin connection>" -c 'ALTER DATABASE <db> OWNER TO "${who}"' `
    + `or -c 'GRANT CREATE ON SCHEMA public TO "${who}"'. On Supabase, connect as the postgres user (postgres.<project-ref> on the pooler).`);
}

// ---------------------------------------------------------------- RLS setup (PostgreSQL / Supabase)
const TABLES = ['roles', 'users', 'sessions', 'invites', 'password_resets', 'projects', 'issues', 'app_meta', 'notifications', 'screenshots'];
const FUNCS = ['tf_uid()', 'tf_system()', 'tf_can(text)', 'tf_access(text)'];

const LOCKDOWN_SQL = `
${TABLES.map((t) => `alter table ${t} enable row level security`).join(';\n')};
revoke all on table ${TABLES.join(', ')} from public;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table ${TABLES.join(', ')} from %I', r);
    end if;
  end loop;
end $$`;

const POLICY_SQL = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = '${APP_ROLE}') then
    create role ${APP_ROLE} nologin nosuperuser nobypassrls noinherit;
  end if;
end $$;
grant ${APP_ROLE} to current_user;
grant usage on schema public to ${APP_ROLE};
grant select, insert, update, delete on table ${TABLES.join(', ')} to ${APP_ROLE};

create or replace function tf_uid() returns text language sql stable set search_path = public
  as $f$ select nullif(current_setting('app.user_id', true), '') $f$;
create or replace function tf_system() returns boolean language sql stable set search_path = public
  as $f$ select coalesce(current_setting('app.system', true), '') = 'on' $f$;
create or replace function tf_can(perm text) returns boolean language sql stable security definer set search_path = public
  as $f$ select exists (select 1 from users u join roles r on r.id = u.role_id
         where u.id = tf_uid() and u.status = 'active' and (u.is_owner or r.permissions ? perm)) $f$;
create or replace function tf_access(pid text) returns boolean language sql stable security definer set search_path = public
  as $f$ select exists (select 1 from users u where u.id = tf_uid() and u.status = 'active'
         and (u.is_owner or u.project_access = '"all"'::jsonb or u.project_access ? pid))
      or exists (select 1 from projects p where p.id = pid and p.created_by is not null and p.created_by = tf_uid()) $f$;
revoke all on function ${FUNCS.join(', ')} from public;
grant execute on function ${FUNCS.join(', ')} to ${APP_ROLE};
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function ${FUNCS.join(', ')} from %I', r);
    end if;
  end loop;
end $$;

${TABLES.map((t) => `do $$ declare p record; begin for p in select policyname from pg_policies where schemaname = current_schema() and tablename = '${t}' and policyname like 'tf\\_%' loop execute format('drop policy %I on ${t}', p.policyname); end loop; end $$`).join(';\n')};

create policy tf_select on users for select to ${APP_ROLE} using (tf_system() or tf_uid() is not null);
create policy tf_write on users for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_select on roles for select to ${APP_ROLE} using (tf_system() or tf_uid() is not null);
create policy tf_write on roles for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on sessions for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on invites for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on password_resets for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on app_meta for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_select on projects for select to ${APP_ROLE} using (tf_system() or tf_access(id) or tf_can('users.manage'));
create policy tf_insert on projects for insert to ${APP_ROLE} with check (tf_system() or tf_can('project.create'));
create policy tf_update on projects for update to ${APP_ROLE} using (tf_system() or tf_access(id)) with check (tf_system() or tf_access(id));
create policy tf_delete on projects for delete to ${APP_ROLE} using (tf_system() or (tf_access(id) and tf_can('project.delete')));
create policy tf_all on issues for all to ${APP_ROLE} using (tf_system() or tf_access(project_id)) with check (tf_system() or tf_access(project_id));
create policy tf_all on screenshots for all to ${APP_ROLE} using (tf_system() or tf_access(project_id)) with check (tf_system() or tf_access(project_id));
create policy tf_select on notifications for select to ${APP_ROLE} using (tf_system() or user_id = tf_uid());
create policy tf_insert on notifications for insert to ${APP_ROLE} with check (tf_system() or tf_uid() is not null);
create policy tf_update on notifications for update to ${APP_ROLE} using (tf_system() or user_id = tf_uid()) with check (tf_system() or user_id = tf_uid());
create policy tf_delete on notifications for delete to ${APP_ROLE} using (tf_system() or user_id = tf_uid())`;

/**
 * 1) Lock down: RLS on every table, nothing for PUBLIC / Supabase's anon & authenticated roles (so the
 *    Supabase REST API and anon key can't read or write anything).
 * 2) Policies for the app role, scoped to the signed-in user. If step 2 fails the app keeps running as the
 *    owner, and step 1 still protects the data.
 */
async function setupRls(d) {
  const info = { enabled: false, appRole: null, tables: TABLES.length, error: null };
  if (process.env.TICKETFORGE_RLS === 'off') { info.error = 'Disabled with TICKETFORGE_RLS=off'; dbInfo.rls = info; return; }
  try {
    await d.tx(async (t) => { await t.query(LOCKDOWN_SQL); });
    info.enabled = true;
  } catch (e) {
    info.error = `Could not enable RLS: ${e.message}`;
    console.error(info.error);
    dbInfo.rls = info;
    return;
  }
  try {
    await d.tx(async (t) => { await t.query(POLICY_SQL); });
    info.appRole = APP_ROLE;
  } catch (e) {
    info.error = `RLS is on, but the per-user policies could not be set up, so the app runs as the table owner: ${e.message}`;
    console.error(info.error);
  }
  dbInfo.rls = info;
}
