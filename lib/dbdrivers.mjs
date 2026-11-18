// Drivers for the databases of the apps projects build (Project settings → Database): PostgreSQL (and Supabase),
// MySQL / MariaDB, SQLite and SQL Server. Plain JavaScript, so the server (lib/appdb.ts) and the test runner
// (lib/run-one.mjs, plain Node) share it. Drivers load only when a project uses that engine.
//
//   const c = await openDb(engine, url, { readOnly: true, timeoutMs, purpose });
//   await c.query(sql, params)   → rows (placeholders: $1 on PostgreSQL, ? on MySQL and SQLite, @p1 on SQL Server)
//   await c.describe()           → { version, tables, canWrite }
//   await c.schema()             → { tables, enums } (catalogue only, never rows)
//   await c.script(sql)          → runs a whole SQL file in one transaction (write connections only)
//   await c.close()
//
// Read-only connections never change the database: PostgreSQL uses a read-only transaction, SQLite opens the file
// read-only, MySQL a read-only transaction plus a statement check (MySQL commits DDL implicitly), and SQL Server rolls
// every read back, also with the statement check.
import fs from 'node:fs';

export const ENGINE_LABELS = {
  postgres: 'PostgreSQL',
  supabase: 'Supabase',
  mysql: 'MySQL / MariaDB',
  sqlite: 'SQLite',
  sqlserver: 'SQL Server',
};
export const PLACEHOLDER = { postgres: '$1', supabase: '$1', mysql: '?', sqlite: '?', sqlserver: '@p1' };
const LOCAL = /^(localhost|127\.0\.0\.1|::1)$/;
// Schemas that belong to the database itself (or to Supabase), not to the app.
export const SYSTEM_SCHEMAS = [
  'pg_catalog',
  'information_schema',
  'pg_toast',
  'auth',
  'storage',
  'realtime',
  '_realtime',
  'supabase_functions',
  'supabase_migrations',
  'extensions',
  'graphql',
  'graphql_public',
  'vault',
  'pgsodium',
  'pgsodium_masks',
  'net',
  'cron',
  'pgbouncer',
  '_analytics',
  'tiger',
  'topology',
];
const PG_APP = "n.nspname <> all($1::text[]) and n.nspname not like 'pg\\_%'";
const fail = (message) => Object.assign(new Error(message), { status: 400 });

const isPostgres = (engine) => engine === 'postgres' || engine === 'supabase';

/**
 * Where a connection string points: { host, port, database, user } (for SQLite: host '' and the file as database).
 * Throws a 400 that says what's wrong.
 */
export function parseDbUrl(engine, url) {
  const s = String(url || '').trim();
  if (engine === 'sqlite') {
    const file = s.replace(/^sqlite:(\/\/)?/i, '').replace(/^file:(\/\/)?/i, '');
    if (!file.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(file))
      throw fail('Use the full path of the SQLite file, like /Users/me/myapp/dev.db (or sqlite:/Users/me/myapp/dev.db).');
    if (!/\.(db|sqlite3?|db3)$/i.test(file))
      throw fail('That doesn’t look like a SQLite file: use a file ending in .db, .sqlite or .sqlite3.');
    return { host: '', port: 0, database: file, user: '' };
  }
  let u;
  try {
    u = new URL(s);
  } catch {
    throw fail('That isn’t a valid connection string. URL-encode special characters in the password (such as @ # / as %40 %23 %2F).');
  }
  const want = isPostgres(engine) ? /^postgres(ql)?:$/ : engine === 'mysql' ? /^(mysql|mariadb):$/ : /^(sqlserver|mssql):$/;
  const example = isPostgres(engine)
    ? 'postgresql://user:password@host:5432/database'
    : engine === 'mysql'
      ? 'mysql://user:password@host:3306/database'
      : 'sqlserver://user:password@host:1433/database';
  if (!want.test(u.protocol) || !u.hostname) throw fail(`Use a connection string like ${example}.`);
  const port = Number(u.port) || (isPostgres(engine) ? 5432 : engine === 'mysql' ? 3306 : 1433);
  return {
    host: u.hostname.replace(/^\[|\]$/g, ''),
    port,
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || (isPostgres(engine) ? 'postgres' : ''),
    user: decodeURIComponent(u.username),
  };
}

