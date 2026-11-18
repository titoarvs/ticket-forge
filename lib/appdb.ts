// The databases of the app a project builds (Project settings → Database), not TicketForge's own database.
// A project keeps a few connections (Test, Staging, Production), on PostgreSQL / Supabase, MySQL / MariaDB, SQLite or
// SQL Server (drivers in lib/dbdrivers.mjs). Each connection string is encrypted (AES-256-GCM) in app_meta, which
// row-level security limits to the server, like the test-role passwords in lib/secrets.ts: it's never put in the project
// data, never sent to the browser, exported or shown to the AI. The browser sees host, port, database and user only.
import crypto from 'node:crypto';
import { getMeta, setMeta, deleteMeta } from './appmeta';
import { encrypt, decrypt } from './settings';
import { isSaas } from './platform';
import { isPrivateHost } from './netguard';
import { checkPerProject } from './limits';
import { openDb, parseDbUrl, hideUrl, ENGINE_LABELS, PLACEHOLDER } from './dbdrivers.mjs';

export const ENGINES = ENGINE_LABELS;
export { PLACEHOLDER };
// test: code jobs and test setup may write to it. staging: read-only. production: schema only, never rows.
export const KINDS = { test: 'Test', staging: 'Staging', production: 'Production' } as const;
const MAX_ENVS = 10;
const TEST_TIMEOUT_MS = 8000;

type Engine = keyof typeof ENGINE_LABELS;
type Kind = keyof typeof KINDS;
type Box = ReturnType<typeof encrypt>;
type LastTest = { ok: boolean; at: string; by: string | null; version?: string; tables?: number; canWrite?: boolean; error?: string };
type Env = {
  id: string; name: string; kind: Kind; engine: Engine; urlEnc: Box;
  host: string; port: number; database: string; user: string;
  updatedAt: string; updatedBy: string | null; lastTest?: LastTest | null;
};

// What runs before each test run, against the Test database: nothing, a SQL file from the repository, or an npm script.
export const SETUP_KINDS = { none: 'Nothing', sql: 'Run a SQL file from the repository', npm: 'Run an npm script (on this computer)' } as const;
type Setup = { kind: keyof typeof SETUP_KINDS; value: string; updatedAt?: string; updatedBy?: string | null };
type Saved = { envs: Env[]; setup?: Setup };

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const KEY = (projectId: string) => `project_db:${projectId}`;
// A person's own database for a project (one on their computer): theirs only, used instead of the project's Test one.
const MINE_KEY = (projectId: string, userId: string) => `project_db_mine:${projectId}:${userId}`;
export const MINE = 'mine';

async function load(projectId: string): Promise<Saved> {
  const v = await getMeta(KEY(projectId));
  return Array.isArray(v?.envs) ? v : { envs: [] };
}
const save = async (projectId: string, v: Saved) => {
  if (v.envs.length || (v.setup && v.setup.kind !== 'none')) await setMeta(KEY(projectId), v); else await deleteMeta(KEY(projectId));
};

/** What the browser may see: everything but the connection string. */
const view = ({ urlEnc: _u, ...env }: Env) => env;
export async function listEnvs(projectId: string) {
  return (await load(projectId)).envs.map((e) => view({ ...e, engine: e.engine || 'postgres' }));
}

async function checkReachable(engine: Engine, host: string) {
  if (!isSaas()) return;
  // A SQLite file would be a file on the hosted service's own disk.
  if (engine === 'sqlite') throw fail(400, 'SQLite files can be connected only when TicketForge runs on your own computer or server.');
  if (await isPrivateHost(host)) throw fail(400, `${host} is a private or internal address. On the hosted service, connect a database that’s reachable on the internet.`);
}
const engineOf = (v: any): Engine => (v && v in ENGINE_LABELS ? v : 'postgres');

