// Issues for an epic, written from its approved documents. The epic's Problem Statement, Feature Brief and Architecture
// Record Design must all be approved (lib/approval.ts), and the issues are written only from those approved versions:
// the Feature Brief's acceptance scenarios (AS-xx) become issues and acceptance criteria, the Architecture Record's
// components and decisions (AD-xx) become the technical scope, and the Problem Statement keeps the work on the problem.
import { askJson } from './claude';
import { SYSTEM_BA, systemWith, TICKET_SHAPE } from './prompts';
import { getRules, getGuide, applyTicketRules } from './genrules';
import { agentInstructions } from './agents';
import { normTicket, uid } from './model';
import { contextBlock } from './appcontext';
import { writeTestCases } from './generate';
import { approvalCheck } from './approval';
import { err } from './errors';

const clip = (s: any, n: number) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

/** Throws a 409 naming what still needs approving; returns the check when all three are approved. */
export function requireApproved(epic: any) {
  const c = approvalCheck(epic);
  if (!c.ok) throw Object.assign(err(`Issues are written from approved documents. Still to approve for “${epic?.title || 'this epic'}”: ${c.blocking}.`, 409), { extra: { code: 'docs-not-approved', docs: c.docs } });
  return c;
}

function psdText(psd: any) {
  const list = (a: any[], f: (x: any) => string) => (a || []).slice(0, 12).map((x) => `- ${f(x)}`).join('\n');
  return [
    `Problem: ${clip(psd.atAGlance?.problem || psd.problemStatement, 1500)}`,
    psd.atAGlance?.whyItMatters && `Why it matters: ${clip(psd.atAGlance.whyItMatters, 600)}`,
    psd.problemStatement && psd.atAGlance?.problem && `Problem statement: ${clip(psd.problemStatement, 1500)}`,
    psd.affected?.length && `Who is affected:\n${list(psd.affected, (a) => [a.who, a.impact || a.how].filter(Boolean).join(': '))}`,
    psd.costOfInaction && `Cost of inaction: ${clip(typeof psd.costOfInaction === 'string' ? psd.costOfInaction : JSON.stringify(psd.costOfInaction), 800)}`,
  ].filter(Boolean).join('\n');
}

/** The documents of the prompt: the epic's own approved PSD, FBD and ARD. */
function docsBlock(epic: any) {
  return `=== PROBLEM STATEMENT (approved ${epic.psd.version || ''}) ===
${psdText(epic.psd)}

=== FEATURE BRIEF (approved ${epic.fbd.version || ''}) ===
${clip(epic.fbd.markdown, 14000)}

=== ARCHITECTURE RECORD DESIGN (approved ${epic.ard.version || ''}) ===
${clip(epic.ard.markdown, 14000)}`;
}

function prompt({ project, epic, instructions, granularity, existing }: any) {
  const g = { coarse: 'Prefer fewer, larger issues (still sprint-sized).', balanced: 'Use a balanced granularity.', fine: 'Prefer many small, very focused issues.' }[granularity as string] || 'Use a balanced granularity.';
  return `Write the issues for ONE epic, from its three APPROVED documents. They are the source of truth: don't add scope that isn't in them and don't leave any of their scope out.

Project: ${project.name || ''}
Epic: ${epic.key || ''} ${epic.title}${epic.description ? `\nEpic description: ${clip(epic.description, 800)}` : ''}

${docsBlock(epic)}

Issues this epic already has (don't repeat or rewrite them; only add what's missing):
${existing || '- (none yet)'}

How to write them:
- Every acceptance scenario of the Feature Brief (AS-01, AS-02…) must be covered by at least one issue, and an issue's acceptance criteria come from the scenarios it covers (Given/When/Then, in the brief's own words).
- Follow the Architecture Record: use its components, interfaces and decisions (AD-01…) in the issues' technical scope and names; include the issues for its data changes, security, rollout and rollback when it has them.
- Mention the scenarios and decisions an issue covers in its description as "Covers: AS-01, AS-03. Decisions: AD-02." so the work can be traced back.
- Where the documents leave something open ("[To confirm: …]" or open decisions), don't invent an answer: put it in openQuestions.
- Order the issues so dependencies come first. ${g}
${instructions ? `Additional instructions from the user:\n${instructions}\n` : ''}
Return JSON with exactly this shape:
{
  "summary": "one or two sentences: what these issues deliver",
  "openQuestions": ["open questions from the documents that need an answer before or during the work"],
  "coverage": [ { "scenario": "AS-01", "issues": ["title of an issue that covers it"] } ],
  "tickets": [ ${TICKET_SHAPE} ]
}
Do not include test cases yet.`;
}

