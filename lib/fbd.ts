// Feature Brief documents (FBD), one per epic: the AI fills the team's Markdown template, keeping every heading
// and table and replacing the [bracketed prompts] with what the epic, its issues, the source documents and the
// epic's Problem Statement say. The template is stored once for the server; the team's file is the default.
import { askClaude } from './claude';
import { agentInstructions } from './agents';
import { getRules, getGuide, guideBlock } from './genrules';
import { DEFAULT_FBD_TEMPLATE } from './fbd-default';

import { sectionsOf, MAX_MD_TEMPLATE, getMdTemplate, publicMdTemplate, saveMdTemplate, resetMdTemplate } from './mdtemplate';
import { contextBlock } from './appcontext';

export { sectionsOf };
export const MAX_FBD_TEMPLATE = MAX_MD_TEMPLATE;
const DEF = { name: 'feature-brief-template.md', text: DEFAULT_FBD_TEMPLATE };
const LABEL = 'Feature Brief';

// ---------------------------------------------------------------- template (project → team → default)
export const getFbdTemplate = (projectId = null) => getMdTemplate('fbd', DEF, projectId);
export const publicFbdTemplate = (projectId = null) => publicMdTemplate('fbd', DEF, projectId);
export const saveFbdTemplate = (actor, text, name, projectId = null) => saveMdTemplate('fbd', DEF, { actor, text, name, label: LABEL, projectId });
export const resetFbdTemplate = (projectId = null) => resetMdTemplate('fbd', DEF, projectId);

// ---------------------------------------------------------------- generation
const SYSTEM_FBD = `You are a senior product analyst writing a Feature Brief for one feature (an epic), by filling in the team's
Markdown template. A Feature Brief turns an agreed problem (the Problem Statement) into a buildable, testable feature: the
objective, the solution in plain words, what is recorded and who sees it, user journeys, acceptance scenarios, personas,
KPIs, scope, dependencies and risks, milestones and open decisions.

How to fill the template:
- Keep every heading, its numbering and its order exactly. Keep every table and its columns exactly.
- Replace each [bracketed prompt] with real content. Add table rows where the material supports more; remove example
  rows that don't apply. Replace placeholder column headers like [role A] / [role B] with the real role names, and add
  role columns when more roles have different access. Remove the <!-- comments -->.
- 2.5 User journeys: one "#### Role — “question”" block per direct persona listed in Section 3.
- 2.6 Acceptance Scenarios: stable IDs AS-01, AS-02…, built from the epic's issues and their acceptance criteria. Cover
  the actions in 2.3, each role boundary, and failure or boundary cases. Pass Conditions are exact and observable.
- 4. KPIs: tie each to a pain point in the Problem Statement; state the baseline and its source, or [To confirm: baseline];
  mark each target "(proposed)" unless the material confirms it.
- 8. Open Decisions: IDs Q01, Q02…, from the open questions and anything you had to mark [To confirm: …] that needs a decision.
- References / Sources: name the Problem Statement (title and version) and the source documents you used.
- Ground every statement in the material. Never invent people, dates, metrics, links or baselines. When something isn't
  known, write a short prompt for the team in this form: [To confirm: who owns the release date].
- Sign-Off: keep the roles; leave Name, Signature and Date empty. Document Control and Revision History: use the values given.
- Plain, specific language. Short sentences. No marketing words.
Output only the finished Markdown document, nothing before or after it.`;

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function fbdPrompt({ project, epic, tickets, docs, template, instructions, meta }: any) {
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
Evidence needed: ${(epic.psd.evidence || []).map((e) => `${e.evidence} (${e.status})`).join('; ')}` : 'There is no Problem Statement for this epic yet: in References / Sources write [To confirm: link to the Problem Statement], and mark KPI baselines [To confirm].';
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

export async function generateFbd({ project, epicId, instructions, ai = {}, meta }: any) {
  const epic = project.epics.find((e) => e.id === epicId);
  if (!epic) throw Object.assign(new Error('That epic isn’t in this project.'), { status: 404 });
  const tickets = project.tickets.filter((t) => t.epicId === epic.id && !t.parentId);
  const docs: any[] = [];
  if (project.sourceText) docs.push({ name: project.sourceName || 'Initial document', text: project.sourceText });
  for (const d of project.sources || []) if ((d.epicIds || []).includes(epic.id) && d.text) docs.push({ name: d.name, text: d.text });
  const { text: template } = await getFbdTemplate(project.id);
  const rules = await getRules();
  const system = `${SYSTEM_FBD}${guideBlock(await getGuide(), ['tickets'])}${await agentInstructions('feature-brief')}${contextBlock(project)}`;
  const reasoning = rules.reasoning === 'fast' ? 'balanced' : rules.reasoning;
  let md = cleanMarkdown(await askClaude({ ...ai, task: 'docs', reasoning, system, prompt: fbdPrompt({ project, epic, tickets, docs, template, instructions, meta }), brain: { projectId: project.id, epics: [epic], query: instructions } }));
  const missing = missingSections(md, template);
  if (missing.length) { // one repair round: put the missing sections back
    md = cleanMarkdown(await askClaude({ ...ai, task: 'docs', reasoning, system, prompt: `This Feature Brief is missing these template sections: ${missing.join('; ')}. Return the complete document again with every section of the template, in order, keeping all the content already written.\n\nTEMPLATE:\n${template}\n\nDOCUMENT:\n${md}` }));
  }
  return { markdown: md, sections: sectionsOf(md), missing: missingSections(md, template) };
}
