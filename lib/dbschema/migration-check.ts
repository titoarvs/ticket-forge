import { type Snapshot, tableKey, type Column, type Table } from './parse-drizzle';
import { SCHEMA_SKIP, parseSql, diff } from './parse-sql';

// ---------------------------------------------------------------- migrations in a pull request

const MIGRATION =
  /(^|\/)(migrations?|migrate|db|database|schema|supabase|prisma|drizzle|sql)(\/|\.)|\.sql$|\.prisma$/i;
/** The added lines of one file in a unified diff (the new text of a new file). */
function addedLines(diff: string, file: string) {
  const out: string[] = [];
  let inFile = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inFile = line.endsWith(` b/${file}`);
      continue;
    }
    if (inFile && line.startsWith('+') && !line.startsWith('+++')) out.push(line.slice(1));
  }
  return out.join('\n');
}
/**
 * What a change does to the database, checked against the project's saved schema: the migrations
 * and schema files in the diff, the tables and columns they add, remove or change, and the risky
 * parts. '' when the diff has none.
 * For the review agents (their prompt gets it as facts to check against).
 */
export function migrationCheck(project: any, diffText: string, files: string[]) {
  const schema: Snapshot | undefined = project?.dbSchema;
  const touched = files
    .map((f) => f.replace(/\s+\(\+\d+\/.\d+\)$/, ''))
    .filter((f) => MIGRATION.test(f) && !SCHEMA_SKIP.test(f) && !/(seed|fixture)/i.test(f));
  if (!touched.length) return '';
  const sql = touched.filter((f) => /\.sql$/i.test(f));
  const lines = [
    `DATABASE CHECK (from TicketForge): this change touches ${touched.length} database file${touched.length === 1 ? '' : 's'}: ${touched.slice(0, 20).join(', ')}.`,
  ];
  if (!schema?.tables?.length) {
    lines.push(
      'No schema is saved for this project (Project settings → Database), so the migrations can’t be compared with the current database.',
    );
  } else if (sql.length) {
    const after = parseSql(
      sql.map((f) => ({ file: f, text: addedLines(diffText, f) })),
      schema.tables,
    );
    const ch = diff(schema, after);
    if (!ch)
      lines.push(
        `Compared with the schema read on ${schema.readAt.slice(0, 10)}, the SQL in this change doesn’t add, remove or change any table or column.`,
      );
    else {
      const risky: string[] = [];
      for (const t of ch.removedTables) risky.push(`drops table ${t} (its data is lost)`);
      for (const t of ch.changedTables) {
        for (const c of t.removedColumns)
          risky.push(`drops column ${t.table}.${c} (its data is lost)`);
        for (const c of t.changedColumns)
          risky.push(
            `changes ${t.table}.${c.name} from ${c.from} to ${c.to} (check existing rows convert)`,
          );
        const table = after.tables.find((x) => tableKey(x) === t.table);
        for (const c of t.addedColumns) {
          const col = table?.columns.find((x) => x.name === c);
          if (col && !col.nullable && !col.default && !col.pk)
            risky.push(
              `adds required column ${t.table}.${c} without a default (fails on a table that has rows)`,
            );
        }
      }
      lines.push(
        `Compared with the schema read on ${schema.readAt.slice(0, 10)}:`,
        ...ch.addedTables.map((t) => `- new table ${t}`),
        ...ch.changedTables.flatMap(
          (t) =>
            [
              t.addedColumns.length && `- ${t.table}: adds ${t.addedColumns.join(', ')}`,
              t.removedColumns.length && `- ${t.table}: removes ${t.removedColumns.join(', ')}`,
              t.changedColumns.length &&
                `- ${t.table}: changes ${t.changedColumns.map((c) => `${c.name} (${c.from} → ${c.to})`).join(', ')}`,
            ].filter(Boolean) as string[],
        ),
        ...ch.removedTables.map((t) => `- removes table ${t}`),
      );
      if (risky.length)
        lines.push(
          'Risky, check each has a plan for existing data (backfill, default, or a two-step migration):',
          ...risky.map((r) => `- ${r}`),
        );
    }
  } else {
    lines.push(
      'The schema files changed but no SQL migration is in the change: check a migration is generated and committed (for example with prisma migrate or drizzle-kit), or explain why none is needed.',
    );
  }
  lines.push(
    'As a reviewer, also check: the code uses the new tables and columns by their exact names; every table or column the code now needs has a migration; ' +
      'new foreign keys have an index; and the migration can run on a database that already has data.',
  );
  return lines.join('\n');
}
// ---------------------------------------------------------------- for AI prompts

