// Feature Brief documents (FBD), one per epic: the AI fills the team's Markdown template, keeping every heading
// and table and replacing the [bracketed prompts] with what the epic, its issues, the source documents and the
// epic's Problem Statement say. The template is stored once for the server; the team's file is the default.
import { askClaude } from './claude.js';
import { agentInstructions } from './agents.js';
import { getRules, getGuide, guideBlock } from './genrules.js';
import { qs } from './db.js';
import { DEFAULT_FBD_TEMPLATE } from './fbd-default.js';

const KEY = 'fbd';
export const MAX_FBD_TEMPLATE = 200_000;

// ---------------------------------------------------------------- template
export async function getFbdTemplate() {
  const r = (await qs('select name, data, updated_by, updated_at from doc_templates where key = $1', [KEY]).catch(() => ({ rows: [] }))).rows[0];
  return r ? { name: r.name, text: Buffer.from(r.data).toString('utf8'), custom: true, updatedBy: r.updated_by, updatedAt: r.updated_at }
    : { name: 'feature-brief-template.md', text: DEFAULT_FBD_TEMPLATE, custom: false };
}
/** The `## ` sections of a template, in order. */
export const sectionsOf = (md) => [...String(md).matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1].trim());
export async function saveFbdTemplate(actor, text, name) {
  const t = String(text || '').replace(/\r\n/g, '\n');
  if (!t.trim()) throw Object.assign(new Error('The template is empty.'), { status: 400 });
  if (t.length > MAX_FBD_TEMPLATE) throw Object.assign(new Error('The template is too long (over 200,000 characters).'), { status: 413 });
  if (sectionsOf(t).length < 2) throw Object.assign(new Error('The template needs “## ” section headings, like the Feature Brief template.'), { status: 400 });
  await qs(`insert into doc_templates (key, name, bytes, data, info, updated_by, updated_at) values ($1,$2,$3,$4,$5,$6,now())
    on conflict (key) do update set name = excluded.name, bytes = excluded.bytes, data = excluded.data, info = excluded.info, updated_by = excluded.updated_by, updated_at = now()`,
  [KEY, String(name || 'feature-brief-template.md').slice(0, 200), Buffer.byteLength(t), Buffer.from(t, 'utf8'), JSON.stringify({ sections: sectionsOf(t) }), actor?.name || null]);
  return publicFbdTemplate();
}
export async function publicFbdTemplate() {
  const t = await getFbdTemplate();
  return { name: t.name, custom: t.custom, sections: sectionsOf(t.text), chars: t.text.length, updatedBy: t.updatedBy || null, updatedAt: t.updatedAt || null, text: t.text };
}
export async function resetFbdTemplate() { await qs('delete from doc_templates where key = $1', [KEY]); return publicFbdTemplate(); }