/** Adds or changes a connection. With an id and no url, the saved connection string is kept. */
export async function saveEnv(projectId: string, input: any, actor: any) {
  const v = await load(projectId);
  const cur = input.id ? v.envs.find((e) => e.id === input.id) : null;
  if (input.id && !cur) throw fail(404, 'That connection was removed. Refresh the page.');
  if (!cur) {
    if (v.envs.length >= MAX_ENVS) throw fail(400, `A project can have up to ${MAX_ENVS} database connections.`);
    await checkPerProject('dbConnections', v.envs.length);
  }
  const name = String(input.name ?? cur?.name ?? '').trim().slice(0, 60);
  if (!name) throw fail(400, 'Give the connection a name, like “Test”.');
  if (v.envs.some((e) => e.id !== cur?.id && e.name.toLowerCase() === name.toLowerCase())) throw fail(400, `There’s already a connection called “${name}”.`);
  const kind = (input.kind ?? cur?.kind) as Kind;
  if (!(kind in KINDS)) throw fail(400, 'Choose Test, Staging or Production.');
  const engine = (input.engine ?? cur?.engine ?? 'postgres') as Engine;
  if (!(engine in ENGINE_LABELS)) throw fail(400, `Choose one of: ${Object.values(ENGINE_LABELS).join(', ')}.`);
  const url = String(input.url ?? '').trim();
  if (!url && !cur) throw fail(400, 'Paste the connection string.');
  // A different engine needs a connection string of its own.
  if (!url && cur && engineOf(cur.engine) !== engine && !(['postgres', 'supabase'].includes(engine) && ['postgres', 'supabase'].includes(engineOf(cur.engine)))) {
    throw fail(400, `Paste the ${ENGINE_LABELS[engine]} connection string too: the saved one is for ${ENGINE_LABELS[engineOf(cur.engine)]}.`);
  }
  if (url.length > 2000) throw fail(400, 'That connection string is too long.');
  const parts = url ? parseDbUrl(engine, url) : null;
  await checkReachable(engine, parts?.host ?? cur!.host);
  const env: Env = {
    id: cur?.id || crypto.randomUUID().slice(0, 8), name, kind, engine,
    urlEnc: url ? encrypt(url) : cur!.urlEnc,
    ...(parts || { host: cur!.host, port: cur!.port, database: cur!.database, user: cur!.user }),
    updatedAt: new Date().toISOString(), updatedBy: actor?.name || null,
    // A new address hasn't been tested yet.
    lastTest: url ? null : cur?.lastTest ?? null,
  };
  v.envs = cur ? v.envs.map((e) => (e.id === cur.id ? env : e)) : [...v.envs, env];
  await save(projectId, v);
  return view(env);
}

/** Removes a connection; returns its name (for the project's Activity). */
export async function removeEnv(projectId: string, id: string) {
  const v = await load(projectId);
  const env = v.envs.find((e) => e.id === id);
  if (!env) throw fail(404, 'That connection was already removed.');
  v.envs = v.envs.filter((e) => e.id !== id);
  await save(projectId, v);
  return env.name;
}

// ---------------------------------------------------------------- your own database

/** This person's own database for the project, without its connection string, or null. */
export async function getMine(projectId: string, userId: string) {
  if (!userId) return null;
  const m = await getMeta(MINE_KEY(projectId, userId));
  return m?.urlEnc ? view({ ...m, engine: engineOf(m.engine) }) : null;
}
/** Saves (or, with an empty url, forgets) this person's own database for the project. */
export async function setMine(projectId: string, url: string, actor: any, engineIn = 'postgres') {
  if (!actor?.id) throw fail(401, 'Sign in to continue.');
  const u = String(url || '').trim();
  if (!u) { await deleteMeta(MINE_KEY(projectId, actor.id)); return null; }
  if (u.length > 2000) throw fail(400, 'That connection string is too long.');
  const engine = engineOf(engineIn);
  const parts = parseDbUrl(engine, u);
  await checkReachable(engine, parts.host);
  const env: Env = { id: MINE, name: 'Your own', kind: 'test', engine, urlEnc: encrypt(u), ...parts, updatedAt: new Date().toISOString(), updatedBy: actor.name || null, lastTest: null };
  await setMeta(MINE_KEY(projectId, actor.id), env);
  return view(env);
}

