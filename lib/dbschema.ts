// The schema of the app a project builds: tables, columns, keys, relations, indexes and enums, never any rows.
// It comes from one of the project's database connections (readSchema in lib/appdb.ts) or, without one, from the repository's
// schema files (Prisma, Drizzle or SQL migrations). Pure functions: no database access here. The snapshot is saved on the project as `dbSchema`, and every AI
// prompt gets a compact version (schemaBlock, added by contextBlock in lib/appcontext.ts), so the AI uses real names.
import crypto from 'node:crypto';

export type Column = { name: string; type: string; nullable: boolean; default?: string; pk?: boolean };
export type ForeignKey = { columns: string[]; refTable: string; refColumns: string[] };
export type Table = { schema: string; name: string; columns: Column[]; primaryKey: string[]; foreignKeys: ForeignKey[]; unique: string[][]; indexes: { name: string; columns: string[]; unique: boolean }[] };
export type Enum = { schema: string; name: string; values: string[] };
export type Changes = { since: string; addedTables: string[]; removedTables: string[]; changedTables: { table: string; addedColumns: string[]; removedColumns: string[]; changedColumns: { name: string; from: string; to: string }[] }[] };
export type Snapshot = {
  source: { type: 'database'; envId: string; name: string; kind: string } | { type: 'repo'; format: string; label: string; files: string[] };
  readAt: string; readBy: string | null; fingerprint: string; truncated: boolean;
  tables: Table[]; enums: Enum[]; changes: Changes | null;
};

const MAX_TABLES = 300;
const MAX_COLUMNS = 120;
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
// The default schema of each engine (public, dbo, main) isn't written; MySQL and SQLite have none ('').
export const tableKey = (t: { schema: string; name: string }) => (t.schema && !['public', 'dbo', 'main'].includes(t.schema) ? `${t.schema}.${t.name}` : t.name);

// ---------------------------------------------------------------- from the repository

type Reader = { label: string; list: () => Promise<string[]>; read: (rel: string) => Promise<string> };
const table = (name: string, schema = 'public'): Table => ({ schema, name, columns: [], primaryKey: [], foreignKeys: [], unique: [], indexes: [] });
const finish = (t: Table) => {
  for (const c of t.columns) if (c.pk && !t.primaryKey.includes(c.name)) t.primaryKey.push(c.name);
  for (const c of t.columns) if (t.primaryKey.includes(c.name)) { c.pk = true; c.nullable = false; }
  return t;
};

/** The text between the bracket at `open` and its partner (strings skipped). */
function bracketed(text: string, open: number) {
  const pair: Record<string, string> = { '{': '}', '(': ')', '[': ']' };
  const stack = [pair[text[open]]];
  let quote = '';
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (pair[ch]) stack.push(pair[ch]);
    else if (ch === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return text.slice(open + 1, i); }
  }
  return text.slice(open + 1);
}
/** Splits on commas that aren't inside brackets or strings. */
function topLevel(body: string) {
  const out: string[] = [];
  let depth = 0, quote = '', cur = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) { cur += ch; if (ch === '\\') { cur += body[++i] ?? ''; } else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    if ('({['.includes(ch)) depth++;
    if (')}]'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/--.*$/gm, '');
const unq = (s: string) => String(s || '').trim().replace(/^["'`[]|["'`\]]$/g, '');
const names = (s: string) => s.split(',').map(unq).filter(Boolean);

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
    for (const line of body.split('\n')) { const f = line.trim().match(/^(\w+)\s+\w+[\s\S]*?@map\(\s*"([^"]+)"\s*\)/); if (f) colOf.set(f[1], f[2]); }
    const cols = (list: string) => names(list).map((n) => colOf.get(n) || n);
    for (const line of body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('@@'))) {
      const f = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
      if (!f) continue;
      const [, name, type, list, opt, rest] = f;
      const rel = rest.match(/@relation\([^)]*fields:\s*\[([^\]]*)\][^)]*references:\s*\[([^\]]*)\]/);
      if (rel) t.foreignKeys.push({ columns: cols(rel[1]), refTable: mapped.get(type) || type, refColumns: names(rel[2]) });
      if (modelNames.has(type)) continue; // a relation field, not a column
      const col = rest.match(/@map\(\s*"([^"]+)"\s*\)/)?.[1] || name;
      const dflt = rest.match(/@default\(((?:[^()]|\([^()]*\))*)\)/)?.[1];
      t.columns.push({ name: col, type: `${type}${list ? '[]' : ''}`, nullable: Boolean(opt), ...(dflt ? { default: dflt } : {}), ...(/@id\b/.test(rest) ? { pk: true } : {}) });
      if (/@unique\b/.test(rest)) t.unique.push([col]);
    }
    const id = body.match(/@@id\(\s*(?:fields:\s*)?\[([^\]]*)\]/);
    if (id) t.primaryKey = cols(id[1]);
    for (const u of body.matchAll(/@@unique\(\s*(?:fields:\s*)?\[([^\]]*)\]/g)) t.unique.push(cols(u[1]));
    for (const ix of body.matchAll(/@@index\(\s*(?:fields:\s*)?\[([^\]]*)\]/g)) t.indexes.push({ name: '', columns: cols(ix[1]), unique: false });
    tables.push(finish(t));
  }
  const enums: Enum[] = [];
  for (const m of src.matchAll(/^\s*enum\s+(\w+)\s*\{/gm)) {
    enums.push({ schema: 'public', name: m[1], values: bracketed(src, (m.index ?? 0) + m[0].length - 1).replace(/@\w+\([^)]*\)/g, '').split(/\s+/).filter((v) => /^\w+$/.test(v)) });
  }
  return { tables, enums };
}

