import crypto from 'node:crypto';
import {
  type Table,
  type Enum,
  unq,
  type Column,
  tableKey,
  names,
  stripComments,
  table,
  topLevel,
  bracketed,
  finish,
  type Reader,
  parsePrisma,
  parseDrizzle,
  fail,
  type Snapshot,
  type Changes,
  MAX_TABLES,
  MAX_COLUMNS,
} from './parse-drizzle';

/**
 * SQL statements: split on semicolons outside quotes; function bodies ($$ … $$) are dropped first.
 */
function statements(src: string) {
  const text = src.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''");
  const out: string[] = [];
  let cur = '',
    quote = '';
  for (const ch of text) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    if (ch === ';') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
/**
 * SQL migrations, applied in file order: create table, alter table add/drop column, drop table,
 * create type … as enum.
 */
export function parseSql(files: { file: string; text: string }[], base: Table[] = []) {
  const tables = new Map<string, Table>();
  const enums = new Map<string, Enum>();
  const ident = (s: string) => {
    const parts = s.split('.').map(unq);
    return parts.length > 1
      ? { schema: parts[0], name: parts[1] }
      : { schema: 'public', name: parts[0] };
  };
  const key = (s: string) => {
    const i = ident(s);
    return `${i.schema}.${i.name}`.toLowerCase();
  };
  // Migrations on top of an existing schema (the PR check): start from copies of its tables.
  // Default schemas match unqualified names, as the database would.
  for (const t of base)
    tables.set(
      `${t.schema && !['dbo', 'main', ''].includes(t.schema) ? t.schema : 'public'}.${t.name}`.toLowerCase(),
      structuredClone(t),
    );
  const column = (def: string): Column | null => {
    const m = def.match(/^("[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)\s+([\s\S]+)$/);
    if (!m || /^(constraint|primary|foreign|unique|check|exclude|key|index)$/i.test(m[1]))
      return null;
    const rest = m[2];
    const type =
      rest.match(
        /^((?:"[^"]+"|[\w.]+)(?:\s*\([^)]*\))?(?:\s+(?:varying|precision|with(?:out)?\s+time\s+zone|zone))*(?:\s*\[\])?)/i,
      )?.[1] || rest.split(/\s/)[0];
    const dflt = rest.match(/\bdefault\s+((?:'[^']*'|\([^)]*\)|[^\s,])+(?:\(\))?)/i)?.[1];
    return {
      name: unq(m[1]),
      type: type.trim().toLowerCase(),
      nullable: !/\bnot\s+null\b|\bprimary\s+key\b/i.test(rest),
      ...(dflt ? { default: dflt } : {}),
      ...(/\bprimary\s+key\b/i.test(rest) ? { pk: true } : {}),
    };
  };
  const inlineRef = (t: Table, def: string) => {
    const col = column(def);
    const r = def.match(/\breferences\s+([\w."`]+)\s*(?:\(([^)]*)\))?/i);
    if (col && r)
      t.foreignKeys.push({
        columns: [col.name],
        refTable: tableKey(ident(r[1])),
        refColumns: r[2] ? names(r[2]) : ['id'],
      });
    if (col && /\bunique\b/i.test(def)) t.unique.push([col.name]);
  };
  for (const { text } of files) {
    const src = stripComments(text);
    for (const st of statements(src)) {
      const s = st.trim();
      let m;
      if (
        (m = s.match(
          /^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."`[\]]+)\s*\(/i,
        ))
      ) {
        const id = ident(m[1]);
        const t = table(id.name, id.schema);
        for (const def of topLevel(bracketed(s, s.indexOf('(', m[0].length - 1)))) {
          const pk = def.match(/^(?:constraint\s+\S+\s+)?primary\s+key\s*\(([^)]*)\)/i);
          const fk = def.match(
            /^(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]*)\)\s*references\s+([\w."`]+)\s*(?:\(([^)]*)\))?/i,
          );
          const uq = def.match(/^(?:constraint\s+\S+\s+)?unique\s*\(([^)]*)\)/i);
          if (pk) t.primaryKey = names(pk[1]);
          else if (fk)
            t.foreignKeys.push({
              columns: names(fk[1]),
              refTable: tableKey(ident(fk[2])),
              refColumns: fk[3] ? names(fk[3]) : ['id'],
            });
          else if (uq) t.unique.push(names(uq[1]));
          else {
            const c = column(def);
            if (c) {
              t.columns.push(c);
              inlineRef(t, def);
            }
          }
        }
        tables.set(key(m[1]), finish(t));
      } else if (
        (m = s.match(/^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."`[\]]+)\s+([\s\S]+)$/i))
      ) {
        const t = tables.get(key(m[1]));
        if (!t) continue;
        for (const action of topLevel(m[2])) {
          let a;
          if (
            (a = action.match(/^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([\s\S]+)$/i)) &&
            !/^add\s+(constraint|primary|foreign|unique|check)/i.test(action)
          ) {
            const c = column(a[1]);
            if (c && !t.columns.some((x) => x.name === c.name)) {
              t.columns.push(c);
              inlineRef(t, a[1]);
            }
          } else if (
            (a = action.match(/^drop\s+(?:column\s+)?(?:if\s+exists\s+)?([\w"`]+)/i)) &&
            !/^drop\s+constraint/i.test(action)
          ) {
            t.columns = t.columns.filter((c) => c.name !== unq(a[1]));
          } else if (
            (a = action.match(
              /^add\s+(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]*)\)\s*references\s+([\w."`]+)\s*(?:\(([^)]*)\))?/i,
            ))
          ) {
            t.foreignKeys.push({
              columns: names(a[1]),
              refTable: tableKey(ident(a[2])),
              refColumns: a[3] ? names(a[3]) : ['id'],
            });
          } else if (
            (a = action.match(/^add\s+(?:constraint\s+\S+\s+)?primary\s+key\s*\(([^)]*)\)/i))
          ) {
            t.primaryKey = names(a[1]);
            finish(t);
          } else if ((a = action.match(/^rename\s+column\s+([\w"`]+)\s+to\s+([\w"`]+)/i))) {
            const c = t.columns.find((x) => x.name === unq(a[1]));
            if (c) c.name = unq(a[2]);
          }
        }
      } else if ((m = s.match(/^drop\s+table\s+(?:if\s+exists\s+)?([\w."`[\]]+)/i))) {
        tables.delete(key(m[1]));
      } else if ((m = s.match(/^create\s+type\s+([\w."`]+)\s+as\s+enum\s*\(([\s\S]*)\)$/i))) {
        const id = ident(m[1]);
        enums.set(key(m[1]), { schema: id.schema, name: id.name, values: names(m[2]) });
      } else if (
        (m = s.match(
          /^create\s+(unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([\w"`]+)?\s*on\s+(?:only\s+)?([\w."`]+)\s*(?:using\s+\w+\s*)?\(([^)]*)\)/i,
        ))
      ) {
        tables
          .get(key(m[3]))
          ?.indexes.push({ name: unq(m[2] || ''), columns: names(m[4]), unique: Boolean(m[1]) });
      }
    }
  }
  return { tables: [...tables.values()], enums: [...enums.values()] };
}
export const SCHEMA_SKIP =
  /(^|\/)(node_modules|\.next|dist|build|out|coverage|vendor|samples?|examples?|legacy|fixtures?|templates?|__tests__|tests?|e2e)\//i;
// Clones and worktrees TicketForge itself keeps inside a repository it works on.
const TOOL_SKIP = /(^|\/)(data\/repos|\.claude|\.git)\//;
const isSql = (f: string) =>
  /\.sql$/i.test(f) &&
  /(migration|migrate|schema|db|sql|supabase|prisma)/i.test(f) &&
  !/(seed|fixture|sample|test)/i.test(f);
const isDrizzle = (f: string, text: string) =>
  /\.(t|j)sx?$|\.mjs$/.test(f) && /\b(pgTable|mysqlTable|sqliteTable)\(/.test(text);
/**
 * Finds the repository's schema files and reads them: Prisma first, then Drizzle, then SQL
 * migrations.
 */
export async function readFromRepo(readers: Reader[]) {
  for (const reader of readers) {
    const files = (await reader.list()).filter((f) => !SCHEMA_SKIP.test(f) && !TOOL_SKIP.test(f));
    const read = async (f: string) => {
      try {
        return await reader.read(f);
      } catch {
        return '';
      }
    };
    const prisma = files.filter((f) => /\.prisma$/.test(f));
    if (prisma.length) {
      const texts = await Promise.all(prisma.map(read));
      const r = parsePrisma(texts.join('\n'));
      if (r.tables.length)
        return {
          ...r,
          source: {
            type: 'repo' as const,
            format: 'Prisma',
            label: reader.label,
            files: prisma.slice(0, 20),
          },
        };
    }
    const code = files
      .filter((f) => /\.(t|j)sx?$|\.mjs$/.test(f) && /(schema|db|model|table|drizzle)/i.test(f))
      .slice(0, 400);
    const drizzle: { file: string; text: string }[] = [];
    for (const f of code) {
      const text = await read(f);
      if (isDrizzle(f, text)) drizzle.push({ file: f, text });
    }
    if (drizzle.length) {
      // One pass over all files, so a reference to a table defined in another file still resolves.
      const r = parseDrizzle(drizzle.map((d) => d.text).join('\n;\n'));
      if (r.tables.length)
        return {
          ...r,
          source: {
            type: 'repo' as const,
            format: 'Drizzle',
            label: reader.label,
            files: drizzle.map((d) => d.file).slice(0, 20),
          },
        };
    }
    const sql = files
      .filter(isSql)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
      .slice(0, 500);
    if (sql.length) {
      const r = parseSql(
        await Promise.all(sql.map(async (file) => ({ file, text: await read(file) }))),
      );
      if (r.tables.length)
        return {
          ...r,
          source: {
            type: 'repo' as const,
            format: 'SQL migrations',
            label: reader.label,
            files: sql.slice(-20),
          },
        };
    }
  }
  throw fail(
    400,
    'No schema files found in the repository: TicketForge looks for Prisma schemas, Drizzle tables and SQL migrations. Connect a database instead, or check the repository in Code & GitHub.',
  );
}
// ---------------------------------------------------------------- snapshot, fingerprint and
// changes

const colSig = (c: Column) => `${c.type}${c.nullable ? '' : ' not null'}`;
export function fingerprint(tables: Table[], enums: Enum[]) {
  const sig = [...tables]
    .sort((a, b) => tableKey(a).localeCompare(tableKey(b)))
    .map(
      (t) =>
        `${tableKey(t)}(${[...t.columns]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => `${c.name} ${colSig(c)}`)
          .join(',')})`,
    )
    .concat([...enums].map((e) => `enum ${e.schema}.${e.name}(${e.values.join(',')})`).sort())
    .join('\n');
  return crypto.createHash('sha256').update(sig).digest('hex').slice(0, 16);
}
/**
 * What changed between two snapshots, or null when there's nothing to compare or nothing changed.
 */
export function diff(prev: Snapshot | null | undefined, next: { tables: Table[] }): Changes | null {
  if (!prev?.tables) return null;
  const before = new Map(prev.tables.map((t) => [tableKey(t), t]));
  const after = new Map(next.tables.map((t) => [tableKey(t), t]));
  const changes: Changes = {
    since: prev.readAt,
    addedTables: [],
    removedTables: [],
    changedTables: [],
  };
  for (const k of after.keys()) if (!before.has(k)) changes.addedTables.push(k);
  for (const k of before.keys()) if (!after.has(k)) changes.removedTables.push(k);
  for (const [k, t] of after) {
    const old = before.get(k);
    if (!old) continue;
    const oc = new Map(old.columns.map((c) => [c.name, c]));
    const nc = new Map(t.columns.map((c) => [c.name, c]));
    const ch = {
      table: k,
      addedColumns: [...nc.keys()].filter((c) => !oc.has(c)),
      removedColumns: [...oc.keys()].filter((c) => !nc.has(c)),
      changedColumns: [...nc.values()]
        .filter((c) => oc.has(c.name) && colSig(oc.get(c.name)!) !== colSig(c))
        .map((c) => ({ name: c.name, from: colSig(oc.get(c.name)!), to: colSig(c) })),
    };
    if (ch.addedColumns.length || ch.removedColumns.length || ch.changedColumns.length)
      changes.changedTables.push(ch);
  }
  return changes.addedTables.length || changes.removedTables.length || changes.changedTables.length
    ? changes
    : null;
}
/**
 * Caps the size (it's kept on the project and sent to the browser) and records what changed since
 * `prev`.
 */
export function makeSnapshot(
  read: { source: Snapshot['source']; tables: Table[]; enums: Enum[] },
  prev: Snapshot | null | undefined,
  actor: any,
): Snapshot {
  const sorted = [...read.tables].sort((a, b) => tableKey(a).localeCompare(tableKey(b)));
  const truncated =
    sorted.length > MAX_TABLES || sorted.some((t) => t.columns.length > MAX_COLUMNS);
  const tables = sorted
    .slice(0, MAX_TABLES)
    .map((t) => ({ ...t, columns: t.columns.slice(0, MAX_COLUMNS) }));
  const enums = read.enums.slice(0, 100).map((e) => ({ ...e, values: e.values.slice(0, 50) }));
  const fp = fingerprint(tables, enums);
  // Reading the same schema again keeps the earlier change list, so it doesn't vanish on a refresh.
  const changes = prev?.fingerprint === fp ? (prev.changes ?? null) : diff(prev, { tables });
  return {
    source: read.source,
    readAt: new Date().toISOString(),
    readBy: actor?.name || null,
    fingerprint: fp,
    truncated,
    tables,
    enums,
    changes,
  };
}