/** A saved connection, or this person's own one for id 'mine'. */
async function findConn(projectId: string, id: string, userId = ''): Promise<Env | null> {
  const found = id === MINE ? (userId ? await getMeta(MINE_KEY(projectId, userId)) : null) : (await load(projectId)).envs.find((e) => e.id === id);
  return found?.urlEnc ? { ...found, engine: engineOf(found.engine) } : null;
}
const openUrl = (env: Env) => {
  try { return decrypt(env.urlEnc); } catch { throw fail(400, `The saved connection string of ${env.name} can’t be read any more (the encryption key changed). Paste it again.`); }
};

/**
 * The database code jobs and test runs may write to: the person's own one when they work on their own computer, else
 * the project's first Test connection. Never Staging or Production. Null when there's none.
 * For the server only: the result holds the connection string.
 */
export async function testDatabase(projectId: string, userId: string, { local = false } = {}) {
  const mine = local && userId ? await findConn(projectId, MINE, userId) : null;
  const env = mine || (await load(projectId)).envs.find((e) => e.kind === 'test') || null;
  if (!env) return null;
  const engine = engineOf(env.engine);
  return { url: openUrl(env), id: env.id, engine, engineLabel: ENGINE_LABELS[engine], placeholder: PLACEHOLDER[engine],
    name: env.id === MINE ? 'your own database' : `the ${env.name} database`, host: env.host || 'this computer', database: env.database };
}

// ---------------------------------------------------------------- before each test run

export async function getSetup(projectId: string): Promise<Setup> {
  return (await load(projectId)).setup || { kind: 'none', value: '' };
}
/** { kind: 'none' } · { kind: 'sql', value: 'db/seed.sql' } · { kind: 'npm', value: 'db:reset' } */
export async function saveSetup(projectId: string, input: any, actor: any) {
  const kind = String(input.kind || 'none') as Setup['kind'];
  if (!(kind in SETUP_KINDS)) throw fail(400, 'Choose what runs before each test run.');
  const value = String(input.value || '').trim();
  if (kind === 'sql' && !/^[\w@./ -]{1,300}\.sql$/i.test(value)) throw fail(400, 'Enter the path of a .sql file in the repository, like db/seed.sql.');
  if (kind === 'sql' && value.split('/').includes('..')) throw fail(400, 'Use a path inside the repository.');
  if (kind === 'npm' && !/^[\w:.-]{1,100}$/.test(value)) throw fail(400, 'Enter the name of a script in package.json, like db:reset.');
  const v = await load(projectId);
  v.setup = kind === 'none' ? { kind, value: '' } : { kind, value, updatedAt: new Date().toISOString(), updatedBy: actor?.name || null };
  await save(projectId, v);
  return v.setup;
}

// ---------------------------------------------------------------- connecting

/** Turns a driver error into a sentence that says what to fix. */
function explain(e: any, env: Env) {
  const where = env.host || env.database;
  const why: Record<string, string> = {
    ECONNREFUSED: `the connection to ${where} was refused. Check that the database is running and the host and port are right.`,
    ENOTFOUND: `the host ${where} was not found. Check the host in the connection string.`,
    ETIMEDOUT: `the connection to ${where} timed out. Check the host, the port and any firewall.`,
    ENOENT: `the SQLite file ${env.database} doesn’t exist on this computer.`,
    '28P01': 'the database rejected the user name or password.',
    '28000': 'the database refused this user. Check the user name and that it may connect from here.',
    '3D000': 'the database named in the connection string does not exist.',
    ER_ACCESS_DENIED_ERROR: 'the database rejected the user name or password.',
    ER_BAD_DB_ERROR: 'the database named in the connection string does not exist.',
    ELOGIN: 'the database rejected the user name or password.',
    ESOCKET: `the connection to ${where} failed. Check the host, the port and any firewall.`,
  };
  if (why[e?.code]) return `Couldn’t connect: ${why[e.code]}`;
  if (/timeout|timed out/i.test(e?.message || '')) return `Couldn’t connect: the connection to ${where} timed out. Check the host, the port and any firewall.`;
  return `Couldn’t connect: ${e?.message || String(e)}`;
}

