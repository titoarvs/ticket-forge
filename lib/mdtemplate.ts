// Markdown document templates (Feature Brief "fbd", Architecture Record Design "ard"). Each has the team's built-in
// default; an administrator can replace it for everyone (key "<kind>"), and a project can have its own
// (key "<kind>:<projectId>", Project settings → Templates). A project's documents use the most specific one.
import { qs } from './db';
import { wsKey } from './wsmeta';

export const MAX_MD_TEMPLATE = 200_000;
/** The `## ` sections of a template, in order. */
export const sectionsOf = (md) => [...String(md).matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1].trim());
// The workspace's own template (wsKey), or a project's (project ids are unique everywhere).
const keyFor = (kind, projectId) => (projectId ? `${kind}:${projectId}` : wsKey(kind));
const noTable = (e) => { if (e?.code === '42P01' || /doc_templates/.test(e?.message || '')) return { rows: [] }; throw e; };

/** { name, text, scope: 'project' | 'team' | 'default', custom, updatedBy, updatedAt } */
export async function getMdTemplate(kind, def, projectId = null) {
  const keys = projectId ? [keyFor(kind, projectId), wsKey(kind)] : [wsKey(kind)];
  const rows = (await qs('select key, name, data, updated_by, updated_at from doc_templates where key = any($1)', [keys]).catch(noTable)).rows;
  const r = keys.map((k) => rows.find((x) => x.key === k)).find(Boolean);
  return r ? { name: r.name, text: Buffer.from(r.data).toString('utf8'), scope: r.key === wsKey(kind) ? 'team' : 'project', custom: true, updatedBy: r.updated_by, updatedAt: r.updated_at }
    : { ...def, scope: 'default', custom: false };
}
export async function publicMdTemplate(kind, def, projectId = null) {
  const t = await getMdTemplate(kind, def, projectId);
  // `custom` means "set at this level": for a project, only its own template counts.
  return { name: t.name, scope: t.scope, custom: projectId ? t.scope === 'project' : t.scope === 'team', sections: sectionsOf(t.text), chars: t.text.length,
    updatedBy: t.updatedBy || null, updatedAt: t.updatedAt || null, text: t.text };
}
export async function saveMdTemplate(kind, def, { actor, text, name, label, projectId = null }: any) {
  const t = String(text || '').replace(/\r\n/g, '\n');
  if (!t.trim()) throw Object.assign(new Error('The template is empty.'), { status: 400 });
  if (t.length > MAX_MD_TEMPLATE) throw Object.assign(new Error('The template is too long (over 200,000 characters).'), { status: 413 });
  if (sectionsOf(t).length < 2) throw Object.assign(new Error(`The template needs “## ” section headings, like the ${label} template.`), { status: 400 });
  await qs(`insert into doc_templates (key, name, bytes, data, info, updated_by, updated_at) values ($1,$2,$3,$4,$5,$6,now())
    on conflict (key) do update set name = excluded.name, bytes = excluded.bytes, data = excluded.data, info = excluded.info, updated_by = excluded.updated_by, updated_at = now()`,
  [keyFor(kind, projectId), String(name || def.name).slice(0, 200), Buffer.byteLength(t), Buffer.from(t, 'utf8'), JSON.stringify({ sections: sectionsOf(t) }), actor?.name || null]);
  return publicMdTemplate(kind, def, projectId);
}
export async function resetMdTemplate(kind, def, projectId = null) {
  await qs('delete from doc_templates where key = $1', [keyFor(kind, projectId)]);
  return publicMdTemplate(kind, def, projectId);
}
/** Removes a deleted project's own templates. */
export async function deleteProjectTemplates(projectId) {
  await qs("delete from doc_templates where key in ($1, $2, $3)", [`psd:${projectId}`, `fbd:${projectId}`, `ard:${projectId}`]).catch(noTable);
}
