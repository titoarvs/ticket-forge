// The databases of the app a project builds (Project settings → Database), not TicketForge's own database.
// A project keeps a few connections (Test, Staging, Production). Each connection string is encrypted (AES-256-GCM) in
// app_meta, which row-level security limits to the server, like the test-role passwords in lib/secrets.ts: it's never
// put in the project data, never sent to the browser, exported or shown to the AI. The browser sees host, port,
// database and user only.
import crypto from 'node:crypto';
import { getMeta, setMeta, deleteMeta } from './appmeta';
import { encrypt, decrypt } from './settings';
import { isSaas } from './platform';
import { isPrivateHost } from './netguard';

export const ENGINES = { postgres: 'PostgreSQL', supabase: 'Supabase' } as const;
// test: tests and code jobs may write to it later (Phase 3). staging: read-only. production: schema only, never rows.
export const KINDS = { test: 'Test', staging: 'Staging', production: 'Production' } as const;
const MAX_ENVS = 10;
const TEST_TIMEOUT_MS = 8000;

type Engine = keyof typeof ENGINES;
type Kind = keyof typeof KINDS;
type Box = ReturnType<typeof encrypt>;
type LastTest = { ok: boolean; at: string; by: string | null; version?: string; tables?: number; canWrite?: boolean; error?: string };
type Env = {
  id: string; name: string; kind: Kind; engine: Engine; urlEnc: Box;
  host: string; port: number; database: string; user: string;
  updatedAt: string; updatedBy: string | null; lastTest?: LastTest | null;
};

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const KEY = (projectId: string) => `project_db:${projectId}`;

async function load(projectId: string): Promise<{ envs: Env[] }> {
  const v = await getMeta(KEY(projectId));
  return Array.isArray(v?.envs) ? v : { envs: [] };
}
const save = (projectId: string, v: { envs: Env[] }) => setMeta(KEY(projectId), v);

/** What the browser may see: everything but the connection string. */
const view = ({ urlEnc: _u, ...env }: Env) => env;
export async function listEnvs(projectId: string) {
  return (await load(projectId)).envs.map(view);
}

/** Reads host, port, database and user from a postgres:// address, or says what's wrong with it. */
export function parseUrl(url: string) {
  let u: URL;
  try { u = new URL(url); } catch { throw fail(400, 'That isn’t a valid connection string. Use the form postgresql://user:password@host:5432/database (URL-encode special characters in the password, such as @ # / as %40 %23 %2F).'); }
  if (!/^postgres(ql)?:$/.test(u.protocol) || !u.hostname) throw fail(400, 'Use a PostgreSQL connection string that starts with postgresql:// or postgres://.');
  return { host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) || 5432, database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres', user: decodeURIComponent(u.username) };
}

async function checkReachable(host: string) {
  if (isSaas() && await isPrivateHost(host)) {
    throw fail(400, `${host} is a private or internal address. On the hosted service, connect a database that’s reachable on the internet.`);
  }
}

