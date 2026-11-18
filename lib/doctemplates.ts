// Reads and writes the doc_templates table (the Problem Statement .docx and the Feature Brief / Architecture Record
// Markdown templates) with Drizzle. Row-level security limits the table to the server, so these run in system context.
import { orm, docTemplates, eq, inArray, sql } from './orm';
import { asSystem } from './db';

/** A database without the doc_templates table yet (created by the next migration) means "no template", not an error. */
const noTable = (e: any) => {
  if (e?.code === '42P01' || e?.cause?.code === '42P01' || /doc_templates/.test(e?.message || '')) return [];
  throw e;
};

/** The saved rows for these keys: { key, name, bytes, data, info, updatedBy, updatedAt }. */
export async function templateRows(keys: string[]): Promise<any[]> {
  return asSystem(async () => await orm.select().from(docTemplates).where(inArray(docTemplates.key, keys))).catch(noTable);
}

/** Saves a template under `key`, replacing what was there. */
export async function saveTemplateRow({ key, name, bytes, data, info, updatedBy }: { key: string; name: string; bytes: number; data: Buffer; info: any; updatedBy: string | null }) {
  await asSystem(async () => {
    await orm.insert(docTemplates).values({ key, name, bytes, data, info, updatedBy, updatedAt: sql`now()` })
      .onConflictDoUpdate({ target: docTemplates.key, set: { name, bytes, data, info, updatedBy, updatedAt: sql`now()` } });
  });
}

/** Removes the templates saved under these keys (none yet is fine). */
export async function deleteTemplateRows(keys: string[]) {
  await asSystem(async () => { await orm.delete(docTemplates).where(keys.length === 1 ? eq(docTemplates.key, keys[0]) : inArray(docTemplates.key, keys)); }).catch(noTable);
}
