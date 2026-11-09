// The team's Problem Statement template (.docx), stored once for the whole server by an administrator.
import JSZip from 'jszip';
import { qs } from './db.js';
import { inspectTemplate } from './psd-docx.js';
import { trimEmbeddedFonts } from './docx-fonts.js';

const KEY = 'psd';
export const MAX_TEMPLATE = 20 * 1024 * 1024;

/** Checks and stores a template; returns what was found in it. */
export async function savePsdTemplate(actor, buf, name) {
  if (!buf?.length) throw Object.assign(new Error('The file is empty.'), { status: 400 });
  if (buf.length > MAX_TEMPLATE) throw Object.assign(new Error('The template is larger than 20 MB.'), { status: 413 });
  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch { throw Object.assign(new Error('That isn’t a Word document (.docx).'), { status: 400 }); }
  await trimEmbeddedFonts(zip); // bold font files the template doesn't use as such: smaller files everywhere
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const t = await inspectTemplate(data); // throws with a readable reason when it doesn't fit
  const info = { ...t.info, names: t.names };
  await qs(`insert into doc_templates (key, name, bytes, data, info, updated_by, updated_at) values ($1,$2,$3,$4,$5,$6,now())
    on conflict (key) do update set name = excluded.name, bytes = excluded.bytes, data = excluded.data, info = excluded.info, updated_by = excluded.updated_by, updated_at = now()`,
  [KEY, String(name || 'Problem Statement template.docx').slice(0, 200), data.length, data, JSON.stringify(info), actor?.name || null]);
  return publicPsdTemplate();
}
export async function getPsdTemplate() {
  return (await qs('select name, bytes, data, info, updated_by, updated_at from doc_templates where key = $1', [KEY])).rows[0] || null;
}
/** What people see: the name, size and what was found in it. Never the file itself. */
export async function publicPsdTemplate() {
  const r = (await qs('select name, bytes, info, updated_by, updated_at from doc_templates where key = $1', [KEY])).rows[0];
  return r ? { name: r.name, bytes: r.bytes, info: r.info, updatedBy: r.updated_by, updatedAt: r.updated_at } : null;
}
export async function clearPsdTemplate() { await qs('delete from doc_templates where key = $1', [KEY]); }
