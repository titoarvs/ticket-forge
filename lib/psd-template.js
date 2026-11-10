// The team's Problem Statement template (.docx), stored once for the whole server by an administrator.
import JSZip from 'jszip';
import { qs } from './db.js';
import { inspectTemplate } from './psd-docx.js';
import { trimEmbeddedFonts } from './docx-fonts.js';

const KEY = 'psd';
export const MAX_TEMPLATE = 20 * 1024 * 1024;

// A project can have its own template (key "psd:<projectId>", set in Project settings → Templates); without one it
// uses the team's (key "psd", Administration → Generation).
const keyFor = (projectId) => (projectId ? `${KEY}:${projectId}` : KEY);

/** Checks and stores a template; returns what was found in it. */
export async function savePsdTemplate(actor, buf, name, projectId = null) {
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
  [keyFor(projectId), String(name || 'Problem Statement template.docx').slice(0, 200), data.length, data, JSON.stringify(info), actor?.name || null]);
  return publicPsdTemplate(projectId);
}
// A database without the doc_templates table yet (created by the next migration) means "no template": the plain
// Problem Statement is used instead of failing the download.
const noTable = (e) => { if (e?.code === '42P01' || /doc_templates/.test(e?.message || '')) return { rows: [] }; throw e; };
const COLS = 'key, name, bytes, data, info, updated_by, updated_at';
/** The template a project's PSDs use: its own, else the team's, else null (plain layout). */
export async function getPsdTemplate(projectId = null) {
  const keys = projectId ? [keyFor(projectId), KEY] : [KEY];
  const rows = (await qs(`select ${COLS} from doc_templates where key = any($1)`, [keys]).catch(noTable)).rows;
  return keys.map((k) => rows.find((r) => r.key === k)).find(Boolean) || null;
}
/** What people see: the name, size and what was found in it, and whose it is ("project" or "team"). Never the file itself. */
export async function publicPsdTemplate(projectId = null) {
  const r = await getPsdTemplate(projectId);
  return r ? { name: r.name, bytes: r.bytes, info: r.info, updatedBy: r.updated_by, updatedAt: r.updated_at, scope: r.key === KEY ? 'team' : 'project' } : null;
}
export async function clearPsdTemplate(projectId = null) { await qs('delete from doc_templates where key = $1', [keyFor(projectId)]); }
