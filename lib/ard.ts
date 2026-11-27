// Architecture Record Design (ARD): the Architecture Record agent (lib/agents.ts) explores the repository read-only and
// fills the team's ARD template for the feature an issue belongs to. It keeps the IDs of the epic's Feature Brief
// (acceptance scenarios AS-xx, open decisions Qxx), so the record traces back to it.
// The ARD is also written per epic (generateArd): from the epic, its issues, Problem Statement, Feature Brief and source
// documents, plus the project's repository notes, saved on the epic like the Feature Brief.
// Templates: the project's own (Project settings → Templates), else the team's (Administration → Generation), else the default.
import { DEFAULT_ARD_TEMPLATE } from './ard-default';
import { getMdTemplate, publicMdTemplate, saveMdTemplate, resetMdTemplate } from './mdtemplate';
import { contextBlock } from './appcontext';

const DEF = { name: 'architecture-record-design-template.md', text: DEFAULT_ARD_TEMPLATE };
const LABEL = 'Architecture Record Design';
const clip = (s, n) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// ---------------------------------------------------------------- template (project → team → default)
export const getArdTemplate = (projectId = null) => getMdTemplate('ard', DEF, projectId);
export const publicArdTemplate = (projectId = null) => publicMdTemplate('ard', DEF, projectId);
export const saveArdTemplate = (actor, text, name, projectId = null) =>
  saveMdTemplate('ard', DEF, { actor, text, name, label: LABEL, projectId });
export const resetArdTemplate = (projectId = null) => resetMdTemplate('ard', DEF, projectId);

// ---------------------------------------------------------------- agent context

