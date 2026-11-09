// Problem Statement documents (PSD), one per epic, in the structure of the team's template:
// 1 At a Glance · 2 Background · 3 Problem Statement (+ gaps) · 4 Who Is Affected · 5 Business impact ·
// 6 Impact on Users (per role) · 7 Cost of Inaction · 8 Evidence Needed. Problem-centred: what hurts, for whom,
// and what it costs, not how to build it.
import { askJson } from './claude.js';
import { agentInstructions } from './agents.js';
import { getRules, getGuide, guideBlock } from './genrules.js';

const SYSTEM_PSD = `You are a senior product analyst writing a Problem Statement document (PSD) for one feature (an epic).
A PSD is problem-centred: it explains what is wrong today, who it hurts, what it costs the business and the users, what
happens if nothing is done, and what evidence is still needed. It does not design the solution: "What is proposed" is one
plain sentence.

Write like the team's template:
- Plain, specific, business language a non-technical reader understands. Short sentences. No marketing words.
- Use the product, role and screen names exactly as the material uses them.
- Ground every statement in the material given. Do not invent numbers, customers, incidents or regulations. When a point
  needs confirming, keep it and mark it in square brackets, e.g. "[To validate with Sales: how many deals were affected.]".
- Tables have 3 to 6 rows each; bullets 3 to 6 items. Every cell is a full, readable sentence or phrase.
Output only JSON.`;

const SHAPE = `{
  "product": "the product or company name the document is about, e.g. Tito Payroll",
  "title": "the feature name for the cover, e.g. Centralized Audit Logs",
  "atAGlance": { "problem": "one sentence", "whyItMatters": "one or two sentences", "whoIsAffected": "the roles, in one sentence", "whatIsProposed": "one sentence, no design detail" },
  "definition": { "term": "a key term a reader may not know, e.g. What is an audit log?", "text": "one or two plain sentences" } or null,
  "background": { "context": "a paragraph: what the product does and the situation this epic lives in", "today": ["what happens today", "…"] },
  "problemStatement": "one paragraph: the core problem, why it exists, and who is left unable to do what",
  "gapsTitle": "a short label for the gaps table, e.g. Why the record does not exist today",
  "gaps": [ { "gap": "short name", "meaning": "what it means", "examples": [ { "area": "screen or module", "text": "a concrete example" } ] } ],
  "affected": [ { "who": "role or group", "relationship": "their relationship to the product", "how": "how they are affected" } ],
  "relationshipHeader": "header for the relationship column, e.g. Relationship to Tito Payroll",
  "business": [ { "pain": "pain point", "today": "what happens today", "consequence": "consequence for the business" } ],
  "users": [ { "role": "e.g. Firm Admin (customer)", "rows": [ { "when": "When this happens…", "cannot": "what they cannot do today", "consequence": "consequence for them" } ] } ],
  "costOfInaction": [ { "lead": "a short bold lead sentence", "text": "the rest of the point" } ],
  "evidence": [ { "evidence": "what to collect", "proves": "what it proves", "source": "who or where from", "status": "Not collected" } ]
}`;

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function psdPrompt({ project, epic, tickets, docs, instructions }) {
  const issues = tickets.slice(0, 60).map((t) => [
    `- ${t.key || ''} ${t.title}`,
    t.userStory && `  Story: ${clip(t.userStory, 300)}`,
    t.description && `  ${clip(t.description, 400)}`,
    t.acceptanceCriteria?.length && `  Acceptance: ${t.acceptanceCriteria.slice(0, 5).map((a) => clip(a, 160)).join(' | ')}`,
  ].filter(Boolean).join('\n')).join('\n');
  const docText = docs.map((d) => `### ${d.name}\n${clip(d.text, 9000)}`).join('\n\n');
  return `Write the Problem Statement document for this epic of the project "${project.name}".

Project description: ${clip(project.description, 1500) || 'n/a'}
Summary of the initial document: ${clip(project.summary, 1500) || 'n/a'}
Assumptions: ${(project.assumptions || []).slice(0, 15).map((a) => clip(a, 200)).join(' | ') || 'none'}
Open questions: ${(project.openQuestions || []).slice(0, 15).map((a) => clip(a, 200)).join(' | ') || 'none'}

EPIC: ${epic.title}
${epic.description ? `Epic description: ${clip(epic.description, 1500)}\n` : ''}
Issues in this epic (what is planned):
${issues || '- (no issues yet)'}

Source material (use what concerns this epic; ignore the rest):
${docText || '(none)'}
${instructions ? `\nExtra instructions from the team: ${clip(instructions, 1500)}\n` : ''}
Return JSON exactly in this shape:
${SHAPE}`;
}

