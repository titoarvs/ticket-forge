import fs from 'node:fs';
import path from 'node:path';
import {
  connectTimeoutMs,
  databaseUrl,
  checkConnectionString,
  hostOf,
  pgConfig,
  endpointOf,
} from '../db-config';
import { G, beginSql, dbInfo, SQL_LOG, DATA_DIR, SERVERLESS, asSystem } from './context';

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