const SCHEMA_MAX = 9000;
function columnText(c: Column, t: Table) {
  const fk = t.foreignKeys.find((f) => f.columns.length === 1 && f.columns[0] === c.name);
  const uq = t.unique.some((u) => u.length === 1 && u[0] === c.name);
  return [
    c.name,
    c.type,
    c.pk ? 'PK' : '',
    !c.pk && !c.nullable ? 'NOT NULL' : '',
    uq ? 'UNIQUE' : '',
    fk ? `→ ${fk.refTable}.${fk.refColumns[0]}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
/** One table as one line: "- orders: id uuid PK; customer_id uuid NOT NULL → customers.id; …". */
function tableLine(t: Table) {
  const multi = t.foreignKeys
    .filter((f) => f.columns.length > 1)
    .map((f) => `(${f.columns.join(', ')}) → ${f.refTable}(${f.refColumns.join(', ')})`);
  return `- ${tableKey(t)}: ${t.columns.map((c) => columnText(c, t)).join('; ')}${t.primaryKey.length > 1 ? `; PK (${t.primaryKey.join(', ')})` : ''}${multi.length ? `; ${multi.join('; ')}` : ''}`;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * The tables a piece of text mentions (by name, singular or plural, with _ or spaces), as schema
 * lines.
 */
export function tablesMentioned(project: any, text: string, max = 12) {
  const tables: Table[] = project?.dbSchema?.tables || [];
  const hay = String(text || '').toLowerCase();
  if (!tables.length || !hay) return [];
  const forms = (n: string) => {
    const b = n.toLowerCase();
    const one = b.replace(/ies$/, 'y').replace(/s$/, '');
    return [...new Set([b, one, `${one}s`, b.replace(/_/g, ' '), one.replace(/_/g, ' ')])].filter(
      (f) => f.length > 2,
    );
  };
  return tables
    .filter((t) => forms(t.name).some((f) => new RegExp(`\\b${esc(f)}\\b`).test(hay)))
    .slice(0, max)
    .map(tableLine);
}
/**
 * The compact text added to AI system prompts ('' without a schema). Light jobs get table names
 * only.
 */
export function schemaBlock(project: any, { short = false } = {}) {
  const s: Snapshot | undefined = project?.dbSchema;
  if (!s?.tables?.length) return '';
  const from =
    s.source.type === 'database'
      ? `the ${s.source.name} database`
      : `the repository's ${s.source.format} files`;
  const head =
    `\n\nDATABASE SCHEMA of the app (read from ${from} on ${s.readAt.slice(0, 10)}; ${s.tables.length} table${s.tables.length === 1 ? '' : 's'}${s.truncated ? ', shortened' : ''}). ` +
    'Use these exact table and column names. When work needs a table or column that isn’t here, say a migration is needed:\n';
  if (short) return `${head}${s.tables.map(tableKey).join(', ').slice(0, 1500)}`;
  const lines: string[] = [];
  let size = 0;
  for (const t of s.tables) {
    const line = tableLine(t);
    if (size + line.length > SCHEMA_MAX) {
      lines.push(
        `- … and ${s.tables.length - lines.length} more tables: ${s.tables.slice(lines.length).map(tableKey).join(', ').slice(0, 800)}`,
      );
      break;
    }
    lines.push(line);
    size += line.length;
  }
  if (s.enums.length)
    lines.push(
      `Enums: ${s.enums
        .map((e) => `${e.name} (${e.values.join(' | ')})`)
        .join('; ')
        .slice(0, 1200)}`,
    );
  return head + lines.join('\n');
}