const arr = (v, n = 8) => (Array.isArray(v) ? v.filter(Boolean).slice(0, n) : []);
const str = (v) => String(v ?? '').trim();

/** Fills gaps so every section of the template has something to show. */
export function normalizePsd(raw = {}, { project, epic } = {}) {
  const g = raw.atAGlance || {};
  return {
    product: str(raw.product) || project?.name || '',
    title: str(raw.title) || epic?.title || 'Problem Statement',
    atAGlance: { problem: str(g.problem), whyItMatters: str(g.whyItMatters), whoIsAffected: str(g.whoIsAffected), whatIsProposed: str(g.whatIsProposed) },
    definition: raw.definition?.term && raw.definition?.text ? { term: str(raw.definition.term), text: str(raw.definition.text) } : null,
    background: { context: str(raw.background?.context), today: arr(raw.background?.today).map(str) },
    problemStatement: str(raw.problemStatement),
    gapsTitle: str(raw.gapsTitle) || 'Why this happens today',
    gaps: arr(raw.gaps).map((x) => ({ gap: str(x.gap), meaning: str(x.meaning), examples: arr(x.examples, 6).map((e) => ({ area: str(e.area), text: str(e.text) })).filter((e) => e.text) })),
    affected: arr(raw.affected).map((x) => ({ who: str(x.who), relationship: str(x.relationship), how: str(x.how) })),
    relationshipHeader: str(raw.relationshipHeader) || `Relationship to ${str(raw.product) || project?.name || 'the product'}`,
    business: arr(raw.business).map((x) => ({ pain: str(x.pain), today: str(x.today), consequence: str(x.consequence) })),
    users: arr(raw.users, 6).map((u) => ({ role: str(u.role), rows: arr(u.rows).map((r) => ({ when: str(r.when), cannot: str(r.cannot), consequence: str(r.consequence) })) })).filter((u) => u.role && u.rows.length),
    costOfInaction: arr(raw.costOfInaction).map((x) => (typeof x === 'string' ? { lead: '', text: str(x) } : { lead: str(x.lead), text: str(x.text) })),
    evidence: arr(raw.evidence).map((x) => ({ evidence: str(x.evidence), proves: str(x.proves), source: str(x.source), status: str(x.status) || 'Not collected' })),
  };
}

/** Writes the PSD for one epic with the AI. */
export async function generatePsd({ project, epicId, instructions, ai = {} }) {
  const epic = project.epics.find((e) => e.id === epicId);
  if (!epic) throw Object.assign(new Error('That epic isn’t in this project.'), { status: 404 });
  const tickets = project.tickets.filter((t) => t.epicId === epic.id && !t.parentId);
  // The source documents: the initial one, and any added document that produced this epic.
  const docs = [];
  if (project.sourceText) docs.push({ name: project.sourceName || 'Initial document', text: project.sourceText });
  for (const d of project.sources || []) if ((d.epicIds || []).includes(epic.id) && d.text) docs.push({ name: d.name, text: d.text });
  const rules = await getRules();
  const guide = await getGuide();
  const raw = await askJson({ ...ai, reasoning: rules.reasoning === 'fast' ? 'balanced' : rules.reasoning, system: `${SYSTEM_PSD}${guideBlock(guide, ['tickets'])}${await agentInstructions('problem-statement')}`, prompt: psdPrompt({ project, epic, tickets, docs, instructions }) });
  return normalizePsd(raw, { project, epic });
}