/** What the agent needs beyond the issue: the feature, its Problem Statement and Feature Brief, and the template. */
export async function ardContext(project, ticket) {
  const { text: template } = await getArdTemplate(project.id);
  const epic = (project.epics || []).find((e) => e.id === ticket.epicId);
  const siblings = epic
    ? project.tickets.filter((t) => t.epicId === epic.id && !t.parentId && t.id !== ticket.id)
    : [];
  return [
    epic
      ? `The feature (epic) this issue belongs to: ${epic.key || ''} ${epic.title}${epic.description ? `\n${clip(epic.description, 1500)}` : ''}`
      : 'This issue isn’t in an epic: use the issue itself as the feature.',
    siblings.length &&
      `Other issues in the feature:\n${siblings
        .slice(0, 40)
        .map((t) => `- ${t.key || ''} ${t.title}`)
        .join('\n')}`,
    epic?.psd
      ? `Problem Statement Document: "${epic.psd.title || epic.title}: Problem Statement", ${epic.psd.version || 'v1.0'}, ${epic.psd.status || 'Draft'}.
The problem: ${clip(epic.psd.atAGlance?.problem || epic.psd.problemStatement, 600)}`
      : 'Problem Statement Document: not written yet. Write [To confirm: Problem Statement link] in References.',
    epic?.fbd?.markdown
      ? `Feature Brief Document (${epic.fbd.version || 'v1.0'}, ${epic.fbd.status || 'Draft'}). Reuse its acceptance scenario IDs (Section 2.6) and open decision IDs (Section 8) exactly:\n${clip(epic.fbd.markdown, 14000)}`
      : 'Feature Brief Document: not written yet. Derive acceptance scenarios AS-01… from the issue’s acceptance criteria and mark them [To confirm: FBD scenario].',
    `Project: ${project.name}. Document values: feature name "${epic?.title || ticket.title}", version v1.0, date ${new Date().toISOString().slice(0, 10)}, status Draft.`,
    `THE ARCHITECTURE RECORD DESIGN TEMPLATE TO FILL (keep every heading, number, table and column; replace each [bracketed prompt]; replace the example Mermaid diagram with one for this design; remove the <!-- comments -->):\n${template}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

// ---------------------------------------------------------------- per-epic generation
import { askClaude } from './claude';
import { agentInstructions } from './agents';
import { getRules, getGuide, guideBlock } from './genrules';
import { sectionsOf } from './mdtemplate';

const SYSTEM_ARD = `You are a senior solution architect writing the Architecture Record Design (ARD) for one feature (an epic),
by filling in the team's Markdown template. The ARD turns the Feature Brief into a technical design a team can build,
roll out, roll back and verify.

How to fill the template:
- Keep every heading, its numbering and its order exactly. Keep every table and its columns exactly.
- Replace each [bracketed prompt] with real content; add rows where the material supports more, remove example rows and
  rollback levels that don't apply. Remove the <!-- comments -->.
- Design drivers D1, D2… come from the Feature Brief: its sections, KPIs and acceptance scenarios (cite them).
- Decisions AD-01, AD-02…: a summary row each in Section 4 and a full decision record (context, 2–3 options considered,
  decision, consequences) for each.
- Section 3: replace the example Mermaid diagram with a flowchart of this feature's real components and data flow.
- Section 10.2: one row per Feature Brief acceptance scenario, with its exact AS ID and title. Section 11: carry the
  Feature Brief's open decisions with their Q IDs.
- Ground every statement in the material. Never invent people, dates, metrics, file paths, links or numbers. When
  something isn't known, write a short prompt for the team: [To confirm: which queue the events go to].
- Sign-Off: keep the roles; leave Name, Signature and Date empty. Document Control and Revision History: use the values given.
- Plain, specific language. Short sentences.
Output only the finished Markdown document, nothing before or after it.`;

function cleanMarkdown(text) {
  let t = String(text || '').trim();
  const fence = t.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) t = fence[1];
  const start = t.search(/^#\s/m);
  if (start > 0) t = t.slice(start);
  return (
    t
      .replace(/<!--[\s\S]*?-->\s*\n?/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}
const norm = (s) => s.toLowerCase().replace(/^\d+\.\s*/, '');
const missingSections = (md, template) => {
  const have = new Set(sectionsOf(md).map(norm));
  return sectionsOf(template).filter((s) => !have.has(norm(s)));
};

/** Writes the ARD for one epic. Returns { markdown, sections, missing }. Nothing is saved here. */
export async function generateArd({ project, epicId, instructions = '', ai = {}, meta }: any) {
  const epic = project.epics.find((e) => e.id === epicId);
  if (!epic) throw Object.assign(new Error('That epic isn’t in this project.'), { status: 404 });
  const tickets = project.tickets.filter((t) => t.epicId === epic.id && !t.parentId);
  const { text: template } = await getArdTemplate(project.id);
  const docs: any[] = [];
  if (project.sourceText)
    docs.push({ name: project.sourceName || 'Initial document', text: project.sourceText });
  for (const d of project.sources || [])
    if ((d.epicIds || []).includes(epic.id) && d.text) docs.push({ name: d.name, text: d.text });
  const dev = project.dev || {};
  const issues = tickets
    .slice(0, 60)
    .map((t) =>
      [
        `- ${t.key || ''} ${t.title} [${t.type || 'Story'}, ${t.status || 'To Do'}]`,
        t.description && `  ${clip(t.description, 300)}`,
        t.acceptanceCriteria?.length &&
          `  Acceptance criteria: ${t.acceptanceCriteria
            .slice(0, 6)
            .map((a) => clip(a, 160))
            .join(' | ')}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n');
  const prompt = `Fill in the Architecture Record Design template below for this epic of the project "${project.name}".

Project description: ${clip(project.description || project.summary, 1500) || 'n/a'}
${dev.repo || dev.localPath ? `Code repository: ${dev.repo || dev.localPath}${dev.notes ? `\nNotes about the codebase from the team: ${clip(dev.notes, 2000)}` : ''}\n` : ''}
EPIC (the feature): ${epic.key || ''} ${epic.title}
${epic.description ? `Epic description: ${clip(epic.description, 1500)}\n` : ''}
Issues in this epic:
${issues || '- (no issues yet)'}

${
  epic.psd
    ? `Problem Statement Document: "${epic.psd.title || epic.title}: Problem Statement", ${epic.psd.version || 'v1.0'}, ${epic.psd.status || 'Draft'}.
The problem: ${clip(epic.psd.atAGlance?.problem || epic.psd.problemStatement, 800)}`
    : 'Problem Statement Document: not written yet. In References write [To confirm: Problem Statement link].'
}

${
  epic.fbd?.markdown
    ? `Feature Brief Document (${epic.fbd.version || 'v1.0'}, ${epic.fbd.status || 'Draft'}). Reuse its acceptance scenario IDs (Section 2.6) and open decision IDs (Section 8) exactly:
${clip(epic.fbd.markdown, 16000)}`
    : "Feature Brief Document: not written yet. Derive acceptance scenarios AS-01… from the issues' acceptance criteria and mark each [To confirm: FBD scenario]."
}

Source material (use what concerns this epic):
${docs.map((d) => `### ${d.name}\n${clip(d.text, 6000)}`).join('\n\n') || '(none)'}
${instructions ? `\nExtra instructions from the team: ${clip(instructions, 3000)}\n` : ''}
Values for the document: feature name "${epic.title}", version ${meta.version}, date ${meta.date}, status ${meta.status}, prepared by ${meta.preparedBy}.

THE TEMPLATE TO FILL (keep its structure):
${template}`;
  const rules = await getRules();
  const system = `${SYSTEM_ARD}${guideBlock(await getGuide(), ['tickets'])}${await agentInstructions('architecture-record')}${contextBlock(project)}`;
  const reasoning = rules.reasoning === 'fast' ? 'balanced' : rules.reasoning;
  let md = cleanMarkdown(
    await askClaude({
      ...ai,
      task: 'docs',
      reasoning,
      system,
      prompt,
      brain: { projectId: project.id, epics: [epic], query: instructions },
    }),
  );
  const missing = missingSections(md, template);
  if (missing.length) {
    md = cleanMarkdown(
      await askClaude({
        ...ai,
        task: 'docs',
        reasoning,
        system,
        prompt: `This Architecture Record Design is missing these template sections: ${missing.join('; ')}. Return the complete document again with every section of the template, in order, keeping all the content already written.\n\nTEMPLATE:\n${template}\n\nDOCUMENT:\n${md}`,
      }),
    );
  }
  return { markdown: md, sections: sectionsOf(md), missing: missingSections(md, template) };
}
