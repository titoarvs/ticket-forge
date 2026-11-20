export type Column = {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
  pk?: boolean;
};
export type ForeignKey = { columns: string[]; refTable: string; refColumns: string[] };
export type Table = {
  schema: string;
  name: string;
  columns: Column[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
  unique: string[][];
  indexes: { name: string; columns: string[]; unique: boolean }[];
};
export type Enum = { schema: string; name: string; values: string[] };
export type Changes = {
  since: string;
  addedTables: string[];
  removedTables: string[];
  changedTables: {
    table: string;
    addedColumns: string[];
    removedColumns: string[];
    changedColumns: { name: string; from: string; to: string }[];
  }[];
};
export type Snapshot = {
  source:
    | { type: 'database'; envId: string; name: string; kind: string }
    | { type: 'repo'; format: string; label: string; files: string[] };
  readAt: string;
  readBy: string | null;
  fingerprint: string;
  truncated: boolean;
  tables: Table[];
  enums: Enum[];
  changes: Changes | null;
};
export const MAX_TABLES = 300;
export const MAX_COLUMNS = 120;
export const fail = (status: number, message: string) =>
  Object.assign(new Error(message), { status });
// The default schema of each engine (public, dbo, main) isn't written; MySQL and SQLite have none
// ('').
export const tableKey = (t: { schema: string; name: string }) =>
  t.schema && !['public', 'dbo', 'main'].includes(t.schema) ? `${t.schema}.${t.name}` : t.name;
// ---------------------------------------------------------------- from the repository

export type Reader = {
  label: string;
  list: () => Promise<string[]>;
  read: (rel: string) => Promise<string>;
};
export const table = (name: string, schema = 'public'): Table => ({
  schema,
  name,
  columns: [],
  primaryKey: [],
  foreignKeys: [],
  unique: [],
  indexes: [],
});
export const finish = (t: Table) => {
  for (const c of t.columns) if (c.pk && !t.primaryKey.includes(c.name)) t.primaryKey.push(c.name);
  for (const c of t.columns)
    if (t.primaryKey.includes(c.name)) {
      c.pk = true;
      c.nullable = false;
    }
  return t;
};
/** The text between the bracket at `open` and its partner (strings skipped). */
export function bracketed(text: string, open: number) {
  const pair: Record<string, string> = { '{': '}', '(': ')', '[': ']' };
  const stack = [pair[text[open]]];
  let quote = '';
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (pair[ch]) stack.push(pair[ch]);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}
/** Splits on commas that aren't inside brackets or strings. */
export function topLevel(body: string) {
  const out: string[] = [];
  let depth = 0,
    quote = '',
    cur = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      cur += ch;
      if (ch === '\\') {
        cur += body[++i] ?? '';
      } else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    if ('({['.includes(ch)) depth++;
    if (')}]'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
export const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/--.*$/gm, '');
export const unq = (s: string) =>
  String(s || '')
    .trim()
    .replace(/^["'`[]|["'`\]]$/g, '');
export const names = (s: string) => s.split(',').map(unq).filter(Boolean);
/** Prisma: `model X { … }` and `enum Y { … }` in *.prisma files. */
export function parsePrisma(text: string) {
  const src = text.replace(/\/\/.*$/gm, '');
  const modelNames = new Set([...src.matchAll(/^\s*model\s+(\w+)\s*\{/gm)].map((m) => m[1]));
  const tables: Table[] = [];
  const mapped = new Map<string, string>();
  for (const m of src.matchAll(/^\s*model\s+(\w+)\s*\{/gm)) {
    const body = bracketed(src, (m.index ?? 0) + m[0].length - 1);
    mapped.set(m[1], body.match(/@@map\(\s*"([^"]+)"\s*\)/)?.[1] || m[1]);
  }
  for (const m of src.matchAll(/^\s*model\s+(\w+)\s*\{/gm)) {
    const body = bracketed(src, (m.index ?? 0) + m[0].length - 1);
    const t = table(mapped.get(m[1])!);
    const colOf = new Map<string, string>(); // Prisma field name → database column name (@map)
    for (const line of body.split('\n')) {
      const f = line.trim().match(/^(\w+)\s+\w+[\s\S]*?@map\(\s*"([^"]+)"\s*\)/);
      if (f) colOf.set(f[1], f[2]);
    }
    const cols = (list: string) => names(list).map((n) => colOf.get(n) || n);
    for (const line of body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('@@'))) {
      const f = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
      if (!f) continue;
      const [, name, type, list, opt, rest] = f;
      const rel = rest.match(
        /@relation\([^)]*fields:\s*\[([^\]]*)\][^)]*references:\s*\[([^\]]*)\]/,
      );
      if (rel)
        t.foreignKeys.push({
          columns: cols(rel[1]),
          refTable: mapped.get(type) || type,
          refColumns: names(rel[2]),
        });
      if (modelNames.has(type)) continue; // a relation field, not a column
      const col = rest.match(/@map\(\s*"([^"]+)"\s*\)/)?.[1] || name;
      const dflt = rest.match(/@default\(((?:[^()]|\([^()]*\))*)\)/)?.[1];
      t.columns.push({
        name: col,
        type: `${type}${list ? '[]' : ''}`,
        nullable: Boolean(opt),
        ...(dflt ? { default: dflt } : {}),
        ...(/@id\b/.test(rest) ? { pk: true } : {}),
      });
      if (/@unique\b/.test(rest)) t.unique.push([col]);
    }
    const id = body.match(/@@id\(\s*(?:fields:\s*)?\[([^\]]*)\]/);
    if (id) t.primaryKey = cols(id[1]);
    for (const u of body.matchAll(/@@unique\(\s*(?:fields:\s*)?\[([^\]]*)\]/g))
      t.unique.push(cols(u[1]));
    for (const ix of body.matchAll(/@@index\(\s*(?:fields:\s*)?\[([^\]]*)\]/g))
      t.indexes.push({ name: '', columns: cols(ix[1]), unique: false });
    tables.push(finish(t));
  }
  const enums: Enum[] = [];
  for (const m of src.matchAll(/^\s*enum\s+(\w+)\s*\{/gm)) {
    enums.push({
      schema: 'public',
      name: m[1],
      values: bracketed(src, (m.index ?? 0) + m[0].length - 1)
        .replace(/@\w+\([^)]*\)/g, '')
        .split(/\s+/)
        .filter((v) => /^\w+$/.test(v)),
    });
  }
  return { tables, enums };
}
/**
 * Drizzle: `pgTable('name', { col: type('col').notNull()… })` (also mysqlTable and sqliteTable).
 */
export function parseDrizzle(text: string) {
  const src = stripComments(text);
  const tables: Table[] = [];
  const byVar = new Map<string, string>(); // table variable → table name
  const keysOf = new Map<string, Map<string, string>>(); // table name → (property key → column name)
  const pending: { t: Table; columns: string[]; refVar: string; refKeys: string[] }[] = [];
  const enums: Enum[] = [];
  const enumVar = new Map<string, string>(); // enum variable → enum name
  for (const m of src.matchAll(
    /(?:const|let)\s+(\w+)\s*=\s*pgEnum\(\s*["'`]([^"'`]+)["'`]\s*,\s*\[/g,
  )) {
    enums.push({
      schema: 'public',
      name: m[2],
      values: names(bracketed(src, (m.index ?? 0) + m[0].length - 1)),
    });
    enumVar.set(m[1], m[2]);
  }
  const ref = (v: string) => {
    const r = v.trim().match(/^(\w+)\.(\w+)$/);
    return r ? { v: r[1], k: r[2] } : null;
  };
  for (const m of src.matchAll(
    /(?:(?:const|let)\s+(\w+)\s*=\s*)?(?:\w+\.)?(?:pgTable|mysqlTable|sqliteTable)\(\s*["'`]([^"'`]+)["'`]\s*,\s*\{/g,
  )) {
    const t = table(m[2]);
    const keys = new Map<string, string>();
    keysOf.set(m[2], keys);
    if (m[1]) byVar.set(m[1], m[2]);
    const bodyAt = (m.index ?? 0) + m[0].length - 1;
    const body = bracketed(src, bodyAt);
    for (const prop of topLevel(body)) {
      const p = prop.match(
        /^["'`]?(\w+)["'`]?\s*:\s*(\w+)\s*\(\s*(?:["'`]([^"'`]+)["'`])?([\s\S]*)$/,
      );
      if (!p) continue;
      const [, key, fn, colName, rest] = p;
      const name = colName || key;
      keys.set(key, name);
      const dflt =
        rest.match(/\.default\(([^)]*)\)/)?.[1] ||
        (/\.defaultNow\(\)/.test(rest)
          ? 'now()'
          : /\.defaultRandom\(\)/.test(rest)
            ? 'random'
            : '');
      t.columns.push({
        name,
        type: enumVar.get(fn) || fn,
        nullable: !/\.notNull\(\)|\.primaryKey\(\)/.test(rest),
        ...(dflt ? { default: dflt.trim() } : {}),
        ...(/\.primaryKey\(\)/.test(rest) ? { pk: true } : {}),
      });
      if (/\.unique\(\)/.test(rest)) t.unique.push([name]);
      const r = rest.match(/\.references\(\s*\(\)\s*(?::\s*\w+\s*)?=>\s*(\w+)\.(\w+)/);
      if (r) pending.push({ t, columns: [name], refVar: r[1], refKeys: [r[2]] });
    }
    // Table-level extras after the columns: primaryKey, unique, index, uniqueIndex and foreignKey
    // (object or array form).
    const call = bracketed(src, src.lastIndexOf('(', bodyAt));
    const extras = call.slice(call.indexOf(body) + body.length + 1);
    const col = (v: string) => {
      const k = v.trim().replace(/^\w+\./, '');
      return keys.get(k) || k;
    };
    const list = (v: string) => v.split(',').map(col).filter(Boolean);
    const pk =
      extras.match(/primaryKey\(\s*\{\s*columns:\s*\[([^\]]*)\]/) ||
      extras.match(/primaryKey\(([^)]*)\)/);
    if (pk) t.primaryKey = list(pk[1]);
    for (const ix of extras.matchAll(
      /(uniqueIndex|index|unique)\(\s*["'`]?([^"'`)]*)["'`]?\s*\)\s*\.on\(([^)]*)\)/g,
    )) {
      if (ix[1] === 'unique') t.unique.push(list(ix[3]));
      else t.indexes.push({ name: ix[2], columns: list(ix[3]), unique: ix[1] === 'uniqueIndex' });
    }
    for (const fk of extras.matchAll(/foreignKey\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      const cols = fk[1].match(/columns:\s*\[([^\]]*)\]/)?.[1];
      const refs = (fk[1].match(/foreignColumns:\s*\[([^\]]*)\]/)?.[1] || '')
        .split(',')
        .map(ref)
        .filter(Boolean) as {
        v: string;
        k: string;
      }[];
      if (cols && refs.length)
        pending.push({ t, columns: list(cols), refVar: refs[0].v, refKeys: refs.map((x) => x.k) });
    }
    tables.push(finish(t));
  }
  for (const fk of pending) {
    const refTable = byVar.get(fk.refVar) || fk.refVar;
    const keys = keysOf.get(refTable);
    fk.t.foreignKeys.push({
      columns: fk.columns,
      refTable,
      refColumns: fk.refKeys.map((k) => keys?.get(k) || k),
    });
  }
  return { tables, enums };
}
