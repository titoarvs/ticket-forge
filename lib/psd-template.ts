// The team's Problem Statement template (.docx), stored once for the whole server by an administrator.
import JSZip from 'jszip';
import { templateRows, saveTemplateRow, deleteTemplateRows } from './doctemplates';
import { inspectTemplate } from './psd-docx';
import { trimEmbeddedFonts } from './docx-fonts';
import { wsKey } from './wsmeta';

const KEY = 'psd';
export const MAX_TEMPLATE = 20 * 1024 * 1024;

// A project can have its own template (key "psd:<projectId>", set in Project settings → Templates); without one it
// uses the team's (key "psd", Administration → Generation).
// The workspace's own template (wsKey), or a project's (project ids are unique everywhere).
const keyFor = (projectId) => (projectId ? `${KEY}:${projectId}` : wsKey(KEY));

/** Checks and stores a template; returns what was found in it. */
export async function savePsdTemplate(actor, buf, name, projectId = null) {
  if (!buf?.length) throw Object.assign(new Error('The file is empty.'), { status: 400 });
  if (buf.length > MAX_TEMPLATE)
    throw Object.assign(new Error('The template is larger than 20 MB.'), { status: 413 });
  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw Object.assign(new Error('That isn’t a Word document (.docx).'), { status: 400 });
  }
  await trimEmbeddedFonts(zip); // bold font files the template doesn't use as such: smaller files everywhere
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const t = await inspectTemplate(data); // throws with a readable reason when it doesn't fit
  const info = { ...t.info, names: t.names };
  await saveTemplateRow({
    key: keyFor(projectId),
    name: String(name || 'Problem Statement template.docx').slice(0, 200),
    bytes: data.length,
    data,
    info,
    updatedBy: actor?.name || null,
  });
  return publicPsdTemplate(projectId);
}
/**
 * The template a project's PSDs use: its own, else the team's, else null (plain layout). A database without the
 * doc_templates table yet (created by the next migration) means "no template": the plain Problem Statement is used
 * instead of failing the download.
 */
export async function getPsdTemplate(projectId = null): Promise<any> {
  const keys = projectId ? [keyFor(projectId), wsKey(KEY)] : [wsKey(KEY)];
  const rows = await templateRows(keys);
  return keys.map((k) => rows.find((r) => r.key === k)).find(Boolean) || null;
}
/** What people see: the name, size and what was found in it, and whose it is ("project" or "team"). Never the file itself. */
export async function publicPsdTemplate(projectId = null) {
  const r = await getPsdTemplate(projectId);
  return r
    ? {
        name: r.name,
        bytes: r.bytes,
        info: r.info,
        updatedBy: r.updatedBy,
        updatedAt: r.updatedAt,
        scope: r.key === wsKey(KEY) ? 'team' : 'project',
      }
    : null;
}
export async function clearPsdTemplate(projectId = null) {
  await deleteTemplateRows([keyFor(projectId)]);
}