/**
 * Writes issues for an epic from its approved documents. Nothing is saved: the person reviews the result and adds what
 * they choose. Returns { summary, openQuestions, coverage, uncovered, tickets, docs }.
 */
export async function generateEpicIssues({ project, epicId, instructions = '', options = {}, ai: aiIn = {}, emit = (_e: any) => {}, signal }: any) {
  const epic = (project.epics || []).find((e: any) => e.id === epicId);
  if (!epic) throw err('That epic isn’t in this project (save first if you just created it).', 404);
  const check = requireApproved(epic);
  const base = await getRules();
  const perTicket = Number(options.testsPerTicket) || base.tests.perTicket;
  const rules = { ...base, tests: { ...base.tests, perTicket } };
  const guide = await getGuide();
  const ai = { ...aiIn, signal, reasoning: rules.reasoning, onSwitch: (message: string) => emit({ stage: 'info', level: 'warn', message }) };
  const existing = (project.tickets || []).filter((t: any) => t.epicId === epic.id && t.type !== 'Sub-task').slice(0, 150).map((t: any) => `- ${t.key || ''} ${t.title}`).join('\n');
  const briefText = String(epic.fbd?.markdown || '');
  emit({ stage: 'epic-issues', message: `Reading the approved Problem Statement, Feature Brief and Architecture Record for “${epic.title}”…` });
  let tick = 0;
  const raw = await askJson({
    task: 'tickets', ...ai,
    system: systemWith(rules, ['tickets'], guide) + await agentInstructions('working-tickets') + contextBlock(project) + `\n${SYSTEM_BA}`,
    prompt: prompt({ project, epic, instructions: String(instructions || '').slice(0, 3000), granularity: options.granularity, existing }),
    brain: { projectId: project.id, epics: [epic], query: `${epic.title} ${briefText.slice(0, 600)}`, max: 5000 },
    onText: (_n: number, total: number) => { if (total - tick > 400) { tick = total; emit({ stage: 'epic-issues', progressChars: total }); } },
  });
  const tickets = (raw.tickets || []).map((t: any) => {
    const n = applyTicketRules(normTicket({ ...t, id: uid() }, epic.id), rules);
    return n;
  });
  // Which of the brief's scenarios have an issue: the AI's own account, checked against the scenario ids in the brief.
  const scenarios = [...new Set(briefText.match(/\bAS-\d{2,3}\b/g) || [])];
  const coverage = scenarios.map((s) => ({ scenario: s, issues: tickets.filter((t: any) => new RegExp(`\\b${s}\\b`).test(`${t.description || ''} ${t.userStory || ''} ${(t.acceptanceCriteria || []).join(' ')} ${(t.labels || []).join(' ')}`)).map((t: any) => t.title) }));
  const uncovered = coverage.filter((c) => !c.issues.length).map((c) => c.scenario);
  emit({ stage: 'epic-issues-done', message: `Planned ${tickets.length} issue${tickets.length === 1 ? '' : 's'}${scenarios.length ? `, covering ${scenarios.length - uncovered.length} of ${scenarios.length} acceptance scenarios` : ''}.` });
  if (options.includeTests !== false && tickets.length) await writeTestCases({ epics: [{ id: epic.id, title: epic.title }], tickets, summary: project.summary, rules, guide, ai, emit, signal });
  return {
    summary: String(raw.summary || ''), openQuestions: (raw.openQuestions || []).map(String), coverage, uncovered, tickets,
    docs: check.docs.map((d: any) => ({ kind: d.kind, label: d.label, version: d.version, approvedBy: d.approvedBy, approvedAt: d.approvedAt })),
  };
}