// ---------------------------------------------------------------- generation
const SYSTEM_FBD = `You are a senior product analyst writing a Feature Brief for one feature (an epic), by filling in the team's
Markdown template. A Feature Brief turns an agreed problem into a buildable, testable feature: who does what, what is in
scope, the acceptance criteria, how success is measured, and how it is rolled out.

How to fill the template:
- Keep every heading, its numbering and its order exactly. Keep every table and its columns exactly.
- Replace each [bracketed prompt] with real content. Add table rows where the material supports more (FR-03, FR-04…);
  remove example rows that don't apply. Remove the <!-- comments -->.
- Requirements (FR-xx) come from the epic's issues; acceptance criteria rows reference those FR IDs and use the issues'
  acceptance criteria in Given / When / Then form, covering success, ineligible or invalid cases, and failure and recovery.
- Ground every statement in the material. Never invent people, dates, metrics, links or baselines. When something isn't
  known, write a short prompt for the team in this form: [To confirm: who owns the release date].
- Sign-Off: keep the roles; leave Name, Signature and Date empty. Document Control and Revision History: use the values given.
- Plain, specific language. Short sentences. No marketing words.
Output only the finished Markdown document, nothing before or after it.`;

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function fbdPrompt({ project, epic, tickets, docs, template, instructions, meta }) {
  const issues = tickets.slice(0, 60).map((t) => [
    `- ${t.key || ''} ${t.title} [${t.type || 'Story'}, ${t.priority || 'Medium'}${t.storyPoints != null ? `, ${t.storyPoints} pts` : ''}]`,
    t.userStory && `  Story: ${clip(t.userStory, 300)}`,
    t.description && `  ${clip(t.description, 400)}`,
    t.acceptanceCriteria?.length && `  Acceptance criteria:\n${t.acceptanceCriteria.slice(0, 8).map((a) => `    - ${clip(a, 220)}`).join('\n')}`,
  ].filter(Boolean).join('\n')).join('\n');
  const psd = epic.psd ? `Problem Statement for this epic (already written):
Title: ${epic.psd.title}: Problem Statement (${epic.psd.version || 'v1.0'}, ${epic.psd.status || 'Draft'})
The problem: ${clip(epic.psd.atAGlance?.problem, 400)}
Why it matters: ${clip(epic.psd.atAGlance?.whyItMatters, 400)}
Problem statement: ${clip(epic.psd.problemStatement, 1200)}
Evidence needed: ${(epic.psd.evidence || []).map((e) => `${e.evidence} (${e.status})`).join('; ')}` : 'There is no Problem Statement for this epic yet: for "Related problem statement" write [To confirm: link to the problem statement].';
  return `Fill in the Feature Brief template below for this epic of the project "${project.name}".

Project description: ${clip(project.description, 1500) || 'n/a'}
Summary of the initial document: ${clip(project.summary, 1500) || 'n/a'}
Assumptions: ${(project.assumptions || []).slice(0, 15).map((a) => clip(a, 200)).join(' | ') || 'none'}
Open questions: ${(project.openQuestions || []).slice(0, 15).map((a) => clip(a, 200)).join(' | ') || 'none'}

EPIC (the feature): ${epic.title}
${epic.description ? `Epic description: ${clip(epic.description, 1500)}\n` : ''}${epic.startDate || epic.dueDate ? `Planned dates: ${epic.startDate || '?'} to ${epic.dueDate || '?'}\n` : ''}
Issues in this epic:
${issues || '- (no issues yet)'}

${psd}

Source material (use what concerns this epic):
${docs.map((d) => `### ${d.name}\n${clip(d.text, 8000)}`).join('\n\n') || '(none)'}
${instructions ? `\nExtra instructions from the team: ${clip(instructions, 1500)}\n` : ''}
Values for the document: feature name "${epic.title}", version ${meta.version}, date ${meta.date}, status ${meta.status}, prepared by ${meta.preparedBy}.

THE TEMPLATE TO FILL (keep its structure):
${template}`;
}

/** The finished Markdown, without code fences or chatter around it. */
function cleanMarkdown(text) {
  let t = String(text || '').trim();
  const fence = t.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) t = fence[1];
  const start = t.search(/^#\s/m);
  if (start > 0) t = t.slice(start);
  return t.replace(/<!--[\s\S]*?-->\s*\n?/g, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
const missingSections = (md, template) => {
  const have = new Set(sectionsOf(md).map((s) => s.toLowerCase().replace(/^\d+\.\s*/, '')));
  return sectionsOf(template).filter((s) => !have.has(s.toLowerCase().replace(/^\d+\.\s*/, '')));
};

export async function generateFbd({ project, epicId, instructions, ai = {}, meta }) {
  const epic = project.epics.find((e) => e.id === epicId);
  if (!epic) throw Object.assign(new Error('That epic isn’t in this project.'), { status: 404 });
  const tickets = project.tickets.filter((t) => t.epicId === epic.id && !t.parentId);
  const docs = [];
  if (project.sourceText) docs.push({ name: project.sourceName || 'Initial document', text: project.sourceText });
  for (const d of project.sources || []) if ((d.epicIds || []).includes(epic.id) && d.text) docs.push({ name: d.name, text: d.text });
  const { text: template } = await getFbdTemplate();
  const rules = await getRules();
  const system = `${SYSTEM_FBD}${guideBlock(await getGuide(), ['tickets'])}${await agentInstructions('feature-brief')}`;
  const reasoning = rules.reasoning === 'fast' ? 'balanced' : rules.reasoning;
  let md = cleanMarkdown(await askClaude({ ...ai, reasoning, system, prompt: fbdPrompt({ project, epic, tickets, docs, template, instructions, meta }) }));
  const missing = missingSections(md, template);
  if (missing.length) { // one repair round: put the missing sections back
    md = cleanMarkdown(await askClaude({ ...ai, reasoning, system, prompt: `This Feature Brief is missing these template sections: ${missing.join('; ')}. Return the complete document again with every section of the template, in order, keeping all the content already written.\n\nTEMPLATE:\n${template}\n\nDOCUMENT:\n${md}` }));
  }
  return { markdown: md, sections: sectionsOf(md), missing: missingSections(md, template) };
}
