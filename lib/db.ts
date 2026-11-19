// Database access. Uses any PostgreSQL host (settings in lib/db-config.ts) when DATABASE_URL is
// set, otherwise an embedded local Postgres (PGlite) stored in data/db so the app runs with no
// setup.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  databaseUrl,
  checkConnectionString,
  hostOf,
  endpointOf,
  pgConfig,
  connectTimeoutMs,
} from './db-config';

// Paths are resolved from the project folder (where you run `npm start`), so they also work when
// bundled by Next.js.
export const ROOT = process.env.TICKETFORGE_ROOT || process.cwd();
/**
 * Serverless hosting (Vercel, AWS Lambda, Netlify): read-only app folder, no long-running
 * processes.
 */
export const SERVERLESS = Boolean(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.NETLIFY ||
  ROOT.startsWith('/var/task'),
);
// On serverless only the temporary folder is writable, and it doesn't last between requests.
export const DATA_DIR = process.env.TICKETFORGE_DATA
  ? path.resolve(process.env.TICKETFORGE_DATA)
  : SERVERLESS
    ? path.join(os.tmpdir(), 'ticketforge')
    : path.join(ROOT, 'data');

const G = (globalThis.__ticketforgeDb ??= {
  impl: null,
  info: { kind: null, label: '', rls: null },
  als: new AsyncLocalStorage(),
  owner: false,
});
G.als ??= new AsyncLocalStorage();
export const dbInfo = G.info;

// ---------------------------------------------------------------- row-level security context On
// PostgreSQL every query runs as the restricted role APP_ROLE with the signed-in user's id set, so
// the RLS policies (see setupRls) decide which rows it can see or change. Sign-in, invites and
// startup tasks run in "system" context. Scripts and migrations run as the table owner.
export const APP_ROLE = 'ticketforge_app';
/** extra: other request facts, e.g. { local } = the app was opened on this computer. */
export const asUser = (userId, fn, user, extra: any = {}) =>
  G.als.run(
    { ...extra, userId: userId || '', user, ws: extra.ws ?? user?.workspace_id ?? null },
    fn,
  );
/**
 * System context keeps the request's workspace, so work done for a request stays inside that
 * company's data.
 */
export const asSystem = (fn) => G.als.run({ system: true, ws: currentWs() }, fn);
/**
 * System context for one workspace (sign-up, invites, background jobs that know their workspace).
 */
export const asWorkspace = (ws, fn) => G.als.run({ system: true, ws: ws || null }, fn);
export const currentContext = () => G.als.getStore() || {};
/** The workspace (company) the current request works in, or null outside one. */
export function currentWs() {
  const c = G.als.getStore() || {};
  return c.ws ?? c.user?.workspace_id ?? null;
}
/** The workspace every install starts with; data from before workspaces existed belongs to it. */
export const DEFAULT_WS = 'default';
export const useOwner = (on = true) => {
  G.owner = on;
};
const rlsActive = () =>
  dbInfo.kind === 'postgres' &&
  Boolean(dbInfo.rls?.appRole) &&
  !G.owner &&
  process.env.TICKETFORGE_RLS !== 'off';
// Every statement runs inside a transaction that first sets the role and user *for that transaction
// only* (set_config(..., true)). Nothing is left on the connection, so this stays correct behind
// connection poolers in session or transaction mode (Supabase Supavisor on 5432 or 6543,
// PgBouncer). Owner mode sets the role back to the connecting user, in case a shared connection
// still carries one.
function beginSql(client) {
  let role = 'none',
    uid = '',
    sys = '',
    ws = '';
  if (rlsActive()) {
    const c = currentContext();
    role = APP_ROLE;
    uid = c.userId || '';
    sys = c.system ? 'on' : '';
    ws = currentWs() || '';
  }
  const lit = (v) => client.escapeLiteral(String(v));
  // app.writer = 2: this version records issue and section versions itself (see SYNC_TRIGGERS).
  return `begin; select set_config('role', ${lit(role)}, true), set_config('app.user_id', ${lit(uid)}, true), set_config('app.system', ${lit(sys)}, true), set_config('app.workspace_id', ${lit(ws)}, true), set_config('app.writer', '2', true)`;
}
// TICKETFORGE_SQL_LOG=1 logs every statement with its time (for finding slow requests).
const SQL_LOG = process.env.TICKETFORGE_SQL_LOG === '1';
// Bumped whenever users, roles or sessions change, so cached sign-ins are dropped at once (see
// auth.js).
export const authGen = () => G.authGen || 0;
// Only changes that can affect a sign-in already cached count: new sessions, new users and the
// "last signed in" time don't, so thousands of people signing in don't keep emptying everyone's
// cached sign-in.
// The table name may be quoted: Drizzle writes `update "workspaces" set …`.
const AUTH_WRITE =
  /^\s*(update|delete\s+from)\s+"?(users|roles|sessions|workspace_members|workspaces)\b/i;
