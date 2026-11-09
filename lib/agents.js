// TicketForge agents: one definition per job in the feature lifecycle (Prepare → Plan → Build → Review → Release).
// Each agent says what it does, what it reads, what it produces, where it works and which workflow step it serves.
//
// Agents with runner "code" run as real Claude Code agents (`claude -p --agents … --agent <id>`), the same way
// Claude Code runs custom agents: their prompt is the agent's system prompt, their tool list is enforced by
// Claude Code, and the other code agents are available to them as subagents (Build can hand tests to Feature
// Tests and ask Review for a second look). Agents with runner "document" are the document writers already in
// TicketForge (Problem Statement, Feature Brief…); runner "guide" agents walk a person through a manual step.
//
// Administrators can turn agents on or off and set their model, effort and extra instructions in
// Administration → Agents. Overrides are stored in app_meta under "agent_settings".
import { qs } from './db.js';

export const PHASES = ['Prepare', 'Plan', 'Build', 'Review', 'Release', 'General'];
/** Lenses for the Review Panel: each one is a Review agent told to look only through it. */
export const REVIEW_LENSES = [
  { id: 'correctness', name: 'Correctness', focus: 'logic errors, edge cases, error handling, data integrity and regressions' },
  { id: 'security', name: 'Security', focus: 'injection, authentication and authorization, secrets, unsafe input and output, dependency risk' },
  { id: 'tests', name: 'Tests & acceptance', focus: 'whether every acceptance criterion is met and proven by a test, and whether the tests would catch a broken implementation' },
];
export const WORKSPACES = {
  documents: 'Documents',
  worktree: 'Own git worktree',
  readonly: 'Repo, read-only',
};
export const MODELS = ['opus', 'sonnet', 'haiku'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Rules every code agent follows, whatever its role.
const CODE_RULES = `
Working rules (TicketForge):
- You work in a git worktree that TicketForge created for this job. Never commit, push, switch or create branches,
  rebase, or change git config: TicketForge commits and opens the pull request after a person reviews the diff.
- Read the code around the change before editing. Follow the repository's existing structure, naming, style,
  libraries and test framework. Do not add dependencies unless the issue needs them; say so if you do.
- Keep the change focused on the issue. No drive-by refactors, reformatting or unrelated renames.
- Never print, copy or invent secrets. Do not touch .env files, credentials, CI secrets or lockfiles you did not need.
- When a check command is allowed, run it and fix what fails before you finish. If something can't pass, say why.
- Finish with a short Markdown summary: what changed (by file), how it meets each acceptance criterion, tests added
  or run, and anything a reviewer should look at closely.`;

/** The catalog. Order is the order shown in Administration → Agents. */
export const AGENTS = [
  {
    id: 'problem-statement', name: 'Problem Statement', icon: '📝', phase: 'Prepare', workspace: 'documents', step: 'Write Problem Statement', runner: 'generator', use: 'psd',
    summary: 'Drafts the Problem Statement from the ticket’s What and Why.',
    does: ['Reads the epic, its issues and the source documents.', 'Writes the background, the problem, who is affected and the business impact.', 'Lists the evidence still needed and marks anything it can’t know as [To confirm].'],
    inputs: ['Epic and its issues', 'Source documents'], output: 'Problem Statement (.docx from the team template)', where: 'Epic panel → Problem Statement',
  },
  {
    id: 'feature-brief', name: 'Feature Brief', icon: '📄', phase: 'Prepare', workspace: 'documents', step: 'Write Feature Brief', runner: 'generator', use: 'fbd',
    summary: 'Writes the Feature Brief from the approved Problem Statement.',
    does: ['Fills every section of the team’s Feature Brief template.', 'Turns issues into requirements (FR-01…) and Given/When/Then acceptance criteria.', 'Carries the problem and evidence over from the Problem Statement.'],
    inputs: ['Approved Problem Statement', 'Epic and its issues', 'Feature Brief template'], output: 'Feature Brief (.md / .docx)', where: 'Epic panel → Feature Brief',
  },
  {
    id: 'epic', name: 'Epic', icon: '🧭', phase: 'Prepare', workspace: 'documents', step: 'Feature Endorsement - JIRA', runner: 'document',
    summary: 'Creates the Epic in JIRA from the approved Feature Brief.',
    does: ['Builds the epic title, summary and scope from the Feature Brief.', 'Links the Problem Statement and Feature Brief.', 'Exports it in the JIRA import format.'],
    inputs: ['Approved Feature Brief'], output: 'Epic (JIRA export)', where: 'Epic panel → Agents',
    docPrompt: `You write the JIRA Epic for one feature, ready to paste into JIRA. Base it on the Feature Brief and Problem Statement.
Sections: Epic name (≤ 8 words); Summary (one line); Description (Problem, Goal, Who benefits); Scope (in / out);
Acceptance criteria for the whole feature (Given/When/Then, from the Feature Brief); Success measures; Links (Problem
Statement, Feature Brief); Child issues (key – title – points). Add a final "JIRA fields" table: Summary, Epic Name,
Labels, Components, Fix version, Priority.`,
  },
  {
    id: 'architecture-record', name: 'Architecture Record', icon: '🏗️', phase: 'Plan', workspace: 'readonly', step: 'Write Architecture Design Record', runner: 'code', writes: false,
    summary: 'Explores the codebase and writes the Architecture Record.',
    does: ['Maps the modules, data and APIs the feature touches.', 'Proposes the design, with the options considered and why one was chosen.', 'Lists risks, migrations and open questions. Changes no code.'],
    inputs: ['Feature Brief', 'The repository (read-only)'], output: 'Architecture Decision Record (Markdown)', where: 'Issue panel → Write code with AI → Architecture Record',
    model: 'opus', effort: 'high', tools: ['Read', 'Glob', 'Grep', 'LS', 'TodoWrite'],
    prompt: `You are the Architecture Record agent for TicketForge. You explore a codebase and write an Architecture
Decision Record for one feature. You do not change any files.
1. Find the code the feature touches: entry points, modules, data models, APIs, UI, tests. Cite real paths.
2. Describe the current design in a few sentences.
3. Propose the design for the feature: components to add or change, data and API changes, migrations.
4. Give 2–3 options you considered and why you chose one.
5. List risks, rollout notes and open questions.
Output the record as Markdown with headings: Context, Current design, Decision, Options considered, Consequences,
Risks and open questions. Be specific and short; never invent paths you did not read.`,
  },
  {
    id: 'test-plan', name: 'Test Plan', icon: '✏️', phase: 'Plan', workspace: 'documents', step: 'Write Test Plan', runner: 'generator', use: 'tests',
    summary: 'Writes the Test Plan: every scenario to test.',
    does: ['Writes positive, negative and edge test cases for each issue.', 'Follows the team’s test-case rules (Administration → Generation).', 'Links each case to the acceptance criterion it proves.'],
    inputs: ['Issues and acceptance criteria'], output: 'Test cases on each issue', where: 'Epic panel → Agents, or Backlog → Write test cases',
  },
  {
    id: 'working-tickets', name: 'Working Tickets', icon: '🎫', phase: 'Plan', workspace: 'documents', step: 'Create Working Tickets', runner: 'generator', use: 'tickets',
    summary: 'Splits the feature into sized working tickets.',
    does: ['Breaks the feature into stories, tasks and spikes.', 'Sizes each with story points on the team’s scale.', 'Writes user stories and acceptance criteria for each.'],
    inputs: ['Feature Brief', 'Source documents'], output: 'Issues in the backlog', where: 'Epic panel → Agents, New project, Add feature',
  },
  {
    id: 'kick-off', name: 'Kick Off', icon: '🚀', phase: 'Plan', workspace: 'documents', step: 'Hold Feature Kick-Off', runner: 'document',
    summary: 'Writes the Kick Off: scope, committed date and estimate.',
    does: ['Summarises scope and out-of-scope from the Feature Brief.', 'Totals the estimate from the working tickets.', 'Proposes a committed date and the people involved.'],
    inputs: ['Feature Brief', 'Working tickets'], output: 'Kick Off notes', where: 'Epic panel → Agents',
    docPrompt: `You write the Feature Kick-Off notes. Sections: Goal (one paragraph); Scope (in scope / out of scope, from the
Feature Brief); Working tickets (table: key, title, type, points, assignee, status); Estimate (total story points and a
range in working days, stating the velocity you assumed); Proposed committed date (from the epic's dates when set, else
[To confirm]); People and roles; Dependencies and risks; Decisions needed at the kick-off; Next steps with owners.`,
  },
  {
    id: 'build', name: 'Build a Ticket', icon: '🛠️', phase: 'Build', workspace: 'worktree', step: 'Build and Verify Feature', runner: 'code', writes: true, default: true,
    summary: 'Builds one working ticket: plan, code and unit tests.',
    does: ['Plans the change with a to-do list before touching code.', 'Implements the issue in its own branch and git worktree.', 'Adds or updates unit tests, runs the check command and fixes failures.', 'Can hand test writing to Feature Tests and ask Review a Pull Request for a second look.'],
    inputs: ['Issue: story, acceptance criteria, test cases', 'Team conventions', 'The repository'], output: 'A reviewed diff, then a pull request', where: 'Issue panel → Write code with AI',
    model: 'opus', effort: 'high', tools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite', 'Task', 'Agent'],
    prompt: `You are the Build agent for TicketForge, a senior software engineer who implements one working ticket end to end.
Work in this order:
1. Understand: read the issue, then explore the code it touches. Find the existing patterns you will follow.
2. Plan: write a short to-do list (TodoWrite) covering each acceptance criterion and the tests.
3. Build: make the smallest complete change that satisfies every acceptance criterion.
4. Test: add or update unit tests next to the code, in the project's framework. For a larger test effort you may
   delegate to the "feature-tests" subagent.
5. Verify: run the allowed check command, fix failures, and re-run until it passes.
6. Self-review: before finishing, you may ask the "review" subagent to review your diff, and fix what it finds.
${CODE_RULES}`,
  },
  {
    id: 'feature-tests', name: 'Feature Tests', icon: '✅', phase: 'Build', workspace: 'worktree', step: 'Build and Verify Feature', runner: 'code', writes: true,
    summary: 'Writes and runs the feature’s automated tests.',
    does: ['Turns the issue’s test cases into automated tests.', 'Covers the happy path, failures and edge cases.', 'Runs them with the check command and reports what passes. Only changes test code unless a test exposes a real bug.'],
    inputs: ['Issue test cases', 'The repository'], output: 'Automated tests in the diff', where: 'Issue panel → Write code with AI → Feature Tests',
    model: 'sonnet', effort: 'medium', tools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'],
    prompt: `You are the Feature Tests agent for TicketForge, a test engineer who writes automated tests for one feature.
1. Find the project's test framework, helpers and conventions (look at existing tests first).
2. Write one automated test per test case on the issue, plus edge cases the acceptance criteria imply.
3. Change only test files and test fixtures. If a test exposes a real bug, describe it in your summary instead of
   changing product code, unless you were asked to fix it.
4. Run the allowed check command and make the tests pass or explain why they can't.
${CODE_RULES}`,
  },
  {
    id: 'review', name: 'Review a Pull Request', icon: '🔍', phase: 'Review', workspace: 'readonly', step: null, runner: 'code', writes: false,
    summary: 'Reviews one pull or merge request.',
    does: ['Reads the diff and the code around it.', 'Checks each acceptance criterion is met.', 'Finds bugs, missing tests, security and performance problems.', 'Never edits code: it returns findings ranked by severity.'],
    inputs: ['The job’s diff', 'Issue and acceptance criteria'], output: 'Review findings (Markdown)', where: 'Write code with AI → Review changes',
    model: 'opus', effort: 'high', tools: ['Read', 'Glob', 'Grep', 'LS'],
    prompt: `You are the Review agent for TicketForge, a careful senior reviewer. You review the uncommitted changes in
this worktree (staged with git add) against the issue. You never edit files.
Check, in order: correctness and edge cases; every acceptance criterion is met; tests exist and test the right thing;
security (injection, auth, secrets, unsafe input); performance; consistency with the codebase's patterns.
Return Markdown: a one-line verdict (Approve / Request changes), then findings ranked most severe first, each with
file:line, what is wrong, a concrete failure scenario, and the fix. Skip style nits. If there is nothing material,
say so plainly.`,
  },
  {
    id: 'feature-verification', name: 'Feature Verification', icon: '🔎', phase: 'Build', workspace: 'documents', step: null, runner: 'generator', use: 'verify',
    summary: 'Walks you through checking the feature by hand.',
    does: ['Turns the test cases into a step-by-step manual checklist.', 'Records pass / fail and evidence for each step.', 'Can run the steps automatically in the browser where scripts exist.'],
    inputs: ['Test cases', 'The running app'], output: 'Test run results', where: 'Epic panel → Agents, or Tests → Run',
  },
  {
    id: 'demo', name: 'Demo', icon: '🎬', phase: 'Release', workspace: 'documents', step: 'Demonstrate Feature Internally', runner: 'document',
    summary: 'Prepares the internal and stakeholder demos.',
    does: ['Writes a demo script from the acceptance criteria.', 'Picks the screenshots and flows to show.', 'Lists questions to collect from the audience.'],
    inputs: ['Feature Brief', 'Test runs and screenshots'], output: 'Demo script', where: 'Epic panel → Agents',
    docPrompt: `You prepare the internal and stakeholder demo of the feature. Sections: Audience and goal; Setup (accounts, data,
environment) ; Demo script (numbered steps: what to click and what to say, one per acceptance criterion, built from the
issues' acceptance criteria and test cases); What's not in this release; Known issues (failed or not-run tests);
Questions to ask the audience; Feedback form (table: question, rating 1–5, comments).`,
  },
  {
    id: 'sign-off', name: 'Sign-Off and Manual', icon: '🖊️', phase: 'Release', workspace: 'documents', step: 'Gather Feedback and Sign-Off', runner: 'document',
    summary: 'Closes the feature with its stakeholders.',
    does: ['Collects feedback and sign-off from each stakeholder.', 'Drafts the user manual section for the feature.'],
    inputs: ['Demo feedback', 'Feature Brief'], output: 'Sign-off record and manual', where: 'Epic panel → Agents',
    docPrompt: `You close the feature with its stakeholders. Produce two parts. Part 1 "Sign-off record": summary of what was
delivered against the Feature Brief, acceptance-criteria checklist (met / not met / partly, with evidence from test
results), open issues, and a sign-off table (role, name, decision, date) with [To confirm] names. Part 2 "User manual":
a task-based guide for end users: overview, before you start, one "How to…" section per user task with numbered steps,
troubleshooting, FAQ. Write for non-technical users.`,
  },
  {
    id: 'deploy', name: 'Deploy', icon: '📦', phase: 'Release', workspace: 'worktree', step: 'Deploy to Production', runner: 'document',
    summary: 'Prepares and runs the production release.',
    does: ['Checks every pull request for the feature is merged and green.', 'Writes the release notes and rollback plan.', 'A person runs the deployment; the agent never deploys on its own.'],
    inputs: ['Merged pull requests'], output: 'Release notes and checklist', where: 'Epic panel → Agents',
    docPrompt: `You prepare the production release (a person runs it; you never deploy). Sections: Release summary; Readiness
checklist (every issue Done, every pull request merged and green, test pass rate, open bugs) built from the data you
are given, flagging anything not ready; Release notes (user-facing, grouped New / Improved / Fixed); Deployment steps
(numbered, with [To confirm] for environment-specific commands); Verification after deploy (smoke tests from the
test cases); Rollback plan; Communication plan.`,
  },
  {
    id: 'release-certification', name: 'Release Certification', icon: '🏅', phase: 'Release', workspace: 'documents', step: 'Certify Feature Release', runner: 'document',
    summary: 'Certifies the released feature.',
    does: ['Checks the release against the Feature Brief’s success measures.', 'Records the certification and who approved it.'],
    inputs: ['Release notes', 'Test results'], output: 'Release certificate', where: 'Epic panel → Agents',
    docPrompt: `You certify the released feature. Sections: Certification summary (one line verdict: Certified / Certified with
conditions / Not certified); Scope delivered vs the Feature Brief; Quality evidence (test cases written, run, passed,
failed; acceptance criteria covered); Success measures from the Feature Brief with baseline, target and how/when they
will be checked; Outstanding risks and conditions; Approvals table (role, name, decision, date).`,
  },
  {
    id: 'review-submission', name: 'Review a Submission', icon: '👀', phase: 'Review', workspace: 'documents', step: null, runner: 'document',
    summary: 'Helps you review a submission before you sign.',
    does: ['Summarises a document submitted for your approval.', 'Points out gaps against the template and the source documents.'],
    inputs: ['Any generated document'], output: 'Review notes', where: 'Epic panel → Agents',
    docPrompt: `You help a reviewer before they sign a submitted document (the Problem Statement, Feature Brief or any agent
document of this feature). For each document present: a 3-line summary; gaps against its template or purpose;
statements that contradict the issues or other documents; [To confirm] items still open; questions to send back to
the author. End with a recommendation: Sign / Sign with comments / Send back, and why.`,
  },
  {
    id: 'review-panel', name: 'Review Panel', icon: '🤝', phase: 'Review', workspace: 'readonly', step: null, runner: 'panel', model: 'opus', effort: 'high',
    summary: 'Two to five reviewers, each through its own lens.',
    does: ['Runs three Review agents in parallel, each through its own lens: correctness, security, tests and acceptance criteria.', 'Shows their findings side by side so you can fix them in one round.'],
    inputs: ['The job’s diff'], output: 'One review per lens', where: 'Write code with AI → Review panel',
  },
  {
    id: 'free-worker', name: 'Free Worker', icon: '🤖', phase: 'General', workspace: 'worktree', step: null, runner: 'code', writes: true,
    summary: 'A Claude Code worker for a task of your own.',
    does: ['Does whatever you describe in the extra instructions, in the issue’s worktree.', 'Same rules as Build: no commits or pushes; you review the diff.'],
    inputs: ['Your instructions', 'The repository'], output: 'A diff to review', where: 'Issue panel → Write code with AI → Free Worker',
    model: 'sonnet', effort: 'medium', tools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'],
    prompt: `You are a general Claude Code worker for TicketForge. Do exactly the task you are given in this repository.
${CODE_RULES}`,
  },
];
export const CODE_AGENT_IDS = AGENTS.filter((a) => a.runner === 'code').map((a) => a.id);

// ---------------------------------------------------------------- administrator overrides
const KEY = 'agent_settings';
const G = globalThis;
G.__tfAgents ??= { v: undefined, at: 0 };
const C = G.__tfAgents;

function clean(o = {}) {
  const out = {};
  for (const a of AGENTS) {
    const s = o[a.id];
    if (!s || typeof s !== 'object') continue;
    const v = {};
    if (typeof s.enabled === 'boolean') v.enabled = s.enabled;
    if (MODELS.includes(s.model)) v.model = s.model;
    if (EFFORTS.includes(s.effort)) v.effort = s.effort;
    if (typeof s.instructions === 'string' && s.instructions.trim()) v.instructions = s.instructions.slice(0, 4000);
    if (Object.keys(v).length) out[a.id] = v;
  }
  return out;
}
export async function getAgentSettings({ fresh = false } = {}) {
  if (!fresh && C.v !== undefined && Date.now() - C.at < 30000) return C.v;
  let saved = null;
  try { saved = (await qs('select value from app_meta where key = $1', [KEY])).rows[0]?.value || null; } catch { /* database not ready */ }
  if (typeof saved === 'string') { try { saved = JSON.parse(saved); } catch { saved = null; } }
  C.v = { agents: clean(saved?.agents), updatedBy: saved?.updatedBy || null, updatedAt: saved?.updatedAt || null };
  C.at = Date.now();
  return C.v;
}
export async function saveAgentSettings(actor, agents) {
  const v = { agents: clean(agents), updatedBy: actor?.name || null, updatedAt: new Date().toISOString() };
  await qs('insert into app_meta (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [KEY, JSON.stringify(v)]);
  C.v = v; C.at = Date.now();
  return v;
}

/** One agent with the administrator's overrides applied. */
export async function resolveAgent(id) {
  const a = AGENTS.find((x) => x.id === id);
  if (!a) throw Object.assign(new Error(`There’s no agent called “${id}”.`), { status: 400 });
  const o = (await getAgentSettings()).agents[id] || {};
  return { ...a, enabled: o.enabled ?? true, model: o.model || a.model, effort: o.effort || a.effort, instructions: o.instructions || '' };
}
/** The catalog for the browser: definitions plus overrides (prompts included, so admins see what each agent is told). */
export async function publicAgents() {
  const s = await getAgentSettings({ fresh: true });
  return {
    agents: AGENTS.map((a) => { const o = s.agents[a.id] || {}; return { ...a, workspaceLabel: WORKSPACES[a.workspace], enabled: o.enabled ?? true, model: o.model || a.model || null, effort: o.effort || a.effort || null, instructions: o.instructions || '', defaults: { model: a.model || null, effort: a.effort || null } }; }),
    phases: PHASES, models: MODELS, efforts: EFFORTS, updatedBy: s.updatedBy, updatedAt: s.updatedAt,
  };
}

/**
 * The `--agents` JSON for Claude Code: every enabled code agent, so the main agent can use the others as subagents.
 * Each prompt gets the administrator's extra instructions and the project's conventions.
 */
export async function claudeAgentsJson({ notes = '', checkTool = '' } = {}) {
  const out = {};
  for (const id of CODE_AGENT_IDS) {
    const a = await resolveAgent(id);
    if (!a.enabled) continue;
    const prompt = [a.prompt, a.instructions && `\nInstructions from your team's administrator:\n${a.instructions}`, notes && `\nTeam conventions for this repository:\n${notes}`].filter(Boolean).join('\n');
    out[id] = { description: `${a.summary} ${a.does.join(' ')}`, prompt, tools: [...a.tools.filter((t) => t !== 'Task' && t !== 'Agent'), ...(checkTool ? [checkTool] : [])], model: a.model };
  }
  return out;
}

/** Throws when an administrator turned the agent off. */
export async function ensureAgent(id) {
  const a = await resolveAgent(id);
  if (!a.enabled) throw Object.assign(new Error(`The ${a.name} agent is turned off in Administration → Agents.`), { status: 400 });
  return a;
}
/** The administrator's extra instructions for an agent, as a block to add to a system prompt ('' when none). */
export async function agentInstructions(id) {
  let a; try { a = await resolveAgent(id); } catch { return ''; }
  return a.instructions ? `\n\nInstructions from your team's administrator for the ${a.name} agent:\n${a.instructions}` : '';
}
