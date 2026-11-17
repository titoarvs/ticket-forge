// Brainstorming a new feature before anything is created. Given a description (or a document), the AI works it through
// like a product lead would: the problem, goals and what is out of scope, who it is for, options and trade-offs, risks,
// assumptions and open questions, and the epics the work should become. The result feeds the Problem Statement, Feature
// Brief and Architecture Record Design of each epic (lib/feature-docs.ts), which are approved before any issue is written.
import { askJson } from './claude';
import { SYSTEM_BA, systemWith } from './prompts';
import { getRules, getGuide } from './genrules';
import { agentInstructions } from './agents';
import { contextBlock } from './appcontext';

const clip = (s: any, n: number) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const list = (a: any, n = 12, len = 300) => (Array.isArray(a) ? a : []).map((x) => clip(typeof x === 'string' ? x : x?.text || x?.title || '', len)).filter(Boolean).slice(0, n);

export async function brainstormFeature({ project, text, sourceName, answers = '', instructions = '', ai = {}, emit = (_e: any) => {} }: any) {
  const rules = await getRules();
  const guide = await getGuide();
  const epics = (project.epics || []).map((e: any) => `- "${e.title}"${e.description ? `: ${clip(e.description, 160)}` : ''}`).join('\n') || '- (none yet)';
  const issues = (project.tickets || []).filter((t: any) => !t.parentId).slice(0, 120).map((t: any) => `- ${t.key || ''} ${clip(t.title, 90)}`).join('\n') || '- (none yet)';
  emit({ stage: 'brainstorm', message: `Brainstorming “${sourceName || 'the feature'}” against ${project.name}…` });
  let tick = 0;
  const raw: any = await askJson({
    task: 'epics', ...ai, reasoning: rules.reasoning === 'fast' ? 'balanced' : rules.reasoning,
    system: `${SYSTEM_BA}${systemWith(rules, ['tickets'], guide)}${await agentInstructions('working-tickets')}${contextBlock(project)}`,
    prompt: `Brainstorm a new feature for an existing project BEFORE any epic or issue is written. Think it through the way a product lead and a tech lead would together: be concrete and specific to this project, challenge the idea, and say what you don't know instead of guessing.

Project: ${project.name || ''}
${project.description ? `Description: ${clip(project.description, 600)}\n` : ''}Summary of the initial document: ${clip(project.summary, 500) || 'n/a'}

Existing epics (when the feature belongs to one of them, use its exact title and set "existing": true):
${epics}

Existing issues (so you don't repeat them):
${issues}

THE FEATURE${sourceName ? ` (from “${sourceName}”)` : ''}:
${clip(text, 14000)}
${answers ? `\nAnswers the team already gave:\n${clip(answers, 3000)}\n` : ''}${instructions ? `\nInstructions from the team:\n${clip(instructions, 1500)}\n` : ''}
Return JSON with exactly this shape:
{
  "summary": "two or three sentences: what the feature is and why it is worth doing",
  "problem": "the problem it solves, for whom, and what happens today without it",
  "goals": ["what success looks like, measurable where possible"],
  "nonGoals": ["what this deliberately does not do"],
  "personas": [ { "who": "role", "need": "what they need from this" } ],
  "ideas": [ { "title": "a way to deliver it", "why": "what makes it attractive" } ],
  "options": [ { "name": "approach", "pros": ["…"], "cons": ["…"], "recommended": true } ],
  "risks": [ { "risk": "what could go wrong", "mitigation": "what to do about it" } ],
  "assumptions": ["things taken as true that should be confirmed"],
  "openQuestions": ["questions that need an answer from stakeholders before or during the work"],
  "epics": [ { "title": "an existing epic's exact title, or a new epic's name", "existing": false, "description": "what it covers and its business goal", "reason": "why this is its own epic" } ]
}
Propose as few epics as the work really needs (usually one to three). Mark exactly one option as recommended.`,
    brain: { projectId: project.id, query: clip(text, 3000), max: 7000 },
    onText: (_n: number, total: number) => { if (total - tick > 400) { tick = total; emit({ stage: 'brainstorm', progressChars: total }); } },
  });
  const epicsOut = (Array.isArray(raw.epics) ? raw.epics : []).map((e: any) => ({ title: clip(e?.title, 120), description: clip(e?.description, 600), reason: clip(e?.reason, 300), existing: false }))
    .filter((e: any) => e.title).slice(0, 8);
  const byTitle = new Map((project.epics || []).map((e: any) => [String(e.title).trim().toLowerCase(), e]));
  for (const e of epicsOut) { const m: any = byTitle.get(e.title.toLowerCase()); if (m) { e.existing = true; e.title = m.title; e.id = m.id; e.description = e.description || m.description || ''; } }
  return {
    summary: clip(raw.summary, 700), problem: clip(raw.problem, 900), goals: list(raw.goals), nonGoals: list(raw.nonGoals), assumptions: list(raw.assumptions), openQuestions: list(raw.openQuestions, 15),
    personas: (Array.isArray(raw.personas) ? raw.personas : []).map((p: any) => ({ who: clip(p?.who, 80), need: clip(p?.need, 250) })).filter((p: any) => p.who).slice(0, 8),
    ideas: (Array.isArray(raw.ideas) ? raw.ideas : []).map((p: any) => ({ title: clip(p?.title, 100), why: clip(p?.why, 250) })).filter((p: any) => p.title).slice(0, 8),
    options: (Array.isArray(raw.options) ? raw.options : []).map((o: any) => ({ name: clip(o?.name, 100), pros: list(o?.pros, 6, 160), cons: list(o?.cons, 6, 160), recommended: o?.recommended === true })).filter((o: any) => o.name).slice(0, 6),
    risks: (Array.isArray(raw.risks) ? raw.risks : []).map((r: any) => ({ risk: clip(r?.risk, 250), mitigation: clip(r?.mitigation, 250) })).filter((r: any) => r.risk).slice(0, 10),
    epics: epicsOut,
  };
}

/** The brainstorm as text for the documents' prompts: what the team decided, so the documents agree with it. */
export function brainstormDigest(b: any, notes = '') {
  if (!b) return notes ? `Decisions and notes from the team:\n${notes}` : '';
  const rec = (b.options || []).find((o: any) => o.recommended);
  return [
    'THE FEATURE WAS BRAINSTORMED FIRST; the documents must agree with this outcome:',
    b.problem && `Problem: ${b.problem}`,
    b.goals?.length && `Goals: ${b.goals.join('; ')}`,
    b.nonGoals?.length && `Out of scope: ${b.nonGoals.join('; ')}`,
    b.personas?.length && `Who it is for: ${b.personas.map((p: any) => `${p.who} (${p.need})`).join('; ')}`,
    rec && `Chosen approach: ${rec.name}. Pros: ${(rec.pros || []).join('; ')}. Cons: ${(rec.cons || []).join('; ')}.`,
    b.risks?.length && `Risks: ${b.risks.map((r: any) => `${r.risk} → ${r.mitigation}`).join('; ')}`,
    b.assumptions?.length && `Assumptions to confirm: ${b.assumptions.join('; ')}`,
    b.openQuestions?.length && `Open questions (keep them as [To confirm: …], don't invent answers): ${b.openQuestions.join('; ')}`,
    notes && `Decisions and notes from the team (these override the above):\n${notes}`,
  ].filter(Boolean).join('\n').slice(0, 5500);
}