/** Drizzle: `pgTable('name', { col: type('col').notNull()… })` (also mysqlTable and sqliteTable). */
export function parseDrizzle(text: string) {
  const src = stripComments(text);
  const tables: Table[] = [];
  const byVar = new Map<string, string>(); // table variable → table name
  const keysOf = new Map<string, Map<string, string>>(); // table name → (property key → column name)
  const pending: { t: Table; columns: string[]; refVar: string; refKeys: string[] }[] = [];
  const enums: Enum[] = [];
  const enumVar = new Map<string, string>(); // enum variable → enum name
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*pgEnum\(\s*["'`]([^"'`]+)["'`]\s*,\s*\[/g)) {
    enums.push({ schema: 'public', name: m[2], values: names(bracketed(src, (m.index ?? 0) + m[0].length - 1)) });
    enumVar.set(m[1], m[2]);
  }
  const ref = (v: string) => { const r = v.trim().match(/^(\w+)\.(\w+)$/); return r ? { v: r[1], k: r[2] } : null; };
  for (const m of src.matchAll(/(?:(?:const|let)\s+(\w+)\s*=\s*)?(?:\w+\.)?(?:pgTable|mysqlTable|sqliteTable)\(\s*["'`]([^"'`]+)["'`]\s*,\s*\{/g)) {
    const t = table(m[2]);
    const keys = new Map<string, string>();
    keysOf.set(m[2], keys);
    if (m[1]) byVar.set(m[1], m[2]);
    const bodyAt = (m.index ?? 0) + m[0].length - 1;
    const body = bracketed(src, bodyAt);
    for (const prop of topLevel(body)) {
      const p = prop.match(/^["'`]?(\w+)["'`]?\s*:\s*(\w+)\s*\(\s*(?:["'`]([^"'`]+)["'`])?([\s\S]*)$/);
      if (!p) continue;
      const [, key, fn, colName, rest] = p;
      const name = colName || key;
      keys.set(key, name);
      const dflt = rest.match(/\.default\(([^)]*)\)/)?.[1] || (/\.defaultNow\(\)/.test(rest) ? 'now()' : /\.defaultRandom\(\)/.test(rest) ? 'random' : '');
      t.columns.push({ name, type: enumVar.get(fn) || fn, nullable: !/\.notNull\(\)|\.primaryKey\(\)/.test(rest), ...(dflt ? { default: dflt.trim() } : {}), ...(/\.primaryKey\(\)/.test(rest) ? { pk: true } : {}) });
      if (/\.unique\(\)/.test(rest)) t.unique.push([name]);
      const r = rest.match(/\.references\(\s*\(\)\s*(?::\s*\w+\s*)?=>\s*(\w+)\.(\w+)/);
      if (r) pending.push({ t, columns: [name], refVar: r[1], refKeys: [r[2]] });
    }
    // Table-level extras after the columns: primaryKey, unique, index, uniqueIndex and foreignKey (object or array form).
    const call = bracketed(src, src.lastIndexOf('(', bodyAt));
    const extras = call.slice(call.indexOf(body) + body.length + 1);
    const col = (v: string) => { const k = v.trim().replace(/^\w+\./, ''); return keys.get(k) || k; };
    const list = (v: string) => v.split(',').map(col).filter(Boolean);
    const pk = extras.match(/primaryKey\(\s*\{\s*columns:\s*\[([^\]]*)\]/) || extras.match(/primaryKey\(([^)]*)\)/);
    if (pk) t.primaryKey = list(pk[1]);
    for (const ix of extras.matchAll(/(uniqueIndex|index|unique)\(\s*["'`]?([^"'`)]*)["'`]?\s*\)\s*\.on\(([^)]*)\)/g)) {
      if (ix[1] === 'unique') t.unique.push(list(ix[3])); else t.indexes.push({ name: ix[2], columns: list(ix[3]), unique: ix[1] === 'uniqueIndex' });
    }
    for (const fk of extras.matchAll(/foreignKey\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      const cols = fk[1].match(/columns:\s*\[([^\]]*)\]/)?.[1];
      const refs = (fk[1].match(/foreignColumns:\s*\[([^\]]*)\]/)?.[1] || '').split(',').map(ref).filter(Boolean) as { v: string; k: string }[];
      if (cols && refs.length) pending.push({ t, columns: list(cols), refVar: refs[0].v, refKeys: refs.map((x) => x.k) });
    }
    tables.push(finish(t));
  }
  for (const fk of pending) {
    const refTable = byVar.get(fk.refVar) || fk.refVar;
    const keys = keysOf.get(refTable);
    fk.t.foreignKeys.push({ columns: fk.columns, refTable, refColumns: fk.refKeys.map((k) => keys?.get(k) || k) });
  }
  return { tables, enums };
}

/** SQL statements: split on semicolons outside quotes; function bodies ($$ … $$) are dropped first. */
function statements(src: string) {
  const text = src.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''");
  const out: string[] = [];
  let cur = '', quote = '';
  for (const ch of text) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"') quote = ch;
    if (ch === ';') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
/** SQL migrations, applied in file order: create table, alter table add/drop column, drop table, create type … as enum. */
export function parseSql(files: { file: string; text: string }[], base: Table[] = []) {
  const tables = new Map<string, Table>();
  const enums = new Map<string, Enum>();
  const ident = (s: string) => { const parts = s.split('.').map(unq); return parts.length > 1 ? { schema: parts[0], name: parts[1] } : { schema: 'public', name: parts[0] }; };
  const key = (s: string) => { const i = ident(s); return `${i.schema}.${i.name}`.toLowerCase(); };
  // Migrations on top of an existing schema (the PR check): start from copies of its tables. Default schemas match
  // unqualified names, as the database would.
  for (const t of base) tables.set(`${t.schema && !['dbo', 'main', ''].includes(t.schema) ? t.schema : 'public'}.${t.name}`.toLowerCase(), structuredClone(t));
  const column = (def: string): Column | null => {
    const m = def.match(/^("[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)\s+([\s\S]+)$/);
    if (!m || /^(constraint|primary|foreign|unique|check|exclude|key|index)$/i.test(m[1])) return null;
    const rest = m[2];
    const type = rest.match(/^((?:"[^"]+"|[\w.]+)(?:\s*\([^)]*\))?(?:\s+(?:varying|precision|with(?:out)?\s+time\s+zone|zone))*(?:\s*\[\])?)/i)?.[1] || rest.split(/\s/)[0];
    const dflt = rest.match(/\bdefault\s+((?:'[^']*'|\([^)]*\)|[^\s,])+(?:\(\))?)/i)?.[1];
    return { name: unq(m[1]), type: type.trim().toLowerCase(), nullable: !/\bnot\s+null\b|\bprimary\s+key\b/i.test(rest), ...(dflt ? { default: dflt } : {}), ...(/\bprimary\s+key\b/i.test(rest) ? { pk: true } : {}) };
  };
  const inlineRef = (t: Table, def: string) => {
    const col = column(def);
    const r = def.match(/\breferences\s+([\w."`]+)\s*(?:\(([^)]*)\))?/i);
    if (col && r) t.foreignKeys.push({ columns: [col.name], refTable: tableKey(ident(r[1])), refColumns: r[2] ? names(r[2]) : ['id'] });
    if (col && /\bunique\b/i.test(def)) t.unique.push([col.name]);
  };
  for (const { text } of files) {
    const src = stripComments(text);
    for (const st of statements(src)) {
      const s = st.trim();
      let m;
      if ((m = s.match(/^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."`[\]]+)\s*\(/i))) {
        const id = ident(m[1]);
        const t = table(id.name, id.schema);
        for (const def of topLevel(bracketed(s, s.indexOf('(', m[0].length - 1)))) {
          const pk = def.match(/^(?:constraint\s+\S+\s+)?primary\s+key\s*\(([^)]*)\)/i);
          const fk = def.match(/^(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]*)\)\s*references\s+([\w."`]+)\s*(?:\(([^)]*)\))?/i);
          const uq = def.match(/^(?:constraint\s+\S+\s+)?unique\s*\(([^)]*)\)/i);
          if (pk) t.primaryKey = names(pk[1]);
          else if (fk) t.foreignKeys.push({ columns: names(fk[1]), refTable: tableKey(ident(fk[2])), refColumns: fk[3] ? names(fk[3]) : ['id'] });
          else if (uq) t.unique.push(names(uq[1]));
          else { const c = column(def); if (c) { t.columns.push(c); inlineRef(t, def); } }
        }
        tables.set(key(m[1]), finish(t));
      } else if ((m = s.match(/^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."`[\]]+)\s+([\s\S]+)$/i))) {
        const t = tables.get(key(m[1]));
        if (!t) continue;
        for (const action of topLevel(m[2])) {
          let a;
          if ((a = action.match(/^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([\s\S]+)$/i)) && !/^add\s+(constraint|primary|foreign|unique|check)/i.test(action)) {
            const c = column(a[1]);
            if (c && !t.columns.some((x) => x.name === c.name)) { t.columns.push(c); inlineRef(t, a[1]); }
          } else if ((a = action.match(/^drop\s+(?:column\s+)?(?:if\s+exists\s+)?([\w"`]+)/i)) && !/^drop\s+constraint/i.test(action)) {
            t.columns = t.columns.filter((c) => c.name !== unq(a[1]));
          } else if ((a = action.match(/^add\s+(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]*)\)\s*references\s+([\w."`]+)\s*(?:\(([^)]*)\))?/i))) {
            t.foreignKeys.push({ columns: names(a[1]), refTable: tableKey(ident(a[2])), refColumns: a[3] ? names(a[3]) : ['id'] });
          } else if ((a = action.match(/^add\s+(?:constraint\s+\S+\s+)?primary\s+key\s*\(([^)]*)\)/i))) {
            t.primaryKey = names(a[1]); finish(t);
          } else if ((a = action.match(/^rename\s+column\s+([\w"`]+)\s+to\s+([\w"`]+)/i))) {
            const c = t.columns.find((x) => x.name === unq(a[1])); if (c) c.name = unq(a[2]);
          }
        }
      } else if ((m = s.match(/^drop\s+table\s+(?:if\s+exists\s+)?([\w."`[\]]+)/i))) {
        tables.delete(key(m[1]));
      } else if ((m = s.match(/^create\s+type\s+([\w."`]+)\s+as\s+enum\s*\(([\s\S]*)\)$/i))) {
        const id = ident(m[1]);
        enums.set(key(m[1]), { schema: id.schema, name: id.name, values: names(m[2]) });
      } else if ((m = s.match(/^create\s+(unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([\w"`]+)?\s*on\s+(?:only\s+)?([\w."`]+)\s*(?:using\s+\w+\s*)?\(([^)]*)\)/i))) {
        tables.get(key(m[3]))?.indexes.push({ name: unq(m[2] || ''), columns: names(m[4]), unique: Boolean(m[1]) });
      }
    }
  }
  return { tables: [...tables.values()], enums: [...enums.values()] };
}

const SCHEMA_SKIP = /(^|\/)(node_modules|\.next|dist|build|out|coverage|vendor|samples?|examples?|legacy|fixtures?|templates?|__tests__|tests?|e2e)\//i;
// Clones and worktrees TicketForge itself keeps inside a repository it works on.
const TOOL_SKIP = /(^|\/)(data\/repos|\.claude|\.git)\//;
const isSql = (f: string) => /\.sql$/i.test(f) && /(migration|migrate|schema|db|sql|supabase|prisma)/i.test(f) && !/(seed|fixture|sample|test)/i.test(f);
const isDrizzle = (f: string, text: string) => /\.(t|j)sx?$|\.mjs$/.test(f) && /\b(pgTable|mysqlTable|sqliteTable)\(/.test(text);

/** Finds the repository's schema files and reads them: Prisma first, then Drizzle, then SQL migrations. */
export async function readFromRepo(readers: Reader[]) {
  for (const reader of readers) {
    const files = (await reader.list()).filter((f) => !SCHEMA_SKIP.test(f) && !TOOL_SKIP.test(f));
    const read = async (f: string) => { try { return await reader.read(f); } catch { return ''; } };
    const prisma = files.filter((f) => /\.prisma$/.test(f));
    if (prisma.length) {
      const texts = await Promise.all(prisma.map(read));
      const r = parsePrisma(texts.join('\n'));
      if (r.tables.length) return { ...r, source: { type: 'repo' as const, format: 'Prisma', label: reader.label, files: prisma.slice(0, 20) } };
    }
    const code = files.filter((f) => /\.(t|j)sx?$|\.mjs$/.test(f) && /(schema|db|model|table|drizzle)/i.test(f)).slice(0, 400);
    const drizzle: { file: string; text: string }[] = [];
    for (const f of code) { const text = await read(f); if (isDrizzle(f, text)) drizzle.push({ file: f, text }); }
    if (drizzle.length) {
      // One pass over all files, so a reference to a table defined in another file still resolves.
      const r = parseDrizzle(drizzle.map((d) => d.text).join('\n;\n'));
      if (r.tables.length) return { ...r, source: { type: 'repo' as const, format: 'Drizzle', label: reader.label, files: drizzle.map((d) => d.file).slice(0, 20) } };
    }
    const sql = files.filter(isSql).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).slice(0, 500);
    if (sql.length) {
      const r = parseSql(await Promise.all(sql.map(async (file) => ({ file, text: await read(file) }))));
      if (r.tables.length) return { ...r, source: { type: 'repo' as const, format: 'SQL migrations', label: reader.label, files: sql.slice(-20) } };
    }
  }
  throw fail(400, 'No schema files found in the repository: TicketForge looks for Prisma schemas, Drizzle tables and SQL migrations. Connect a database instead, or check the repository in Code & GitHub.');
}

// ---------------------------------------------------------------- snapshot, fingerprint and changes

const colSig = (c: Column) => `${c.type}${c.nullable ? '' : ' not null'}`;
export function fingerprint(tables: Table[], enums: Enum[]) {
  const sig = [...tables].sort((a, b) => tableKey(a).localeCompare(tableKey(b)))
    .map((t) => `${tableKey(t)}(${[...t.columns].sort((a, b) => a.name.localeCompare(b.name)).map((c) => `${c.name} ${colSig(c)}`).join(',')})`)
    .concat([...enums].map((e) => `enum ${e.schema}.${e.name}(${e.values.join(',')})`).sort()).join('\n');
  return crypto.createHash('sha256').update(sig).digest('hex').slice(0, 16);
}

/** What changed between two snapshots, or null when there's nothing to compare or nothing changed. */
export function diff(prev: Snapshot | null | undefined, next: { tables: Table[] }): Changes | null {
  if (!prev?.tables) return null;
  const before = new Map(prev.tables.map((t) => [tableKey(t), t]));
  const after = new Map(next.tables.map((t) => [tableKey(t), t]));
  const changes: Changes = { since: prev.readAt, addedTables: [], removedTables: [], changedTables: [] };
  for (const k of after.keys()) if (!before.has(k)) changes.addedTables.push(k);
  for (const k of before.keys()) if (!after.has(k)) changes.removedTables.push(k);
  for (const [k, t] of after) {
    const old = before.get(k);
    if (!old) continue;
    const oc = new Map(old.columns.map((c) => [c.name, c]));
    const nc = new Map(t.columns.map((c) => [c.name, c]));
    const ch = { table: k, addedColumns: [...nc.keys()].filter((c) => !oc.has(c)), removedColumns: [...oc.keys()].filter((c) => !nc.has(c)),
      changedColumns: [...nc.values()].filter((c) => oc.has(c.name) && colSig(oc.get(c.name)!) !== colSig(c)).map((c) => ({ name: c.name, from: colSig(oc.get(c.name)!), to: colSig(c) })) };
    if (ch.addedColumns.length || ch.removedColumns.length || ch.changedColumns.length) changes.changedTables.push(ch);
  }
  return changes.addedTables.length || changes.removedTables.length || changes.changedTables.length ? changes : null;
}

/** Caps the size (it's kept on the project and sent to the browser) and records what changed since `prev`. */
export function makeSnapshot(read: { source: Snapshot['source']; tables: Table[]; enums: Enum[] }, prev: Snapshot | null | undefined, actor: any): Snapshot {
  const sorted = [...read.tables].sort((a, b) => tableKey(a).localeCompare(tableKey(b)));
  const truncated = sorted.length > MAX_TABLES || sorted.some((t) => t.columns.length > MAX_COLUMNS);
  const tables = sorted.slice(0, MAX_TABLES).map((t) => ({ ...t, columns: t.columns.slice(0, MAX_COLUMNS) }));
  const enums = read.enums.slice(0, 100).map((e) => ({ ...e, values: e.values.slice(0, 50) }));
  const fp = fingerprint(tables, enums);
  // Reading the same schema again keeps the earlier change list, so it doesn't vanish on a refresh.
  const changes = prev?.fingerprint === fp ? prev.changes ?? null : diff(prev, { tables });
  return { source: read.source, readAt: new Date().toISOString(), readBy: actor?.name || null, fingerprint: fp, truncated, tables, enums, changes };
}

// ---------------------------------------------------------------- migrations in a pull request

const MIGRATION = /(^|\/)(migrations?|migrate|db|database|schema|supabase|prisma|drizzle|sql)(\/|\.)|\.sql$|\.prisma$/i;
/** The added lines of one file in a unified diff (the new text of a new file). */
function addedLines(diff: string, file: string) {
  const out: string[] = [];
  let inFile = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) { inFile = line.endsWith(` b/${file}`); continue; }
    if (inFile && line.startsWith('+') && !line.startsWith('+++')) out.push(line.slice(1));
  }
  return out.join('\n');
}

/**
 * What a change does to the database, checked against the project's saved schema: the migrations and schema files in
 * the diff, the tables and columns they add, remove or change, and the risky parts. '' when the diff has none.
 * For the review agents (their prompt gets it as facts to check against).
 */
export function migrationCheck(project: any, diffText: string, files: string[]) {
  const schema: Snapshot | undefined = project?.dbSchema;
  const touched = files.map((f) => f.replace(/\s+\(\+\d+\/.\d+\)$/, '')).filter((f) => MIGRATION.test(f) && !SCHEMA_SKIP.test(f) && !/(seed|fixture)/i.test(f));
  if (!touched.length) return '';
  const sql = touched.filter((f) => /\.sql$/i.test(f));
  const lines = [`DATABASE CHECK (from TicketForge): this change touches ${touched.length} database file${touched.length === 1 ? '' : 's'}: ${touched.slice(0, 20).join(', ')}.`];
  if (!schema?.tables?.length) {
    lines.push('No schema is saved for this project (Project settings → Database), so the migrations can’t be compared with the current database.');
  } else if (sql.length) {
    const after = parseSql(sql.map((f) => ({ file: f, text: addedLines(diffText, f) })), schema.tables);
    const ch = diff(schema, after);
    if (!ch) lines.push(`Compared with the schema read on ${schema.readAt.slice(0, 10)}, the SQL in this change doesn’t add, remove or change any table or column.`);
    else {
      const risky: string[] = [];
      for (const t of ch.removedTables) risky.push(`drops table ${t} (its data is lost)`);
      for (const t of ch.changedTables) {
        for (const c of t.removedColumns) risky.push(`drops column ${t.table}.${c} (its data is lost)`);
        for (const c of t.changedColumns) risky.push(`changes ${t.table}.${c.name} from ${c.from} to ${c.to} (check existing rows convert)`);
        const table = after.tables.find((x) => tableKey(x) === t.table);
        for (const c of t.addedColumns) {
          const col = table?.columns.find((x) => x.name === c);
          if (col && !col.nullable && !col.default && !col.pk) risky.push(`adds required column ${t.table}.${c} without a default (fails on a table that has rows)`);
        }
      }
      lines.push(`Compared with the schema read on ${schema.readAt.slice(0, 10)}:`,
        ...ch.addedTables.map((t) => `- new table ${t}`),
        ...ch.changedTables.flatMap((t) => [t.addedColumns.length && `- ${t.table}: adds ${t.addedColumns.join(', ')}`, t.removedColumns.length && `- ${t.table}: removes ${t.removedColumns.join(', ')}`,
          t.changedColumns.length && `- ${t.table}: changes ${t.changedColumns.map((c) => `${c.name} (${c.from} → ${c.to})`).join(', ')}`].filter(Boolean) as string[]),
        ...ch.removedTables.map((t) => `- removes table ${t}`));
      if (risky.length) lines.push('Risky, check each has a plan for existing data (backfill, default, or a two-step migration):', ...risky.map((r) => `- ${r}`));
    }
  } else {
    lines.push('The schema files changed but no SQL migration is in the change: check a migration is generated and committed (for example with prisma migrate or drizzle-kit), or explain why none is needed.');
  }
  lines.push('As a reviewer, also check: the code uses the new tables and columns by their exact names; every table or column the code now needs has a migration; '
    + 'new foreign keys have an index; and the migration can run on a database that already has data.');
  return lines.join('\n');
}

// ---------------------------------------------------------------- for AI prompts

const SCHEMA_MAX = 9000;
function columnText(c: Column, t: Table) {
  const fk = t.foreignKeys.find((f) => f.columns.length === 1 && f.columns[0] === c.name);
  const uq = t.unique.some((u) => u.length === 1 && u[0] === c.name);
  return [c.name, c.type, c.pk ? 'PK' : '', !c.pk && !c.nullable ? 'NOT NULL' : '', uq ? 'UNIQUE' : '', fk ? `→ ${fk.refTable}.${fk.refColumns[0]}` : ''].filter(Boolean).join(' ');
}
/** One table as one line: "- orders: id uuid PK; customer_id uuid NOT NULL → customers.id; …". */
function tableLine(t: Table) {
  const multi = t.foreignKeys.filter((f) => f.columns.length > 1).map((f) => `(${f.columns.join(', ')}) → ${f.refTable}(${f.refColumns.join(', ')})`);
  return `- ${tableKey(t)}: ${t.columns.map((c) => columnText(c, t)).join('; ')}${t.primaryKey.length > 1 ? `; PK (${t.primaryKey.join(', ')})` : ''}${multi.length ? `; ${multi.join('; ')}` : ''}`;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The tables a piece of text mentions (by name, singular or plural, with _ or spaces), as schema lines. */
export function tablesMentioned(project: any, text: string, max = 12) {
  const tables: Table[] = project?.dbSchema?.tables || [];
  const hay = String(text || '').toLowerCase();
  if (!tables.length || !hay) return [];
  const forms = (n: string) => { const b = n.toLowerCase(); const one = b.replace(/ies$/, 'y').replace(/s$/, ''); return [...new Set([b, one, `${one}s`, b.replace(/_/g, ' '), one.replace(/_/g, ' ')])].filter((f) => f.length > 2); };
  return tables.filter((t) => forms(t.name).some((f) => new RegExp(`\\b${esc(f)}\\b`).test(hay))).slice(0, max).map(tableLine);
}
/** The compact text added to AI system prompts ('' without a schema). Light jobs get table names only. */
export function schemaBlock(project: any, { short = false } = {}) {
  const s: Snapshot | undefined = project?.dbSchema;
  if (!s?.tables?.length) return '';
  const from = s.source.type === 'database' ? `the ${s.source.name} database` : `the repository's ${s.source.format} files`;
  const head = `\n\nDATABASE SCHEMA of the app (read from ${from} on ${s.readAt.slice(0, 10)}; ${s.tables.length} table${s.tables.length === 1 ? '' : 's'}${s.truncated ? ', shortened' : ''}). `
    + 'Use these exact table and column names. When work needs a table or column that isn’t here, say a migration is needed:\n';
  if (short) return `${head}${s.tables.map(tableKey).join(', ').slice(0, 1500)}`;
  const lines: string[] = [];
  let size = 0;
  for (const t of s.tables) {
    const line = tableLine(t);
    if (size + line.length > SCHEMA_MAX) { lines.push(`- … and ${s.tables.length - lines.length} more tables: ${s.tables.slice(lines.length).map(tableKey).join(', ').slice(0, 800)}`); break; }
    lines.push(line); size += line.length;
  }
  if (s.enums.length) lines.push(`Enums: ${s.enums.map((e) => `${e.name} (${e.values.join(' | ')})`).join('; ').slice(0, 1200)}`);
  return head + lines.join('\n');
}