const AUTH_SKIP = [
  /^\s*update\s+users\s+set\s+last_login_at\s*=\s*now\(\)\s+where\s+id\s*=\s*\$1\s*$/i,
  // The expired-session sweep (auth.ts): a cached sign-in already stops at its session's expiry, so
  // nothing to drop.
  /^\s*delete\s+from\s+sessions\s+where\s+token_hash\s+in\s+\(select\s+token_hash\s+from\s+sessions\s+where\s+expires_at\s*<\s*now\(\)/i,
];
const noteWrite = (sql) => {
  const s = String(sql);
  if (AUTH_WRITE.test(s) && !AUTH_SKIP.some((re) => re.test(s))) G.authGen = (G.authGen || 0) + 1;
};

// Speed: a database far away (Supabase over the internet) costs a round trip per message. Instead
// of sending "begin + settings", then the statement, then "commit" (3 round trips), the values are
// written into the statement as quoted literals and all three go in one message. node-postgres
// sends parameters as untyped text too, so Postgres reads a quoted literal exactly as it would read
// the parameter.
let prepareValue = (v) => v;
function inline(client, sql, params) {
  if (!params?.length) return sql;
  return String(sql).replace(/\$(\d+)/g, (_, n) => {
    const v = prepareValue(params[Number(n) - 1]);
    if (v === null || v === undefined) return 'null';
    if (Buffer.isBuffer(v)) return client.escapeLiteral(`\\x${v.toString('hex')}`);
    return client.escapeLiteral(String(v));
  });
}
const trimSql = (sql) =>
  String(sql)
    .trim()
    .replace(/;+\s*$/, '');
const userPart = (res) => {
  const r = Array.isArray(res) ? res.slice(2) : [res];
  return r.length === 1 ? r[0] : r;
};
const hasBuffer = (params) => (params || []).some((v) => Buffer.isBuffer(v));

// ---------------------------------------------------------------- cutover fence (moving to another
// PostgreSQL host) `npm run db:migrate-host -- cutover` writes a row in app_meta on the current
// host: state "hold" while the last changes are copied, then "moved" once the new host is live.
// Every running server sees it within TICKETFORGE_CUTOVER_POLL_MS (default 1000; 0 turns the fence
// off). While it says "hold", writes wait (up to TICKETFORGE_CUTOVER_HOLD_MS, default
// 30000) instead of failing; reads carry on. Once it says "moved", a server still on the old host
//        refuses writes with a
// retryable 503 before running them, so nothing is written to a host that was already copied. The
// browser retries those (client/core.ts) and the load balancer sends the retry to a server on the
// new host. See docs/postgres-host-migration.md.
export const CUTOVER_KEY = 'db_cutover';
export const FENCE_POLL_MS =
  (process.env.TICKETFORGE_CUTOVER_POLL_MS ?? '') === ''
    ? 1000
    : Math.max(0, Number(process.env.TICKETFORGE_CUTOVER_POLL_MS) || 0);
const HOLD_MAX_MS = Number(process.env.TICKETFORGE_CUTOVER_HOLD_MS) || 30000;
const FENCE = (G.fence ??= { state: 'open', checkedAt: 0, probe: null });
const movedError = (state) =>
  Object.assign(
    new Error(
      state === 'moved'
        ? 'The database has moved to a new host. Retry this request.'
        : 'The database is being moved to a new host and did not finish in time. Retry this request.',
    ),
    { status: 503, extra: { code: 'db-moved', retry: true } },
  );
/**
 * Reads the fence at most once per poll interval per server (one small query). Failures keep the
 * last known state.
 */
function refreshFence(pool) {
  if (Date.now() - FENCE.checkedAt < FENCE_POLL_MS) return FENCE.probe;
  FENCE.probe ??= pool
    .query('select value from app_meta where key = $1', [CUTOVER_KEY])
    .then((r) => {
      const st = r.rows[0]?.value?.state;
      FENCE.state = st === 'hold' || st === 'moved' ? st : 'open';
    })
    .catch(() => {
      /* app_meta not there yet (first start): nothing to wait for */
    })
    .finally(() => {
      FENCE.checkedAt = Date.now();
      FENCE.probe = null;
    });
  return FENCE.probe;
}
/**
 * Called before a write starts (never in the middle of a transaction, so a held request holds no
 * locks).
 */
async function writeGate(pool) {
  if (!FENCE_POLL_MS) return;
  const start = Date.now();
  for (;;) {
    await refreshFence(pool);
    if (FENCE.state === 'open') return;
    if (FENCE.state === 'moved' || Date.now() - start > HOLD_MAX_MS) throw movedError(FENCE.state);
    await new Promise((r) => setTimeout(r, 250));
  }
}
/** A statement that may change data (anything but a plain select), so the fence applies to it. */
const isWrite = (sql) => {
  const s = String(sql);
  return (
    !/^\s*(select|show|explain)\b/i.test(s) ||
    /\b(insert|update|delete|nextval|setval)\b|\bfor\s+update\b/i.test(s)
  );
};

/** One statement in its own transaction, in a single round trip. */
async function once(pool, sql, params) {
  if (isWrite(sql)) await writeGate(pool);
  if (hasBuffer(params)) return inTx(pool, (query) => query(sql, params)); // large binary: keep it a parameter
  const client = await pool.connect();
  try {
    const res = await client.query(
      `${beginSql(client)};\n${trimSql(inline(client, sql, params))};\ncommit`,
    );
    noteWrite(sql);
    const r = Array.isArray(res) ? res.slice(0, -1) : res; // drop the commit result
    return userPart(r);
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
/**
 * A transaction: the settings ride along with the first statement, saving a round trip. write:
 * false for a plain read.
 */
async function inTx(pool, fn, write = true) {
  if (write) await writeGate(pool);
  const client = await pool.connect();
  let started = false;
  // array: rows as arrays of values (what the Drizzle ORM driver needs: joins can repeat a column
  // name).
  const query = async (sql, params, { array = false }: any = {}) => {
    let out;
    if (array) {
      if (!started) {
        started = true;
        await client.query(beginSql(client));
      }
      out = await client.query({ text: sql, values: params, rowMode: 'array' });
    } else if (!started && !hasBuffer(params)) {
      started = true;
      out = userPart(
        await client.query(`${beginSql(client)};\n${trimSql(inline(client, sql, params))}`),
      );
    } else {
      if (!started) {
        started = true;
        await client.query(beginSql(client));
      }
      out = await client.query(sql, params);
    }
    noteWrite(sql);
    return out;
  };
  try {
    const out = await fn(query);
    if (started) await client.query('commit');
    return out;
  } catch (e) {
    if (started) await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
const POOL_HINT =
  'The database host limits how many connections it accepts (poolers often allow few in session mode), and every ' +
  "running copy of TicketForge (and every db:push or db:migrate-host) uses some. Stop copies you don't need, lower PG_POOL_MAX " +
  "(default 5), or point DATABASE_URL at the host's transaction-mode pooler, which TicketForge supports.";
const explain = (e) => {
  if (/EMAXCONNSESSION|max clients reached/i.test(e?.message || ''))
    e.message = `${e.message}. ${POOL_HINT}`;
  // Every connection of this server's pool stayed busy for PG_ACQUIRE_TIMEOUT_MS: answer "busy,
  // retry" instead of letting requests queue without end under a traffic spike. The statement never
  // reached the database.
  if (/timeout exceeded when trying to connect/i.test(e?.message || ''))
    return Object.assign(new Error('The server is busy. Try again in a moment.'), {
      status: 503,
      cause: e,
      extra: { code: 'db-busy', retry: true },
    });
  return e;
};

/**
 * Turns the first connection failure into a message that says what to fix, instead of a bare
 * network error code.
 */
export function connectionFailure(e: any, host: string) {
  const why =
    (
      {
        ECONNREFUSED:
          'the connection was refused. Check that PostgreSQL is running and the host and port are right.',
        ENOTFOUND: 'the host name was not found. Check the host in DATABASE_URL.',
        EAI_AGAIN:
          'the host name could not be looked up (DNS). Check the host in DATABASE_URL and the network.',
        ETIMEDOUT: 'the connection timed out. Check the host, the port and any firewall.',
        ENETUNREACH:
          'the network cannot reach the host. If the host only has an IPv6 address, use the IPv4 or pooler address your database provider gives you.',
        EHOSTUNREACH:
          'the network cannot reach the host. If the host only has an IPv6 address, use the IPv4 or pooler address your database provider gives you.',
        ECONNRESET:
          'the connection was closed by the server. Check the port and the SSL setting (PGSSL).',
        '28P01':
          'the database rejected the password. Check it (and URL-encode special characters such as @ # / as %40 %23 %2F).',
        '28000':
          'the database rejected this user. Check the user name and that it may connect from here.',
        '3D000': 'the database named in DATABASE_URL does not exist.',
      } as Record<string, string>
    )[e?.code] ||
    (/does not support SSL/i.test(e?.message || '')
      ? 'the server does not use SSL. Set PGSSL=disable.'
      : '');
  if (!why) return explain(e);
  const err: any = new Error(`Can't connect to the database at ${host || 'DATABASE_URL'}: ${why}`);
  err.code = e.code;
  err.cause = e;
  return err;
}

/**
 * The first query a new pool runs. Fails with a clear message when the host can't be reached within
 * PG_CONNECT_TIMEOUT_MS (default 10 s), instead of hanging. It only reads, so a failed start
 * changes nothing.
 */
export async function probe(pool, host: string) {
  let timer;
  const first = pool.query('select 1');
  first.catch(() => {}); // when the timeout wins, a late failure must not crash the process
  try {
    await Promise.race([
      first,
      new Promise((_, no) => {
        timer = setTimeout(
          () => no(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
          connectTimeoutMs(),
        );
      }),
    ]);
  } catch (e) {
    pool.end().catch(() => {});
    throw connectionFailure(e, host);
  } finally {
    clearTimeout(timer);
  }
}

async function connect() {
  const url = databaseUrl();
  if (url) {
    checkConnectionString(url);
    const { default: pg } = await import('pg');
    try {
      prepareValue = (await import('pg/lib/utils.js')).default.prepareValue;
    } catch {
      /* keep identity */
    }
    const host = hostOf(url);
    const pool = new pg.Pool({ ...pgConfig(url), idleTimeoutMillis: 10000 });
    pool.on('error', (e) => console.error('Postgres pool error:', e.message));
    await probe(pool, endpointOf(url));
    dbInfo.kind = 'postgres';
    dbInfo.label = `PostgreSQL (${host})`;
    return {
      query: (sql, params) => {
        const t0 = SQL_LOG && performance.now();
        return once(pool, sql, params)
          .then((r) => {
            if (SQL_LOG)
              console.log(
                `[sql] ${(performance.now() - t0).toFixed(1)}ms ${String(sql).replace(/\s+/g, ' ').slice(0, 90)}`,
              );
            return r;
          })
          .catch((e) => {
            throw explain(e);
          });
      },
      rows: (sql, params) =>
        inTx(pool, (query) => query(sql, params, { array: true }), isWrite(sql)).catch((e) => {
          throw explain(e);
        }),
      tx: (fn) => {
        const t0 = SQL_LOG && performance.now();
        return inTx(pool, (query) => fn({ query }))
          .then((r) => {
            if (SQL_LOG) console.log(`[sql] ${(performance.now() - t0).toFixed(1)}ms transaction`);
            return r;
          })
          .catch((e) => {
            throw explain(e);
          });
      },
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = path.join(DATA_DIR, 'db');
  fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  await db.query("select set_config('app.writer', '2', false)"); // one connection, this app only (see SYNC_TRIGGERS)
  dbInfo.kind = 'local';
  dbInfo.label = SERVERLESS
    ? 'Temporary local database (erased often on serverless hosting: set DATABASE_URL)'
    : 'Local database (data/db)';
  let chain: any = Promise.resolve();
  return {
    query: (sql, params) =>
      db.query(sql, params).then((r) => {
        noteWrite(sql);
        return r;
      }),
    rows: (sql, params) =>
      db.query(sql, params, { rowMode: 'array' }).then((r) => {
        noteWrite(sql);
        return r;
      }),
    // PGlite is single-connection: serialise transactions.
    tx(fn) {
      const run = chain.then(() =>
        db.transaction((t) =>
          fn({
            query: (s, p) =>
              t.query(s, p).then((r) => {
                noteWrite(s);
                return r;
              }),
          }),
        ),
      );
      chain = run.catch(() => {});
      return run;
    },
    close: () => db.close(),
  };
}

// The connection lives on globalThis so hot reloads in `next dev` reuse it. A connection made by an
// older version of this file can lack methods this one needs (rows() for Drizzle), so one that
// doesn't fit is replaced.
const fits = (impl) =>
  impl && ['query', 'rows', 'tx', 'close'].every((k) => typeof impl[k] === 'function');
export async function db() {
  if (G.impl) {
    const cur = await G.impl.catch(() => null);
    if (cur && !fits(cur)) {
      G.impl = null;
      Promise.resolve()
        .then(() => cur.close?.())
        .catch(() => {});
    }
  }
  G.impl ??= connect().catch((e) => {
    G.impl = null;
    throw e;
  });
  return G.impl;
}
export const q = async (sql, params?) => (await db()).query(sql, params);
export const tx = async (fn) => (await db()).tx(fn);
/**
 * Like q, but rows come back as arrays of values, in column order (for the Drizzle ORM driver,
 * lib/orm.ts).
 */
export const qrows = async (sql, params) => (await db()).rows(sql, params);
/** Same as q / tx but in system context (sign-in system, startup). */
export const qs = (sql, params?) => asSystem(() => q(sql, params));
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
alter table invites add column if not exists send_count integer not null default 1;
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
-- Sync: rev = the project version that last wrote the issue, so a browser downloads only what changed since its
-- version ("changes since"). revs on projects does the same per settings section (and _order for the issue order).
alter table issues add column if not exists rev integer not null default 0;
create index if not exists issues_project_rev on issues(project_id, rev);
alter table issues add column if not exists is_sub boolean generated always as (coalesce(data->>'type', '') = 'Sub-task') stored;
alter table projects add column if not exists revs jsonb not null default '{}';
alter table projects add column if not exists stats jsonb;
update projects set stats = jsonb_build_object('epics', coalesce(jsonb_array_length(case when jsonb_typeof(data->'epics') = 'array' then data->'epics' end), 0)) where stats is null;
create table if not exists issue_tombstones (
  project_id text not null references projects(id) on delete cascade,
  id text not null,
  rev integer not null,
  primary key (project_id, id)
);
create index if not exists issue_tombstones_rev on issue_tombstones(project_id, rev);
create table if not exists activity (
  id bigserial primary key,
  project_id text not null references projects(id) on delete cascade,
  at timestamptz not null default now(),
  version integer,
  user_id text,
  author text not null default '',
  kind text not null default '',
  target text not null default '',
  text text not null default ''
);
create index if not exists activity_project_at on activity(project_id, at desc);
-- Ticket versions: the whole issue as it was after each status change (and after each restore), numbered per issue.
create table if not exists issue_versions (
  id bigserial primary key,
  project_id text not null references projects(id) on delete cascade,
  issue_id text not null,
  number integer not null,
  at timestamptz not null default now(),
  user_id text,
  author text not null default '',
  status text not null default '',
  restored_from integer,
  data jsonb not null,
  unique (project_id, issue_id, number)
);
create table if not exists ai_usage (
  id bigserial primary key,
  at timestamptz not null default now(),
  project_id text,
  user_id text,
  user_name text not null default '',
  task text not null default '',
  engine text not null default '',
  model text not null default '',
  tier text not null default '',
  input integer not null default 0,
  output integer not null default 0,
  cache_read integer not null default 0,
  cache_write integer not null default 0,
  estimated boolean not null default false,
  chars integer not null default 0,
  ms integer not null default 0,
  cached boolean not null default false,
  escalated boolean not null default false,
  ok boolean not null default true,
  cost double precision
);
create index if not exists ai_usage_at on ai_usage(at desc);
create index if not exists ai_usage_project on ai_usage(project_id, at desc);
create table if not exists app_meta (
  key text primary key,
  value jsonb not null
);
create table if not exists ai_cache (
  key text primary key,
  task text not null default '',
  value text not null,
  chars integer not null default 0,
  hits integer not null default 0,
  created_at timestamptz not null default now(),
  used_at timestamptz not null default now()
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
create table if not exists files (
  id text primary key,
  project_id text not null,
  name text not null default '',
  mime text not null default 'application/octet-stream',
  bytes integer not null default 0,
  data bytea not null,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists files_project on files(project_id);
create table if not exists user_ai (
  user_id text primary key references users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
-- Workspaces: each company's own space. People have one login (users) and a membership per workspace, which holds
-- their role, project access and whether they own it. Data from before workspaces belongs to the 'default' one.
create table if not exists workspaces (
  id text primary key,
  name text not null,
  owner_id text references users(id) on delete set null,
  plan text not null default 'free',
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists workspace_members (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role_id text not null,
  project_access jsonb not null default '"all"',
  is_owner boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user on workspace_members(user_id);
-- API tokens (MCP clients): a token acts as one person in one workspace. Only a hash of it is stored.
create table if not exists api_tokens (
  id text primary key,
  token_hash text not null unique,
  user_id text not null references users(id) on delete cascade,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists api_tokens_user on api_tokens(user_id);
-- Billing (SaaS): the workspace's plan and its Stripe subscription, kept in step by the Stripe webhook.
alter table workspaces add column if not exists stripe_customer_id text;
alter table workspaces add column if not exists stripe_subscription_id text;
alter table workspaces add column if not exists subscription_status text;
alter table workspaces add column if not exists billing_interval text;
alter table workspaces add column if not exists current_period_end timestamptz;
alter table workspaces add column if not exists cancel_at_period_end boolean not null default false;
alter table workspaces add column if not exists trial_ends_at timestamptz;
alter table workspaces add column if not exists paymongo_subscription_id text;
create index if not exists workspaces_customer on workspaces(stripe_customer_id);
-- PayMongo checkout the owner was sent to and hasn't come back from yet (cleared once handled).
alter table workspaces add column if not exists paymongo_checkout_id text;
-- Which plan (and version of it) the workspace is on, and the gateway it pays with (paymongo | xendit | stripe).
alter table workspaces add column if not exists plan_version integer;
alter table workspaces add column if not exists gateway text;
-- The hosted checkout the owner was sent to and hasn't come back from yet, as "<gateway>:<session id>" (cleared once handled).
alter table workspaces add column if not exists checkout_ref text;
-- Payment gateways the owner turned on (several can be active at once). credentials holds the encrypted keys.
create table if not exists payment_gateways (
  provider text primary key,
  active boolean not null default false,
  credentials jsonb not null default '{}',
  updated_by text,
  updated_at timestamptz not null default now()
);
-- Subscription plans. Editing a plan that has subscribers adds a new version row, and workspaces keep the version they
-- subscribed to (workspaces.plan_version) and new subscriptions use the latest version.
create table if not exists billing_plans (
  id text not null,
  version integer not null,
  name text not null,
  blurb text not null default '',
  price double precision not null default 0,
  currency text not null default 'USD',
  interval text not null default 'month',
  is_free boolean not null default false,
  trial_days integer not null default 0,
  limits jsonb not null default '{}',
  features jsonb not null default '[]',
  position integer not null default 0,
  archived boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  primary key (id, version)
);
-- Stripe events already handled (Stripe can send one more than once).
create table if not exists billing_events (
  id text primary key,
  type text not null default '',
  workspace_id text,
  created_at timestamptz not null default now()
);
-- Monthly usage per workspace (platform AI calls, code jobs), counted atomically against the plan's limit.
create table if not exists usage_counters (
  workspace_id text not null,
  metric text not null,
  period text not null,
  n integer not null default 0,
  primary key (workspace_id, metric, period)
);
create table if not exists schema_migrations (
  id text primary key,
  at timestamptz not null default now()
);
alter table sessions add column if not exists workspace_id text;
alter table roles add column if not exists workspace_id text not null default 'default';
alter table invites add column if not exists workspace_id text not null default 'default';
-- Scale: sign-out everywhere, disabling a person and deleting a user (cascade) look sessions up by person, the
-- expired-session sweep looks them up by expiry, and re-sending an invite looks it up by workspace and email.
create index if not exists sessions_user on sessions(user_id);
create index if not exists sessions_expires on sessions(expires_at);
create index if not exists password_resets_user on password_resets(user_id);
create index if not exists invites_ws_email on invites(workspace_id, email);
alter table projects add column if not exists workspace_id text not null default 'default';
create index if not exists projects_workspace on projects(workspace_id, updated_at desc);
-- Soft delete: an archived project is hidden from everyone and can be restored by the app owner (archived_at = null).
alter table projects add column if not exists archived_at timestamptz;
alter table projects add column if not exists archived_by text;
alter table ai_usage add column if not exists workspace_id text not null default 'default';
create index if not exists ai_usage_workspace on ai_usage(workspace_id, at desc);
-- Consent: which version of the Terms of Use and Privacy Policy each person accepted, and when (lib/legal).
alter table users add column if not exists terms_version text;
alter table users add column if not exists terms_accepted_at timestamptz;
alter table users add column if not exists privacy_version text;
alter table users add column if not exists email_verified_at timestamptz;
create table if not exists legal_acceptances (
  id bigserial primary key,
  user_id text references users(id) on delete set null,
  email text not null default '',
  doc text not null,
  version text not null,
  accepted_at timestamptz not null default now(),
  ip text not null default '',
  user_agent text not null default ''
);
create index if not exists legal_acceptances_user on legal_acceptances(user_id);
-- People asking for an account while sign-up is a waitlist (SIGNUP_MODE=waitlist).
create table if not exists signup_requests (
  id text primary key,
  email text not null unique,
  name text not null default '',
  company text not null default '',
  note text not null default '',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
-- Per-person preferences kept on the server, such as which guided tours someone has finished.
create table if not exists user_prefs (
  user_id text primary key references users(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table if not exists code_jobs (
  id text primary key,
  project_id text not null,
  ticket_id text not null default '',
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists code_jobs_project on code_jobs(project_id, ticket_id);
create table if not exists doc_templates (
  key text primary key,
  name text not null default '',
  bytes integer not null default 0,
  data bytea not null,
  info jsonb not null default '{}',
  updated_by text,
  updated_at timestamptz not null default now()
);
-- Project brain (lib/brain.ts): an Obsidian-style vault of Markdown notes per project. kind 'auto' notes are written
-- from the project by TicketForge (rebuilt when it changes), kind 'user' notes are people's own and never overwritten.
create table if not exists brain_notes (
  project_id text not null references projects(id) on delete cascade,
  id text not null,
  kind text not null default 'user',
  type text not null default 'note',
  key text not null default '',
  ref text not null default '',
  title text not null default '',
  status text not null default '',
  tags jsonb not null default '[]',
  links jsonb not null default '[]',
  meta jsonb not null default '{}',
  body text not null default '',
  hash text not null default '',
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (project_id, id)
);
create index if not exists brain_notes_ref on brain_notes(project_id, ref);
create table if not exists brain_state (
  project_id text primary key references projects(id) on delete cascade,
  version integer not null default 0,
  rev integer not null default 0,
  built_at timestamptz,
  data jsonb not null default '{}'
);
-- Coding specs (lib/specs.ts): one AI coding prompt per ticket of an epic, with the files and modules it is expected to
-- touch. status is draft or ready, and generating specs again replaces the same ticket's spec.
create table if not exists coding_specs (
  project_id text not null references projects(id) on delete cascade,
  ticket_id text not null,
  epic_id text not null default '',
  ticket_key text not null default '',
  title text not null default '',
  prompt text not null default '',
  criteria jsonb not null default '[]',
  files jsonb not null default '[]',
  modules jsonb not null default '[]',
  status text not null default 'draft',
  generated_by text not null default '',
  generated_at timestamptz not null default now(),
  ready_by text,
  ready_at timestamptz,
  primary key (project_id, ticket_id)
);
create index if not exists coding_specs_epic on coding_specs(project_id, epic_id);
-- AI-produced changes linked to a spec (a branch, pull request or commit). They can be accepted only after a required
-- reviewer (Coding specs settings) has approved them: approvals is a list of { userId, name, at }.
create table if not exists spec_changes (
  project_id text not null references projects(id) on delete cascade,
  id text not null,
  ticket_id text not null,
  ref text not null default '',
  summary text not null default '',
  status text not null default 'pending',
  approvals jsonb not null default '[]',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  accepted_by text,
  accepted_at timestamptz,
  primary key (project_id, id)
);
create index if not exists spec_changes_ticket on spec_changes(project_id, ticket_id);
-- Documents saved to the workspace's shared Google Drive folder (lib/gdrive.ts). state: saved, queued (waiting for a retry)
-- or failed (gave up after the maximum retries). The bytes are kept only while queued, so nothing is stored here once the
-- document is in Drive. One row per document: writing it again replaces the row.
create table if not exists drive_docs (
  project_id text not null references projects(id) on delete cascade,
  epic_id text not null,
  kind text not null,
  doc_key text not null default '',
  name text not null default '',
  mime text not null default '',
  state text not null default 'queued',
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error text not null default '',
  drive_file_id text not null default '',
  data bytea,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, epic_id, kind, doc_key)
);
create index if not exists drive_docs_queue on drive_docs(state, next_attempt_at);
-- AI helper (lib/helper.ts, its panel was replaced by the chatbot below). helper_perms: what each person may do with the helper in one
-- project (search, generate, assign). No row means the defaults (search only). ticket_drafts: tickets the helper
-- generated. They are not issues: a draft only becomes an issue when a person approves it. Its status is draft,
-- approved or discarded, and issue_id is the issue it became. (No semicolons in these comments: PGlite splits on them.)
create table if not exists helper_perms (
  project_id text not null references projects(id) on delete cascade,
  user_id text not null,
  can_search boolean not null default true,
  can_generate boolean not null default false,
  can_assign boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create table if not exists ticket_drafts (
  project_id text not null references projects(id) on delete cascade,
  id text not null,
  idea text not null default '',
  data jsonb not null,
  status text not null default 'draft',
  created_by text,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  issue_id text,
  primary key (project_id, id)
);
create index if not exists ticket_drafts_status on ticket_drafts(project_id, status, created_at desc);
-- AI chatbot (client/ProjectChat.tsx, lib/chat.ts). chat_messages: one person's conversation with the assistant in one
-- project, restored when the panel opens. role is user or assistant, and content is the text. An assistant message
-- that proposed an issue also keeps the draft preview in draft (it is not an issue until the person clicks Create).
create table if not exists chat_messages (
  id bigserial primary key,
  project_id text not null references projects(id) on delete cascade,
  user_id text not null,
  role text not null,
  content text not null default '',
  draft jsonb,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_thread on chat_messages(project_id, user_id, id);
`;

// Older TicketForge versions sharing the database (another server not updated yet) don't record
// issue and section versions, so browsers syncing "changes since" would miss their edits. These
// triggers record them for any writer that doesn't say it does it itself (app.writer = 2): the
// version the writer's save is about to become.
const SYNC_TRIGGERS = [
  `create or replace function tf_issue_rev() returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    if coalesce(current_setting('app.writer', true), '') <> '2' then
      new.rev := coalesce((select version from projects where id = new.project_id), 0) + 1;
    end if;
    return new;
  end $f$`,
  // create or replace: one atomic step, so two servers starting at once can't trip over each other.
  'create or replace trigger tf_issue_rev before insert or update on issues for each row execute function tf_issue_rev()',
  `create or replace function tf_issue_gone() returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    if coalesce(current_setting('app.writer', true), '') <> '2' then
      insert into issue_tombstones (project_id, id, rev)
        select old.project_id, old.id, p.version + 1 from projects p where p.id = old.project_id
        on conflict (project_id, id) do update set rev = excluded.rev;
    end if;
    return old;
  end $f$`,
  'create or replace trigger tf_issue_gone after delete on issues for each row execute function tf_issue_gone()',
  `create or replace function tf_project_revs() returns trigger language plpgsql security definer set search_path = public as $f$
  declare k text;
  begin
    if coalesce(current_setting('app.writer', true), '') <> '2' and new.data is distinct from old.data then
      for k in select jsonb_object_keys(new.data) union select jsonb_object_keys(old.data) loop
        if (new.data -> k) is distinct from (old.data -> k) then new.revs := coalesce(new.revs, '{}'::jsonb) || jsonb_build_object(k, new.version); end if;
      end loop;
      new.stats := jsonb_build_object('epics', coalesce(jsonb_array_length(case when jsonb_typeof(new.data -> 'epics') = 'array' then new.data -> 'epics' end), 0));
    end if;
    return new;
  end $f$`,
  'create or replace trigger tf_project_revs before update on projects for each row execute function tf_project_revs()',
];

/**
 * Taken at the start of each setup transaction: servers starting at the same time (several copies,
 * or several routes at once in development) set the database up one after another instead of
 * colliding ("already exists").
 */
const SETUP_LOCK = 'select pg_advisory_xact_lock(7413201)';
/** Changes whenever SCHEMA does, so a running server migrates again after new tables are added. */
export const SCHEMA_VERSION = (() => {
  let h = 0;
  for (const c of SCHEMA + SYNC_TRIGGERS.join(';')) h = (h * 31 + c.charCodeAt(0)) | 0;
  return String(h);
})();

export async function migrate() {
  const d = await db();
  const wasOwner = G.owner;
  G.owner = true;
  try {
    if (dbInfo.kind === 'postgres') await checkPrivileges(d);
    // Postgres takes the whole schema in one message (one round trip; matters on every cold start
    // of a serverless deploy). The local database runs it statement by statement.
    if (dbInfo.kind === 'postgres') await d.query(`${SETUP_LOCK};\n${SCHEMA}`);
    else
      for (const stmt of SCHEMA.split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await d.query(stmt);
    // Helps older servers sharing the database stay in sync; never a reason to stop the app from
    // starting.
    try {
      await d.tx(async (t) => {
        if (dbInfo.kind === 'postgres') await t.query(SETUP_LOCK);
        for (const stmt of SYNC_TRIGGERS) await t.query(stmt);
      });
    } catch (e) {
      console.warn(`Sync triggers not updated (the app works without them): ${e.message}`);
    }
    await runMigrations(d);
    if (dbInfo.kind === 'postgres') await setupRls(d);
  } finally {
    G.owner = wasOwner;
  }
}

/**
 * One-time data changes, each recorded in schema_migrations so it never runs twice. ws-1:
 * workspaces. Roles become per workspace (key: workspace + id); everyone who had an account becomes
 * a member of the 'default' workspace with the role, project access and owner flag they had, so
 * nothing changes for them.
 */
const MIGRATIONS = [
  {
    id: 'ws-1',
    sql: [
      `do $$ begin
       if exists (select 1 from pg_constraint where conname = 'roles_pkey' and conrelid = 'roles'::regclass
                  and array_length(conkey, 1) = 1) then
         alter table roles drop constraint roles_pkey cascade;
         alter table roles add primary key (workspace_id, id);
       end if;
     end $$`,
      `insert into workspaces (id, name, owner_id)
       select 'default', 'My workspace', (select id from users order by is_owner desc, created_at limit 1)
       where exists (select 1 from users)
       on conflict (id) do nothing`,
      `insert into workspace_members (workspace_id, user_id, role_id, project_access, is_owner, status, created_at)
       select 'default', u.id, u.role_id, u.project_access, u.is_owner, u.status, u.created_at from users u
       where exists (select 1 from workspaces where id = 'default')
       on conflict (workspace_id, user_id) do nothing`,
    ],
  },
];
async function runMigrations(d) {
  const done = new Set((await d.query('select id from schema_migrations')).rows.map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await d.tx(async (t) => {
      if (dbInfo.kind === 'postgres') await t.query(SETUP_LOCK);
      if ((await t.query('select 1 from schema_migrations where id = $1', [m.id])).rows[0]) return; // another copy did it
      for (const stmt of m.sql) await t.query(stmt);
      await t.query('insert into schema_migrations (id) values ($1)', [m.id]);
    });
    console.log(`Database migration ${m.id} applied`);
  }
}

/** Fails early with a fix when the database user can't create TicketForge's tables. */
async function checkPrivileges(d) {
  const r = (
    await d.query(
      `select current_user u, has_schema_privilege(current_user, 'public', 'CREATE') can_create,
    (select count(*)::int from pg_tables where schemaname = 'public' and tablename = any($1)) existing`,
      [TABLES],
    )
  ).rows[0];
  if (r.can_create) return;
  const who = r.u.replace(/"/g, '""');
  throw new Error(
    `permission denied for schema public: the database user "${r.u}" in DATABASE_URL can't create tables there ` +
      `(${r.existing} of ${TABLES.length} TicketForge tables exist). Since PostgreSQL 15 only the database owner can, by default. Fix it as ` +
      `the database owner or a superuser, e.g. psql "<admin connection>" -c 'ALTER DATABASE <db> OWNER TO "${who}"' ` +
      `or -c 'GRANT CREATE ON SCHEMA public TO "${who}"'. On Supabase, connect as the postgres user (postgres.<project-ref> on the pooler).`,
  );
}

// ---------------------------------------------------------------- RLS setup (PostgreSQL /
// Supabase)
export const TABLES = [
  'roles',
  'users',
  'sessions',
  'invites',
  'password_resets',
  'projects',
  'issues',
  'issue_tombstones',
  'activity',
  'issue_versions',
  'app_meta',
  'ai_cache',
  'ai_usage',
  'notifications',
  'screenshots',
  'files',
  'doc_templates',
  'code_jobs',
  'user_ai',
  'legal_acceptances',
  'signup_requests',
  'user_prefs',
  'workspaces',
  'workspace_members',
  'schema_migrations',
  'billing_events',
  'payment_gateways',
  'billing_plans',
  'usage_counters',
  'brain_notes',
  'brain_state',
  'coding_specs',
  'spec_changes',
  'drive_docs',
  'helper_perms',
  'ticket_drafts',
  'chat_messages',
  'api_tokens',
];
const FUNCS = [
  'tf_uid()',
  'tf_system()',
  'tf_ws()',
  'tf_can(text)',
  'tf_can_delete_project(text)',
  'tf_access(text)',
  'tf_all_access()',
  'tf_access_list()',
  'tf_ws_projects()',
  'tf_coworkers()',
  'tf_my_workspaces()',
];

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

/**
 * A row of project `col` is visible: system context, access to every project, or this project on
 * the user's list.
 */
const ACCESS = (col) =>
  `((select tf_system()) or (select tf_all_access()) or ${col} in (select unnest(tf_access_list())))`;
const POLICY_SQL = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = '${APP_ROLE}') then
    create role ${APP_ROLE} nologin nosuperuser nobypassrls noinherit;
  end if;
end $$;
grant ${APP_ROLE} to current_user;
grant usage on schema public to ${APP_ROLE};
grant select, insert, update, delete on table ${TABLES.join(', ')} to ${APP_ROLE};
grant usage, select on sequence activity_id_seq, issue_versions_id_seq, ai_usage_id_seq, legal_acceptances_id_seq, chat_messages_id_seq to ${APP_ROLE};

create or replace function tf_uid() returns text language sql stable set search_path = public
  as $f$ select nullif(current_setting('app.user_id', true), '') $f$;
create or replace function tf_system() returns boolean language sql stable set search_path = public
  as $f$ select coalesce(current_setting('app.system', true), '') = 'on' $f$;
create or replace function tf_ws() returns text language sql stable set search_path = public
  as $f$ select nullif(current_setting('app.workspace_id', true), '') $f$;
-- Permissions and project access come from your membership of the current workspace.
create or replace function tf_can(perm text) returns boolean language sql stable security definer set search_path = public
  as $f$ select exists (select 1 from workspace_members m join users u on u.id = m.user_id
         join roles r on r.workspace_id = m.workspace_id and r.id = m.role_id
         where m.user_id = tf_uid() and m.workspace_id = tf_ws() and m.status = 'active' and u.status = 'active'
           and (m.is_owner or r.permissions ? perm)) $f$;
-- Only the project's creator and the workspace owner may delete (archive) a project.
create or replace function tf_can_delete_project(pid text) returns boolean language sql stable security definer set search_path = public
  as $f$ select exists (select 1 from projects p where p.id = pid and p.workspace_id = tf_ws())
     and (exists (select 1 from projects p where p.id = pid and p.created_by is not null and p.created_by = tf_uid())
       or exists (select 1 from workspace_members m where m.user_id = tf_uid() and m.workspace_id = tf_ws() and m.status = 'active' and m.is_owner)) $f$;
-- Archiving or restoring a project (archived_at changes) is only for system context and those who may delete it.
create or replace function tf_project_archive() returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    if (new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by)
       and not (tf_system() or (new.archived_at is not null and old.archived_at is null and tf_can_delete_project(old.id))) then
      raise exception 'Only the project creator or an owner can delete a project' using errcode = '42501';
    end if;
    return new;
  end $f$;
create or replace trigger tf_project_archive before update on projects for each row execute function tf_project_archive();
create or replace function tf_access(pid text) returns boolean language sql stable security definer set search_path = public
  as $f$ select exists (select 1 from projects p where p.id = pid and p.workspace_id = tf_ws())
     and (exists (select 1 from workspace_members m where m.user_id = tf_uid() and m.workspace_id = tf_ws() and m.status = 'active'
                  and (m.is_owner or m.project_access = '"all"'::jsonb or m.project_access ? pid))
       or exists (select 1 from projects p where p.id = pid and p.created_by is not null and p.created_by = tf_uid())) $f$;
-- For policies on tables with many rows per project (issues): these take no row argument, so wrapped in
-- (select …) Postgres works them out once per statement instead of once per row.
create or replace function tf_all_access() returns boolean language sql stable security definer set search_path = public
  as $f$ select exists (select 1 from workspace_members m where m.user_id = tf_uid() and m.workspace_id = tf_ws() and m.status = 'active'
         and (m.is_owner or m.project_access = '"all"'::jsonb)) $f$;
create or replace function tf_access_list() returns text[] language sql stable security definer set search_path = public
  as $f$ select coalesce(array(
      select jsonb_array_elements_text(case when jsonb_typeof(m.project_access) = 'array' then m.project_access else '[]'::jsonb end)
        from workspace_members m where m.user_id = tf_uid() and m.workspace_id = tf_ws() and m.status = 'active'
      union select p.id from projects p where p.created_by is not null and p.created_by = tf_uid() and p.workspace_id = tf_ws()), '{}'::text[]) $f$;
-- Workspace isolation (the restrictive tfw_ policies below).
create or replace function tf_ws_projects() returns text[] language sql stable security definer set search_path = public
  as $f$ select coalesce(array(select id from projects where workspace_id = tf_ws()), '{}'::text[]) $f$;
create or replace function tf_coworkers() returns text[] language sql stable security definer set search_path = public
  as $f$ select coalesce(array(select user_id from workspace_members where workspace_id = tf_ws()), '{}'::text[]) $f$;
create or replace function tf_my_workspaces() returns text[] language sql stable security definer set search_path = public
  as $f$ select coalesce(array(select workspace_id from workspace_members where user_id = tf_uid() and status = 'active'), '{}'::text[]) $f$;
revoke all on function ${FUNCS.join(', ')} from public;
grant execute on function ${FUNCS.join(', ')} to ${APP_ROLE};
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function ${FUNCS.join(', ')} from %I', r);
    end if;
  end loop;
end $$;

${TABLES.map((t) => `do $$ declare p record; begin for p in select policyname from pg_policies where schemaname = current_schema() and tablename = '${t}' and (policyname like 'tf\\_%' or policyname like 'tfw\\_%') loop execute format('drop policy %I on ${t}', p.policyname); end loop; end $$`).join(';\n')};

create policy tf_select on users for select to ${APP_ROLE} using (tf_system() or id = tf_uid() or id = any(tf_coworkers()));
create policy tf_write on users for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_select on roles for select to ${APP_ROLE} using (tf_system() or (tf_uid() is not null and workspace_id = tf_ws()));
create policy tf_write on roles for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on sessions for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on invites for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on password_resets for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on api_tokens for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on app_meta for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on ai_cache for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on ai_usage for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on doc_templates for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_select on projects for select to ${APP_ROLE} using (${ACCESS('id')} or (select tf_can('users.manage')));
create policy tf_insert on projects for insert to ${APP_ROLE} with check ((select tf_system()) or (select tf_can('project.create')));
create policy tf_update on projects for update to ${APP_ROLE} using ((select tf_system()) or (${ACCESS('id')} and archived_at is null)) with check (${ACCESS('id')});
create policy tf_delete on projects for delete to ${APP_ROLE} using ((select tf_system()) or (${ACCESS('id')} and tf_can_delete_project(id)));
create policy tf_all on issues for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on issue_tombstones for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on activity for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on issue_versions for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on screenshots for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on files for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_own on user_ai for all to ${APP_ROLE} using (tf_system() or user_id = tf_uid()) with check (tf_system() or user_id = tf_uid());
create policy tf_own on user_prefs for all to ${APP_ROLE} using (tf_system() or user_id = tf_uid()) with check (tf_system() or user_id = tf_uid());
create policy tf_system_only on legal_acceptances for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on signup_requests for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_select on workspaces for select to ${APP_ROLE} using (tf_system() or id = any(tf_my_workspaces()));
create policy tf_write on workspaces for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_select on workspace_members for select to ${APP_ROLE} using (tf_system() or workspace_id = tf_ws() or user_id = tf_uid());
create policy tf_write on workspace_members for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on schema_migrations for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on billing_events for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on payment_gateways for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_select on billing_plans for select to ${APP_ROLE} using (true);
create policy tf_write on billing_plans for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on usage_counters for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
-- Workspace isolation, added on top of every rule above (restrictive): rows of another workspace never show, even to
-- someone with access to "all projects". System work stays inside the request's workspace in the app code.
${['projects', 'roles', 'invites'].map((t) => `create policy tfw_tenant on ${t} as restrictive for all to ${APP_ROLE} using (tf_system() or workspace_id = tf_ws()) with check (tf_system() or workspace_id = tf_ws())`).join(';\n')};
${['issues', 'issue_tombstones', 'activity', 'issue_versions', 'screenshots', 'files', 'code_jobs', 'brain_notes', 'brain_state', 'coding_specs', 'spec_changes', 'drive_docs', 'helper_perms', 'ticket_drafts', 'chat_messages'].map((t) => `create policy tfw_tenant on ${t} as restrictive for all to ${APP_ROLE} using ((select tf_system()) or project_id in (select unnest(tf_ws_projects()))) with check ((select tf_system()) or project_id in (select unnest(tf_ws_projects())))`).join(';\n')};
create policy tf_all on code_jobs for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on brain_notes for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on brain_state for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on coding_specs for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on spec_changes for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on drive_docs for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on ticket_drafts for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_own on chat_messages for all to ${APP_ROLE} using (${ACCESS('project_id')} and (select tf_system() or user_id = tf_uid())) with check (${ACCESS('project_id')} and (select tf_system() or user_id = tf_uid()));
create policy tf_select on helper_perms for select to ${APP_ROLE} using (${ACCESS('project_id')});
create policy tf_write on helper_perms for all to ${APP_ROLE} using (${ACCESS('project_id')} and (select tf_system() or tf_can('project.settings'))) with check (${ACCESS('project_id')} and (select tf_system() or tf_can('project.settings')));
create policy tf_select on notifications for select to ${APP_ROLE} using (tf_system() or user_id = tf_uid());
create policy tf_insert on notifications for insert to ${APP_ROLE} with check (tf_system() or tf_uid() is not null);
create policy tf_update on notifications for update to ${APP_ROLE} using (tf_system() or user_id = tf_uid()) with check (tf_system() or user_id = tf_uid());
create policy tf_delete on notifications for delete to ${APP_ROLE} using (tf_system() or user_id = tf_uid())`;

/**
 * 1) Lock down: RLS on every table, nothing for PUBLIC / Supabase's anon & authenticated roles (so
 *    the Supabase REST API and anon key can't read or write anything).
 * 2) Policies for the app role, scoped to the signed-in user. If step 2 fails the app keeps running
 *    as the owner, and step 1 still protects the data.
 */
async function setupRls(d) {
  const info = { enabled: false, appRole: null, tables: TABLES.length, error: null };
  if (process.env.TICKETFORGE_RLS === 'off') {
    info.error = 'Disabled with TICKETFORGE_RLS=off';
    dbInfo.rls = info;
    return;
  }
  try {
    await d.tx(async (t) => {
      await t.query(SETUP_LOCK);
      await t.query(LOCKDOWN_SQL);
    });
    info.enabled = true;
  } catch (e) {
    info.error = `Could not enable RLS: ${e.message}`;
    console.error(info.error);
    dbInfo.rls = info;
    return;
  }
  try {
    await d.tx(async (t) => {
      await t.query(SETUP_LOCK);
      await t.query(POLICY_SQL);
    });
    info.appRole = APP_ROLE;
  } catch (e) {
    info.error = `RLS is on, but the per-user policies could not be set up, so the app runs as the table owner: ${e.message}`;
    console.error(info.error);
  }
  dbInfo.rls = info;
}
