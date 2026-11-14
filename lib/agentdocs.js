// Document agents (lib/agents.js, runner "document"): Epic, Kick Off, Demo, Sign-Off and Manual, Deploy, Release
// Certification and Review a Submission. Each writes one Markdown document for an epic from everything TicketForge
// knows about it: the epic, its Problem Statement and Feature Brief, its issues with their status, points, assignees,
// test results and pull requests, and the documents the other agents already wrote. The app saves the result on the
// epic (epic.agentDocs[agentId]).
import { askClaude } from './claude.js';
import { getRules, getGuide, guideBlock } from './genrules.js';
import { ensureAgent } from './agents.js';
import { contextBlock } from './appcontext.js';

const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

const SYSTEM_DOC = `You are an experienced delivery lead on a software team. You write one working document for one feature
(an epic) from the facts you are given. Rules:
- Use only the facts given. When something needed is unknown, write [To confirm: what is needed] instead of inventing it.
- Be specific: real issue keys, names, numbers and dates from the data. Short sentences. Tables where they help.
- Output GitHub-flavoured Markdown only, starting with a level-1 heading. No preamble, no closing remarks.`;

/** Everything known about the epic, as text for the prompt. */
export function epicContext(project, epic) {
  const tickets = project.tickets.filter((t) => t.epicId === epic.id);
  const tests = tickets.flatMap((t) => t.testCases || []);
  const count = (s) => tests.filter((tc) => tc.status === s).length;
  const points = tickets.reduce((n, t) => n + (Number(t.points) || 0), 0);
  const issues = tickets.slice(0, 80).map((t) => [
    `- ${t.key || ''} [${t.type || 'Story'} · ${t.status || 'To Do'}${t.points ? ` · ${t.points} pts` : ''}${t.assignee ? ` · ${t.assignee}` : ''}${t.priority ? ` · ${t.priority}` : ''}] ${t.title}`,
    t.userStory && `  Story: ${clip(t.userStory, 240)}`,
    t.acceptanceCriteria?.length && `  Acceptance: ${t.acceptanceCriteria.slice(0, 6).map((a) => clip(a, 160)).join(' | ')}`,
    t.testCases?.length && `  Tests: ${t.testCases.slice(0, 8).map((tc) => `${clip(tc.title, 90)} (${tc.status || 'Not run'})`).join(' | ')}`,
    t.prs?.length && `  Pull requests: ${t.prs.map((pr) => `${pr.repo || ''}#${pr.number} ${pr.status || ''}`).join(', ')}`,
  ].filter(Boolean).join('\n')).join('\n');
  const psd = epic.psd ? `Problem Statement (${epic.psd.status || 'Draft'}): ${clip(epic.psd.problemStatement, 1200)}
At a glance: ${clip(epic.psd.atAGlance?.problem, 300)} / Why it matters: ${clip(epic.psd.atAGlance?.whyItMatters, 300)}
Affected: ${(epic.psd.affected || []).map((a) => a.who).join(', ')}` : 'Problem Statement: not written yet.';
  const fbd = epic.fbd?.markdown ? `Feature Brief (${epic.fbd.status || 'Draft'}):\n${clip(epic.fbd.markdown, 9000)}` : 'Feature Brief: not written yet.';
  const others = Object.entries(epic.agentDocs || {}).map(([id, d]) => `### Earlier document: ${d.name || id}\n${clip(d.markdown, 2500)}`).join('\n\n');
  return `PROJECT: ${project.name}${project.key ? ` (${project.key})` : ''}
Project description: ${clip(project.description, 1200) || 'n/a'}
Team members: ${(project.members || []).map((m) => (typeof m === 'string' ? m : m.name)).filter(Boolean).join(', ') || 'n/a'}

EPIC: ${epic.key || ''} ${epic.title}
Epic description: ${clip(epic.description, 1500) || 'n/a'}
Dates: start ${epic.startDate || epic.start || 'not set'}, due ${epic.dueDate || epic.end || 'not set'}
Totals: ${tickets.length} issues (${tickets.filter((t) => /done/i.test(t.status || '')).length} done), ${points} story points;
${tests.length} test cases: ${count('Passed')} passed, ${count('Failed')} failed, ${count('Blocked')} blocked, ${tests.length - count('Passed') - count('Failed') - count('Blocked')} not run.

${psd}

${fbd}

ISSUES:
${issues || '- (no issues yet)'}
${others ? `\n${others}` : ''}`;
}

/** Runs one document agent on an epic. Returns { markdown }. */
export async function runDocAgent({ project, epicId, agentId, instructions = '', ai = {} }) {
  const agent = await ensureAgent(agentId);
  if (agent.runner !== 'document' || !agent.docPrompt) throw Object.assign(new Error(`${agent.name} isn’t a document agent.`), { status: 400 });
  const epic = project.epics.find((e) => e.id === epicId);
  if (!epic) throw Object.assign(new Error('That epic isn’t in this project.'), { status: 404 });
  const rules = await getRules();
  const system = [SYSTEM_DOC, `\nYou are the ${agent.name} agent. ${agent.docPrompt}`, guideBlock(await getGuide(), ['tickets']),
    agent.instructions && `\nInstructions from your team's administrator:\n${agent.instructions}`, contextBlock(project)].filter(Boolean).join('\n');
  const prompt = `${epicContext(project, epic)}
${instructions ? `\nExtra instructions for this run: ${clip(instructions, 2000)}\n` : ''}
Write the ${agent.name} document for the epic "${epic.title}" now.`;
  let md = await askClaude({ ...ai, task: 'agents', reasoning: rules.reasoning === 'fast' ? 'balanced' : rules.reasoning, system, prompt, brain: { projectId: project.id, epics: [epic], query: instructions } });
  const fence = md.match(/```(?:markdown|md)?\s*([\s\S]*?)```\s*$/i);
  if (fence && !/^#\s/m.test(md.slice(0, md.indexOf('```')))) md = fence[1];
  const start = md.search(/^#\s/m);
  if (start > 0) md = md.slice(start);
  return { markdown: `${md.replace(/\n{3,}/g, '\n\n').trim()}\n` };
}
