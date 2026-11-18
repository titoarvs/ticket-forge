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
import { tableKey, type Table } from './dbschema';

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

// Schemas that belong to PostgreSQL or to Supabase itself, not to the app: left out of table counts and schema reads.
export const SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_toast', 'auth', 'storage', 'realtime', '_realtime', 'supabase_functions',
  'supabase_migrations', 'extensions', 'graphql', 'graphql_public', 'vault', 'pgsodium', 'pgsodium_masks', 'net', 'cron', 'pgbouncer', '_analytics', 'tiger', 'topology'];
/** SQL that keeps a pg_namespace alias `n` to the app's own schemas ($1 = SYSTEM_SCHEMAS). */
export const APP_SCHEMAS_SQL = "n.nspname <> all($1::text[]) and n.nspname not like 'pg\\_%'";

/**
 * Opens one of the project's connections and runs `fn` inside a read-only transaction that is always rolled back, so
 * nothing in the database can change. Throws a 400 with a plain explanation when it can't connect.
 */
export async function withClient<T>(projectId: string, id: string, fn: (client: any, env: ReturnType<typeof view>) => Promise<T>, { timeoutMs = TEST_TIMEOUT_MS, purpose = 'connection test' } = {}) {
  const env = (await load(projectId)).envs.find((e) => e.id === id);
  if (!env) throw fail(404, 'That connection was removed. Refresh the page.');
  await checkReachable(env.host);
  let url: string;
  try { url = decrypt(env.urlEnc); } catch { throw fail(400, 'The saved connection string can’t be read any more (the encryption key changed). Paste it again.'); }
  const { default: pg } = await import('pg');
  const local = /^(localhost|127\.0\.0\.1|::1)$/.test(env.host);
  // An sslmode in the connection string wins; otherwise encrypt (without verifying) anything that isn't local.
  const ssl = /[?&]sslmode=/.test(url) || local ? undefined : { rejectUnauthorized: false };
  const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: TEST_TIMEOUT_MS, statement_timeout: timeoutMs, query_timeout: timeoutMs + 1000, application_name: `TicketForge (${purpose})` });
  client.on('error', () => { /* reported through the failed query */ });
  try {
    try { await client.connect(); await client.query('begin read only'); } catch (e: any) { throw fail(400, explain(e, env.host)); }
    try { return await fn(client, view(env)); } catch (e: any) { throw e?.status ? e : fail(400, explain(e, env.host).replace('Couldn’t connect', 'The database refused the request')); }
  } finally {
    await client.query('rollback').catch(() => {});
    await client.end().catch(() => {});
  }
}

/**
 * Connects, reads the server version, counts the app's tables and checks whether this user may write, all inside a
 * read-only transaction that changes nothing. The result is saved on the connection.
 */
export async function testEnv(projectId: string, id: string, actor: any) {
  const result: LastTest = { ok: false, at: new Date().toISOString(), by: actor?.name || null };
  let env: any = null;
  try {
    const r = await withClient(projectId, id, async (client, e) => {
      env = e;
      return (await client.query(`select current_setting('server_version') as version,
        (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'p') and ${APP_SCHEMAS_SQL}) as tables,
        coalesce((select bool_or(has_table_privilege(c.oid, 'INSERT')) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r', 'p') and ${APP_SCHEMAS_SQL}), false) as can_write`, [SYSTEM_SCHEMAS])).rows[0];
    });
    Object.assign(result, { ok: true, version: String(r.version).split(' ')[0], tables: r.tables, canWrite: r.can_write });
  } catch (e: any) {
    if (e?.status === 404) throw e;
    result.error = e.message;
  }
  // Save on the latest copy, so a test doesn't undo an edit made while it ran (or overwrite a newer address's result).
  const latest = await load(projectId);
  const target = latest.envs.find((e) => e.id === id);
  if (target && (!env || (target.host === env.host && target.updatedAt === env.updatedAt))) { target.lastTest = result; await save(projectId, latest); }
  return { ...(env || view(target!)), lastTest: result };
}

