// Questions before the AI writes: for every generation or enhancement (tickets, acceptance criteria, test cases,
// automation scripts, Feature Briefs, Architecture Record Designs), the AI first reads what it was given and asks the
// few questions whose answers would most change the result. The person answers (or skips), and the answers go to the
// generation as extra instructions.
import { askJson } from './claude.js';
import { getRules } from './genrules.js';
import { contextBlock } from './appcontext.js';

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

const TASKS = {
  project: 'turn the requirements document into epics, user stories, acceptance criteria and test cases',
  feature: 'plan new epics and issues (with acceptance criteria and test cases) for this feature in the existing project',
  'new-ticket': 'write one new issue (user story, description, acceptance criteria and test cases) from the idea',
  enhance: 'enhance the issue: sharpen the title, complete the user story and description, make the acceptance criteria complete and testable, and update the test cases',
  ac: 'rewrite the issue’s acceptance criteria so they are complete and testable',
  tests: 'write the test cases (positive, negative and edge cases) for the issue',
  split: 'split the issue into 2–5 smaller, independently deliverable issues',
  custom: 'apply the user’s instruction to the issue',
  'bulk-tests': 'write test cases for each of these issues',
  automation: 'write Playwright test scripts that automate these test cases against the running application',
  fbd: 'write the Feature Brief for this epic',
  ard: 'write the Architecture Record Design (technical design, decisions, rollout, rollback, verification) for this epic',
  psd: 'write the Problem Statement for this epic',
};

const ticketText = (t) => [
  `${t.key || ''} ${t.title || ''} [${t.type || 'Story'}]`,
  t.userStory && `Story: ${clip(t.userStory, 400)}`,
  t.description && `Description: ${clip(t.description, 800)}`,
  t.acceptanceCriteria?.length && `Acceptance criteria: ${t.acceptanceCriteria.slice(0, 10).map((a) => clip(a, 200)).join(' | ')}`,
  t.testCases?.length && `Test cases: ${t.testCases.slice(0, 10).map((c) => clip(c.title, 120)).join(' | ')}`,
].filter(Boolean).join('\n');

/** Returns { questions: [{ id, question, why, options: string[] }] } — at most 5, possibly none. */
export async function clarifyQuestions({ kind, project = null, ticket = null, tickets = [], epicId = null, text = '', instructions = '', ai = {} }) {
  const task = TASKS[kind];
  if (!task) throw Object.assign(new Error('Unknown generation.'), { status: 400 });
  const epic = project?.epics?.find((e) => e.id === (epicId || ticket?.epicId));
  const epicIssues = epic ? project.tickets.filter((t) => t.epicId === epic.id && !t.parentId) : [];
  const material = [
    project && `Project: ${project.name}\nDescription: ${clip(project.description || project.summary, 1200) || 'n/a'}`,
    project?.assumptions?.length && `Assumptions already recorded: ${project.assumptions.slice(0, 15).map((a) => clip(a, 160)).join(' | ')}`,
    project?.openQuestions?.length && `Open questions already recorded: ${project.openQuestions.slice(0, 15).map((a) => clip(a, 160)).join(' | ')}`,
    epic && `Epic: ${epic.key || ''} ${epic.title}\n${clip(epic.description, 1000)}`,
    epic && ['fbd', 'ard', 'psd'].includes(kind) && `Issues in the epic:\n${epicIssues.slice(0, 40).map((t) => `- ${t.key || ''} ${t.title}`).join('\n') || '- none'}`,
    epic?.psd && ['fbd', 'ard'].includes(kind) && `The epic has a Problem Statement: ${clip(epic.psd.atAGlance?.problem || epic.psd.problemStatement, 500)}`,
    epic?.fbd?.markdown && kind === 'ard' && `The epic's Feature Brief:\n${clip(epic.fbd.markdown, 5000)}`,
    kind === 'ard' && project?.dev && (project.dev.repo || project.dev.notes) && `Repository: ${project.dev.repo || project.dev.localPath || ''} ${clip(project.dev.notes, 800)}`,
    ticket && `The issue:\n${ticketText(ticket)}`,
    tickets.length && `The issues:\n${tickets.slice(0, 25).map(ticketText).join('\n\n')}`,
    text && `The document / description:\n${clip(text, 12000)}`,
    instructions && `Instructions the user already gave: ${clip(instructions, 1500)}`,
  ].filter(Boolean).join('\n\n');
  const rules = await getRules();
  const res = await askJson({ ...ai, task: 'quick', reasoning: 'fast',
    system: `You are a senior business analyst and QA lead. Before writing anything, you ask the person the few questions
whose answers would most change what you write. Rules:
- At most 5 questions, the most important first. Ask none if the material already answers what matters.
- Only questions the material does not answer. Never ask what you could reasonably infer.
- Each question is one short sentence, specific to this material (roles, rules, limits, edge cases, environments, data, priorities).
- For each, give 2–4 likely answers as short options, and one short "why" saying what it changes.
Return JSON only: { "questions": [ { "question": "...", "why": "...", "options": ["...", "..."] } ] }` + contextBlock(project, { short: true }),
    prompt: `${material}\n\nYou are about to ${task}.${rules.custom ? `\nTeam rules: ${clip(rules.custom, 800)}` : ''}\nWhat do you need to ask first?` });
  const questions = (Array.isArray(res?.questions) ? res.questions : []).slice(0, 5).map((q, i) => ({
    id: `q${i + 1}`, question: clip(q.question, 300), why: clip(q.why, 200),
    options: (Array.isArray(q.options) ? q.options : []).map((o) => clip(o, 120)).filter(Boolean).slice(0, 4),
  })).filter((q) => q.question);
  return { questions };
}

/** The person's answers as instructions for the generation. */
export const answersText = (qa) => qa.filter((x) => x.answer?.trim()).map((x) => `- ${x.question} → ${x.answer.trim()}`).join('\n');