/**
 * Opens one of the project's connections (or the person's own, id 'mine') and runs `fn` with it. Read-only unless
 * `write`, which is allowed for Test databases only. Throws a 400 with a plain explanation when it can't connect.
 */
export async function withClient<T>(projectId: string, id: string, fn: (conn: any, env: ReturnType<typeof view>) => Promise<T>,
  { timeoutMs = TEST_TIMEOUT_MS, purpose = 'connection test', userId = '', write = false } = {}) {
  const env = await findConn(projectId, id, userId);
  if (!env) throw fail(404, id === MINE ? 'You haven’t set up your own database for this project.' : 'That connection was removed. Refresh the page.');
  if (write && env.kind !== 'test') throw fail(400, `${env.name} is a ${KINDS[env.kind]} database: TicketForge only writes to Test databases.`);
  await checkReachable(env.engine, env.host);
  const url = openUrl(env);
  let conn: any;
  try { conn = await openDb(env.engine, url, { readOnly: !write, timeoutMs, purpose }); } catch (e: any) { throw fail(400, hideUrl(explain(e, env), url)); }
  try { return await fn(conn, view(env)); } catch (e: any) { throw e?.status ? e : fail(400, hideUrl(explain(e, env).replace('Couldn’t connect', 'The database refused the request'), url)); }
  finally { await conn.close(); }
}

/**
 * Connects, reads the server version, counts the app's tables and checks whether this user may write, without changing
 * anything. The result is saved on the connection.
 */
export async function testEnv(projectId: string, id: string, actor: any) {
  const result: LastTest = { ok: false, at: new Date().toISOString(), by: actor?.name || null };
  let env: any = null;
  try {
    const r = await withClient(projectId, id, async (conn, e) => { env = e; return conn.describe(); }, { userId: actor?.id || '' });
    Object.assign(result, { ok: true, version: r.version, tables: r.tables, canWrite: r.canWrite });
  } catch (e: any) {
    if (e?.status === 404) throw e;
    result.error = e.message;
  }
  // Save on the latest copy, so a test doesn't undo an edit made while it ran (or overwrite a newer address's result).
  if (id === MINE) {
    const cur = await findConn(projectId, MINE, actor?.id);
    if (cur && (!env || cur.updatedAt === env.updatedAt)) await setMeta(MINE_KEY(projectId, actor.id), { ...cur, lastTest: result });
    return { ...(env || (cur ? view(cur) : {})), lastTest: result };
  }
  const latest = await load(projectId);
  const target = latest.envs.find((e) => e.id === id);
  if (target && (!env || (target.host === env.host && target.updatedAt === env.updatedAt))) { target.lastTest = result; await save(projectId, latest); }
  return { ...(env || view(target!)), lastTest: result };
}

/** Reads the app's schema (tables, columns, keys, relations, indexes and enums), never rows. See lib/dbschema.ts. */
export async function readSchema(projectId: string, envId: string, userId = '') {
  return withClient(projectId, envId, async (conn, env) => {
    const { tables, enums } = await conn.schema();
    return { source: { type: 'database' as const, envId: env.id, name: env.name, kind: env.kind, engine: env.engine }, tables, enums };
  }, { timeoutMs: 20000, purpose: 'schema read', userId });
}

/** Runs a SQL file on a Test database in one transaction (the test setup step). */
export async function runScript(projectId: string, envId: string, sql: string, userId = '') {
  return withClient(projectId, envId, (conn) => conn.script(sql), { write: true, timeoutMs: 120000, purpose: 'test setup', userId });
}