// The app's schema (tables, columns, keys, relations, indexes and enums), never rows. See lib/dbschema.ts.
/** Reads the app's schema through one of the project's connections (catalogue only, in a read-only transaction). */
export async function readSchema(projectId: string, envId: string) {
  return withClient(projectId, envId, async (client, env) => {
    const args = [SYSTEM_SCHEMAS];
    const cols = (await client.query(`select n.nspname as s, c.relname as t, a.attname as col, format_type(a.atttypid, a.atttypmod) as type,
        a.attnotnull as notnull, pg_get_expr(d.adbin, d.adrelid) as dflt
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
      where c.relkind in ('r', 'p') and not c.relispartition and ${APP_SCHEMAS_SQL}
      order by n.nspname, c.relname, a.attnum`, args)).rows;
    const cons = (await client.query(`select n.nspname as s, c.relname as t, con.contype as kind,
        array(select a.attname::text from unnest(con.conkey) with ordinality k(num, ord) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.num order by k.ord) as cols,
        fn.nspname as fs, fc.relname as ft,
        array(select a.attname::text from unnest(con.confkey) with ordinality k(num, ord) join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.num order by k.ord) as fcols
      from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
      left join pg_class fc on fc.oid = con.confrelid left join pg_namespace fn on fn.oid = fc.relnamespace
      where con.contype in ('p', 'f', 'u') and ${APP_SCHEMAS_SQL}
      order by n.nspname, c.relname, con.conname`, args)).rows;
    const idx = (await client.query(`select n.nspname as s, t.relname as t, i.relname as name, ix.indisunique as uniq,
        array(select pg_get_indexdef(ix.indexrelid, k, true) from generate_series(1, ix.indnkeyatts) k) as cols
      from pg_index ix join pg_class i on i.oid = ix.indexrelid join pg_class t on t.oid = ix.indrelid join pg_namespace n on n.oid = t.relnamespace
      where not ix.indisprimary and not exists (select 1 from pg_constraint con where con.conindid = ix.indexrelid and con.contype = 'u') and ${APP_SCHEMAS_SQL}
      order by n.nspname, t.relname, i.relname`, args)).rows;
    const enums = (await client.query(`select n.nspname as s, t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as vals
      from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
      where ${APP_SCHEMAS_SQL} group by n.nspname, t.typname order by 1, 2`, args)).rows;

    const tables = new Map<string, Table>();
    const get = (s: string, t: string) => {
      const k = `${s}.${t}`;
      if (!tables.has(k)) tables.set(k, { schema: s, name: t, columns: [], primaryKey: [], foreignKeys: [], unique: [], indexes: [] });
      return tables.get(k)!;
    };
    for (const r of cols) get(r.s, r.t).columns.push({ name: r.col, type: r.type, nullable: !r.notnull, ...(r.dflt ? { default: String(r.dflt).slice(0, 80) } : {}) });
    for (const r of cons) {
      if (!tables.has(`${r.s}.${r.t}`)) continue;
      const t = get(r.s, r.t);
      if (r.kind === 'p') t.primaryKey = r.cols;
      else if (r.kind === 'u') t.unique.push(r.cols);
      else t.foreignKeys.push({ columns: r.cols, refTable: tableKey({ schema: r.fs, name: r.ft }), refColumns: r.fcols });
    }
    for (const r of idx) if (tables.has(`${r.s}.${r.t}`)) get(r.s, r.t).indexes.push({ name: r.name, columns: r.cols, unique: r.uniq });
    for (const t of tables.values()) for (const c of t.columns) if (t.primaryKey.includes(c.name)) c.pk = true;
    return {
      source: { type: 'database' as const, envId: env.id, name: env.name, kind: env.kind },
      tables: [...tables.values()],
      enums: enums.map((r: any) => ({ schema: r.s, name: r.name, values: r.vals })),
    };
  }, { timeoutMs: 20000, purpose: 'schema read' });
}