/** On MySQL and SQL Server a read-only connection only runs statements that read. */
function assertReadStatement(engine, sql) {
  const s = String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .trim();
  const first = (s.match(/^\(*\s*(\w+)/)?.[1] || '').toLowerCase();
  const ok = engine === 'mysql' ? ['select', 'with', 'show', 'explain', 'describe', 'desc', 'table', 'values'] : ['select', 'with'];
  if (!ok.includes(first) || /\binto\s+(outfile|dumpfile)\b/i.test(s) || /;\s*\S/.test(s)) {
    throw new Error(
      `Only one statement that reads (${ok
        .slice(0, 2)
        .map((x) => x.toUpperCase())
        .join(', ')}…) can run here: TicketForge never changes this database.`,
    );
  }
}

// ---------------------------------------------------------------- PostgreSQL

async function openPostgres(url, { readOnly, timeoutMs, purpose }) {
  const { default: pg } = await import('pg');
  const host = new URL(url).hostname;
  // An sslmode in the connection string wins; otherwise encrypt (without verifying) anything that isn't local.
  const ssl = /[?&]sslmode=/.test(url) || LOCAL.test(host) ? undefined : { rejectUnauthorized: false };
  const client = new pg.Client({
    connectionString: url,
    ssl,
    connectionTimeoutMillis: 8000,
    statement_timeout: timeoutMs,
    query_timeout: timeoutMs + 1000,
    application_name: `TicketForge (${purpose})`,
  });
  client.on('error', () => {});
  await client.connect();
  const q = async (sql, params = []) => (await client.query(String(sql), params)).rows;
  // Every read is its own read-only transaction, rolled back.
  const read = async (sql, params) => {
    await client.query('begin read only');
    try {
      return await q(sql, params);
    } finally {
      await client.query('rollback').catch(() => {});
    }
  };
  return {
    query: (sql, params) => (readOnly ? read(sql, params) : q(sql, params)),
    async describe() {
      const [r] = await read(
        `select current_setting('server_version') as version,
        (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'p') and ${PG_APP}) as tables,
        coalesce((select bool_or(has_table_privilege(c.oid, 'INSERT')) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r', 'p') and ${PG_APP}), false) as can_write`,
        [SYSTEM_SCHEMAS],
      );
      return { version: `PostgreSQL ${String(r.version).split(' ')[0]}`, tables: r.tables, canWrite: r.can_write };
    },
    async schema() {
      const args = [SYSTEM_SCHEMAS];
      await client.query('begin read only');
      try {
        const cols = await q(
          `select n.nspname as s, c.relname as t, a.attname as col, format_type(a.atttypid, a.atttypmod) as type,
            a.attnotnull as notnull, pg_get_expr(d.adbin, d.adrelid) as dflt
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
          left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
          where c.relkind in ('r', 'p') and not c.relispartition and ${PG_APP}
          order by n.nspname, c.relname, a.attnum`,
          args,
        );
        const cons = await q(
          `select n.nspname as s, c.relname as t, con.contype as kind,
            array(select a.attname::text from unnest(con.conkey) with ordinality k(num, ord) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.num order by k.ord) as cols,
            fn.nspname as fs, fc.relname as ft,
            array(select a.attname::text from unnest(con.confkey) with ordinality k(num, ord) join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.num order by k.ord) as fcols
          from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
          left join pg_class fc on fc.oid = con.confrelid left join pg_namespace fn on fn.oid = fc.relnamespace
          where con.contype in ('p', 'f', 'u') and ${PG_APP}
          order by n.nspname, c.relname, con.conname`,
          args,
        );
        const idx = await q(
          `select n.nspname as s, t.relname as t, i.relname as name, ix.indisunique as uniq,
            array(select pg_get_indexdef(ix.indexrelid, k, true) from generate_series(1, ix.indnkeyatts) k) as cols
          from pg_index ix join pg_class i on i.oid = ix.indexrelid join pg_class t on t.oid = ix.indrelid join pg_namespace n on n.oid = t.relnamespace
          where not ix.indisprimary and not exists (select 1 from pg_constraint con where con.conindid = ix.indexrelid and con.contype = 'u') and ${PG_APP}
          order by n.nspname, t.relname, i.relname`,
          args,
        );
        const enums = await q(
          `select n.nspname as s, t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as vals
          from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
          where ${PG_APP} group by n.nspname, t.typname order by 1, 2`,
          args,
        );
        const b = builder();
        for (const r of cols) b.column(r.s, r.t, { name: r.col, type: r.type, nullable: !r.notnull, default: r.dflt });
        for (const r of cons) {
          if (r.kind === 'p') b.primaryKey(r.s, r.t, r.cols);
          else if (r.kind === 'u') b.unique(r.s, r.t, r.cols);
          else b.foreignKey(r.s, r.t, r.cols, r.fs, r.ft, r.fcols);
        }
        for (const r of idx) b.index(r.s, r.t, r.name, r.cols, r.uniq);
        return { tables: b.tables(), enums: enums.map((r) => ({ schema: r.s, name: r.name, values: r.vals })) };
      } finally {
        await client.query('rollback').catch(() => {});
      }
    },
    async script(sql) {
      await client.query('begin');
      try {
        await client.query(String(sql));
        await client.query('commit');
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      }
    },
    close: () => client.end().catch(() => {}),
  };
}

// ---------------------------------------------------------------- MySQL / MariaDB

async function openMysql(url, { readOnly, timeoutMs }) {
  const { default: mysql } = await import('mysql2/promise');
  const u = new URL(url);
  const sslParam = u.searchParams.get('ssl') ?? u.searchParams.get('sslmode') ?? u.searchParams.get('ssl-mode');
  // TLS for anything that isn't local, unless the connection string says ssl=false (or sslmode=disable).
  const ssl =
    sslParam != null
      ? /^(false|0|disable|disabled)$/i.test(sslParam)
        ? undefined
        : { rejectUnauthorized: false }
      : LOCAL.test(u.hostname)
        ? undefined
        : { rejectUnauthorized: false };
  const conn = await mysql.createConnection({
    host: u.hostname,
    port: Number(u.port) || 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || undefined,
    ssl,
    connectTimeout: 8000,
    multipleStatements: !readOnly,
    dateStrings: true,
  });
  conn.on('error', () => {});
  const q = async (sql, params = []) => {
    const [rows] = await conn.query({ sql: String(sql), timeout: timeoutMs }, params);
    return Array.isArray(rows) ? rows : [];
  };
  const read = async (sql, params) => {
    assertReadStatement('mysql', sql);
    await conn.query('START TRANSACTION READ ONLY');
    try {
      return await q(sql, params);
    } finally {
      await conn.query('ROLLBACK').catch(() => {});
    }
  };
  return {
    query: (sql, params) => (readOnly ? read(sql, params) : q(sql, params)),
    async describe() {
      const [r] = await q(`select version() as version,
        (select count(*) from information_schema.tables where table_schema = database() and table_type = 'BASE TABLE') as tables,
        ((select count(*) from information_schema.user_privileges where privilege_type = 'INSERT')
          + (select count(*) from information_schema.schema_privileges where table_schema = database() and privilege_type = 'INSERT')) as can_write`);
      const v = String(r.version);
      return {
        version: `${/mariadb/i.test(v) ? 'MariaDB' : 'MySQL'} ${v.split('-')[0]}`,
        tables: Number(r.tables),
        canWrite: Number(r.can_write) > 0,
      };
    },
    async schema() {
      const cols =
        await q(`select table_name as t, column_name as col, column_type as type, is_nullable = 'YES' as nullable, column_default as dflt
        from information_schema.columns c where table_schema = database()
          and exists (select 1 from information_schema.tables x where x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE')
        order by table_name, ordinal_position`);
      const keys = await q(`select k.table_name as t, k.constraint_name as name, tc.constraint_type as kind, k.column_name as col,
          k.referenced_table_name as ft, k.referenced_column_name as fcol
        from information_schema.key_column_usage k join information_schema.table_constraints tc
          on tc.constraint_schema = k.constraint_schema and tc.table_name = k.table_name and tc.constraint_name = k.constraint_name
        where k.table_schema = database() order by k.table_name, k.constraint_name, k.ordinal_position`);
      const idx = await q(`select table_name as t, index_name as name, non_unique = 0 as uniq, column_name as col
        from information_schema.statistics where table_schema = database() and index_name <> 'PRIMARY' order by table_name, index_name, seq_in_index`);
      const b = builder();
      for (const r of cols) b.column('', r.t, { name: r.col, type: r.type, nullable: Boolean(r.nullable), default: r.dflt });
      for (const g of group(keys, (r) => `${r.t}\u0000${r.name}`)) {
        const r = g[0];
        if (r.kind === 'PRIMARY KEY')
          b.primaryKey(
            '',
            r.t,
            g.map((x) => x.col),
          );
        else if (r.kind === 'UNIQUE')
          b.unique(
            '',
            r.t,
            g.map((x) => x.col),
          );
        else if (r.kind === 'FOREIGN KEY')
          b.foreignKey(
            '',
            r.t,
            g.map((x) => x.col),
            '',
            r.ft,
            g.map((x) => x.fcol),
          );
      }
      const uniqueNames = new Set(keys.filter((r) => r.kind === 'UNIQUE' || r.kind === 'FOREIGN KEY').map((r) => `${r.t}\u0000${r.name}`));
      for (const g of group(idx, (r) => `${r.t}\u0000${r.name}`))
        if (!uniqueNames.has(`${g[0].t}\u0000${g[0].name}`))
          b.index(
            '',
            g[0].t,
            g[0].name,
            g.map((x) => x.col),
            Boolean(g[0].uniq),
          );
      return { tables: b.tables(), enums: [] };
    },
    async script(sql) {
      // MySQL commits DDL (create, alter, drop) on its own: a failure part-way keeps the DDL that already ran.
      await conn.query('START TRANSACTION');
      try {
        await conn.query({ sql: String(sql), timeout: timeoutMs });
        await conn.query('COMMIT');
      } catch (e) {
        await conn.query('ROLLBACK').catch(() => {});
        throw e;
      }
    },
    close: () => conn.end().catch(() => {}),
  };
}

// ---------------------------------------------------------------- SQLite

async function openSqlite(url, { readOnly, timeoutMs }) {
  const { DatabaseSync } = await import('node:sqlite');
  const file = parseDbUrl('sqlite', url).database;
  if (!fs.existsSync(file)) throw Object.assign(new Error(`The SQLite file ${file} doesn’t exist on this computer.`), { code: 'ENOENT' });
  const db = new DatabaseSync(file, { readOnly, timeout: Math.min(timeoutMs, 10000) });
  const all = (sql, params = []) => db.prepare(String(sql)).all(...params);
  return {
    query: async (sql, params) => all(sql, params),
    async describe() {
      const [v] = all('select sqlite_version() as v');
      const [n] = all("select count(*) as n from sqlite_master where type = 'table' and name not like 'sqlite\\_%' escape '\\'");
      let canWrite = false;
      try {
        fs.accessSync(file, fs.constants.W_OK);
        canWrite = true;
      } catch {
        /* read-only file */
      }
      return { version: `SQLite ${v.v}`, tables: Number(n.n), canWrite };
    },
    async schema() {
      const b = builder();
      const tables = all("select name from sqlite_master where type = 'table' and name not like 'sqlite\\_%' escape '\\' order by name");
      for (const { name } of tables) {
        const q = (pragma) => all(`select * from pragma_${pragma}(?)`, [name]);
        const cols = q('table_info');
        for (const c of cols)
          b.column('', name, {
            name: c.name,
            type: String(c.type || '').toLowerCase(),
            nullable: !c.notnull && !c.pk,
            default: c.dflt_value,
          });
        const pk = cols
          .filter((c) => c.pk)
          .sort((a, c) => a.pk - c.pk)
          .map((c) => c.name);
        if (pk.length) b.primaryKey('', name, pk);
        for (const g of group(q('foreign_key_list'), (r) => String(r.id)))
          b.foreignKey(
            '',
            name,
            g.map((r) => r.from),
            '',
            g[0].table,
            g.map((r) => r.to || 'id'),
          );
        for (const ix of q('index_list')) {
          if (ix.origin === 'pk') continue;
          const icols = all('select name from pragma_index_info(?)', [ix.name]).map((r) => r.name);
          if (ix.origin === 'u') b.unique('', name, icols);
          else b.index('', name, ix.name, icols, Boolean(ix.unique));
        }
      }
      return { tables: b.tables(), enums: [] };
    },
    async script(sql) {
      db.exec('begin');
      try {
        db.exec(String(sql));
        db.exec('commit');
      } catch (e) {
        try {
          db.exec('rollback');
        } catch {
          /* already rolled back */
        }
        throw e;
      }
    },
    close: async () => {
      try {
        db.close();
      } catch {
        /* closed */
      }
    },
  };
}

// ---------------------------------------------------------------- SQL Server

async function openSqlServer(url, { readOnly, timeoutMs }) {
  const { default: mssql } = await import('mssql');
  const u = new URL(url);
  const param = (k) => u.searchParams.get(k);
  const pool = new mssql.ConnectionPool({
    server: u.hostname,
    port: Number(u.port) || 1433,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || undefined,
    connectionTimeout: 8000,
    requestTimeout: timeoutMs,
    options: {
      encrypt: !/^(false|no|0)$/i.test(param('encrypt') || ''),
      trustServerCertificate: !/^(false|no|0)$/i.test(param('trustServerCertificate') || ''),
      appName: 'TicketForge',
    },
    pool: { max: 1, min: 0 },
  });
  pool.on('error', () => {});
  await pool.connect();
  const run = async (sql, params = [], tx = null) => {
    const req = tx ? new mssql.Request(tx) : pool.request();
    params.forEach((v, i) => req.input(`p${i + 1}`, v));
    return (await req.query(String(sql))).recordset || [];
  };
  // SQL Server has no read-only transaction: each read runs in a transaction that is always rolled back.
  const read = async (sql, params) => {
    assertReadStatement('sqlserver', sql);
    const tx = new mssql.Transaction(pool);
    await tx.begin();
    try {
      return await run(sql, params, tx);
    } finally {
      await tx.rollback().catch(() => {});
    }
  };
  return {
    query: (sql, params) => (readOnly ? read(sql, params) : run(sql, params)),
    async describe() {
      const [r] =
        await run(`select cast(serverproperty('ProductVersion') as nvarchar(64)) as version, (select count(*) from sys.tables where is_ms_shipped = 0) as tables,
        cast(case when is_srvrolemember('sysadmin') = 1 or is_rolemember('db_owner') = 1 or is_rolemember('db_datawriter') = 1 then 1 else 0 end as bit) as can_write`);
      return { version: `SQL Server ${r.version}`, tables: Number(r.tables), canWrite: Boolean(r.can_write) };
    },
    async schema() {
      const cols = await run(`select s.name as s, t.name as t, c.name as col,
          ty.name + case when ty.name in ('varchar', 'nvarchar', 'char', 'nchar', 'varbinary') then '(' + case when c.max_length = -1 then 'max' else cast(case when ty.name like 'n%' then c.max_length / 2 else c.max_length end as varchar) end + ')'
            when ty.name in ('decimal', 'numeric') then '(' + cast(c.precision as varchar) + ',' + cast(c.scale as varchar) + ')' else '' end as type,
          c.is_nullable as nullable, object_definition(c.default_object_id) as dflt
        from sys.tables t join sys.schemas s on s.schema_id = t.schema_id join sys.columns c on c.object_id = t.object_id
        join sys.types ty on ty.user_type_id = c.user_type_id where t.is_ms_shipped = 0 order by s.name, t.name, c.column_id`);
      const idx =
        await run(`select s.name as s, t.name as t, i.name as name, i.is_primary_key as pk, i.is_unique_constraint as uq, i.is_unique as uniq, c.name as col
        from sys.indexes i join sys.tables t on t.object_id = i.object_id join sys.schemas s on s.schema_id = t.schema_id
        join sys.index_columns ic on ic.object_id = i.object_id and ic.index_id = i.index_id join sys.columns c on c.object_id = ic.object_id and c.column_id = ic.column_id
        where t.is_ms_shipped = 0 and i.type > 0 and ic.is_included_column = 0 order by s.name, t.name, i.name, ic.key_ordinal`);
      const fks = await run(`select s.name as s, t.name as t, fk.name as name, c.name as col, rs.name as fs, rt.name as ft, rc.name as fcol
        from sys.foreign_keys fk join sys.foreign_key_columns fkc on fkc.constraint_object_id = fk.object_id
        join sys.tables t on t.object_id = fk.parent_object_id join sys.schemas s on s.schema_id = t.schema_id
        join sys.columns c on c.object_id = fkc.parent_object_id and c.column_id = fkc.parent_column_id
        join sys.tables rt on rt.object_id = fk.referenced_object_id join sys.schemas rs on rs.schema_id = rt.schema_id
        join sys.columns rc on rc.object_id = fkc.referenced_object_id and rc.column_id = fkc.referenced_column_id
        where t.is_ms_shipped = 0 order by s.name, t.name, fk.name, fkc.constraint_column_id`);
      const b = builder();
      for (const r of cols) b.column(r.s, r.t, { name: r.col, type: r.type, nullable: Boolean(r.nullable), default: r.dflt });
      for (const g of group(idx, (r) => `${r.s}\u0000${r.t}\u0000${r.name}`)) {
        const r = g[0],
          list = g.map((x) => x.col);
        if (r.pk) b.primaryKey(r.s, r.t, list);
        else if (r.uq) b.unique(r.s, r.t, list);
        else b.index(r.s, r.t, r.name, list, Boolean(r.uniq));
      }
      for (const g of group(fks, (r) => `${r.s}\u0000${r.t}\u0000${r.name}`))
        b.foreignKey(
          g[0].s,
          g[0].t,
          g.map((x) => x.col),
          g[0].fs,
          g[0].ft,
          g.map((x) => x.fcol),
        );
      return { tables: b.tables(), enums: [] };
    },
    async script(sql) {
      // Batches separated by GO lines (as SQL Server Management Studio writes them), all in one transaction.
      const batches = String(sql)
        .split(/^\s*GO\s*;?\s*$/gim)
        .map((x) => x.trim())
        .filter(Boolean);
      const tx = new mssql.Transaction(pool);
      await tx.begin();
      try {
        for (const batch of batches) await new mssql.Request(tx).batch(batch);
        await tx.commit();
      } catch (e) {
        await tx.rollback().catch(() => {});
        throw e;
      }
    },
    close: () => pool.close().catch(() => {}),
  };
}

// ---------------------------------------------------------------- shared

/** Collects tables from catalogue rows. Schema '' (MySQL, SQLite) and the default schemas read as no schema. */
function builder() {
  const map = new Map();
  const get = (s, t) => {
    const k = `${s}\u0000${t}`;
    if (!map.has(k)) map.set(k, { schema: s || '', name: t, columns: [], primaryKey: [], foreignKeys: [], unique: [], indexes: [] });
    return map.get(k);
  };
  const has = (s, t) => map.has(`${s}\u0000${t}`);
  const ref = (s, t) => (s && !['public', 'dbo', 'main'].includes(s) ? `${s}.${t}` : t);
  return {
    column: (s, t, c) =>
      get(s, t).columns.push({
        name: c.name,
        type: String(c.type),
        nullable: Boolean(c.nullable),
        ...(c.default != null && c.default !== '' ? { default: String(c.default).slice(0, 80) } : {}),
      }),
    primaryKey: (s, t, cols) => {
      if (has(s, t)) get(s, t).primaryKey = cols;
    },
    unique: (s, t, cols) => {
      if (has(s, t)) get(s, t).unique.push(cols);
    },
    foreignKey: (s, t, cols, fs, ft, fcols) => {
      if (has(s, t)) get(s, t).foreignKeys.push({ columns: cols, refTable: ref(fs, ft), refColumns: fcols });
    },
    index: (s, t, name, cols, unique) => {
      if (has(s, t)) get(s, t).indexes.push({ name, columns: cols, unique });
    },
    tables: () =>
      [...map.values()].map((t) => {
        for (const c of t.columns)
          if (t.primaryKey.includes(c.name)) {
            c.pk = true;
            c.nullable = false;
          }
        return t;
      }),
  };
}
function group(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return [...m.values()];
}

/** Opens a connection to one of the supported engines. */
export async function openDb(engine, url, { readOnly = true, timeoutMs = 10000, purpose = 'connection test' } = {}) {
  if (isPostgres(engine)) return openPostgres(url, { readOnly, timeoutMs, purpose });
  if (engine === 'mysql') return openMysql(url, { readOnly, timeoutMs, purpose });
  if (engine === 'sqlite') return openSqlite(url, { readOnly, timeoutMs, purpose });
  if (engine === 'sqlserver') return openSqlServer(url, { readOnly, timeoutMs, purpose });
  throw fail(`Unknown database engine “${engine}”.`);
}

/** The connection string and password hidden in a message. */
export function hideUrl(text, url) {
  let out = String(text ?? '');
  if (!url) return out;
  out = out.split(url).join('[database]');
  try {
    const pw = decodeURIComponent(new URL(url).password);
    if (pw.length >= 3) out = out.split(pw).join('••••••');
  } catch {
    /* SQLite path */
  }
  return out;
}