/** Adds or changes a connection. With an id and no url, the saved connection string is kept. */
export async function saveEnv(projectId: string, input: any, actor: any) {
  const v = await load(projectId);
  const cur = input.id ? v.envs.find((e) => e.id === input.id) : null;
  if (input.id && !cur) throw fail(404, 'That connection was removed. Refresh the page.');
  if (!cur && v.envs.length >= MAX_ENVS) throw fail(400, `A project can have up to ${MAX_ENVS} database connections.`);
  const name = String(input.name ?? cur?.name ?? '').trim().slice(0, 60);
  if (!name) throw fail(400, 'Give the connection a name, like “Test”.');
  if (v.envs.some((e) => e.id !== cur?.id && e.name.toLowerCase() === name.toLowerCase())) throw fail(400, `There’s already a connection called “${name}”.`);
  const kind = (input.kind ?? cur?.kind) as Kind;
  if (!(kind in KINDS)) throw fail(400, 'Choose Test, Staging or Production.');
  const engine = (input.engine ?? cur?.engine ?? 'postgres') as Engine;
  if (!(engine in ENGINES)) throw fail(400, 'Choose PostgreSQL or Supabase.');
  const url = String(input.url ?? '').trim();
  if (!url && !cur) throw fail(400, 'Paste the connection string.');
  if (url.length > 2000) throw fail(400, 'That connection string is too long.');
  const parts = url ? parseUrl(url) : null;
  if (parts) await checkReachable(parts.host);
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

export async function removeEnv(projectId: string, id: string) {
  const v = await load(projectId);
  if (!v.envs.some((e) => e.id === id)) throw fail(404, 'That connection was already removed.');
  v.envs = v.envs.filter((e) => e.id !== id);
  if (v.envs.length) await save(projectId, v); else await deleteMeta(KEY(projectId));
}

/** Turns a driver error into a sentence that says what to fix. */
function explain(e: any, host: string) {
  const why: Record<string, string> = {
    ECONNREFUSED: `the connection to ${host} was refused. Check that the database is running and the host and port are right.`,
    ENOTFOUND: `the host ${host} was not found. Check the host in the connection string.`,
    ETIMEDOUT: `the connection to ${host} timed out. Check the host, the port and any firewall.`,
    '28P01': 'the database rejected the user name or password.',
    '28000': 'the database refused this user. Check the user name and that it may connect from here.',
    '3D000': 'the database named in the connection string does not exist.',
  };
  if (why[e?.code]) return `Couldn’t connect: ${why[e.code]}`;
  if (/timeout/i.test(e?.message || '')) return `Couldn’t connect: the connection to ${host} timed out. Check the host, the port and any firewall.`;
  return `Couldn’t connect: ${e?.message || String(e)}`;
}

/**
 * Connects, reads the server version, counts the tables and checks whether this user may write, all inside a
 * read-only transaction that changes nothing. The result is saved on the connection.
 */
export async function testEnv(projectId: string, id: string, actor: any) {
  const v = await load(projectId);
  const env = v.envs.find((e) => e.id === id);
  if (!env) throw fail(404, 'That connection was removed. Refresh the page.');
  await checkReachable(env.host);
  let url: string;
  try { url = decrypt(env.urlEnc); } catch { throw fail(400, 'The saved connection string can’t be read any more (the encryption key changed). Paste it again.'); }
  const result: LastTest = { ok: false, at: new Date().toISOString(), by: actor?.name || null };
  const { default: pg } = await import('pg');
  const local = /^(localhost|127\.0\.0\.1|::1)$/.test(env.host);
  // An sslmode in the connection string wins; otherwise encrypt (without verifying) anything that isn't local.
  const ssl = /[?&]sslmode=/.test(url) || local ? undefined : { rejectUnauthorized: false };
  const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: TEST_TIMEOUT_MS, statement_timeout: TEST_TIMEOUT_MS, query_timeout: TEST_TIMEOUT_MS + 1000, application_name: 'TicketForge (connection test)' });
  client.on('error', () => { /* reported through the failed query */ });
  try {
    await client.connect();
    await client.query('begin read only');
    const r = await client.query(`select current_setting('server_version') as version,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%') as tables,
      coalesce((select bool_or(has_table_privilege(c.oid, 'INSERT')) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'), false) as can_write`);
    await client.query('rollback');
    Object.assign(result, { ok: true, version: String(r.rows[0].version).split(' ')[0], tables: r.rows[0].tables, canWrite: r.rows[0].can_write });
  } catch (e: any) {
    result.error = explain(e, env.host);
  } finally {
    await client.end().catch(() => {});
  }
  // Save on the latest copy, so a test doesn't undo an edit made while it ran.
  const latest = await load(projectId);
  const target = latest.envs.find((e) => e.id === id);
  if (target && target.urlEnc?.data === env.urlEnc.data) { target.lastTest = result; await save(projectId, latest); }
  return { ...view(env), lastTest: result };
}
