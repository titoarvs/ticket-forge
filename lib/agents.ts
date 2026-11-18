// TicketForge agents: one definition per job in the feature lifecycle (Prepare → Plan → Build → Review → Release).
// Each agent says what it does, what it reads, what it produces, where it works and which workflow step it serves.
//
// Agents with runner "code" run as real Claude Code agents (`claude -p --agents … --agent <id>`), the same way
// Claude Code runs custom agents: their prompt is the agent's system prompt, their tool list is enforced by
// Claude Code. Each run is one agent working on its own (no subagents: delegating made runs much slower and
// lost the issue's context); a person chains them, e.g. Build, then Review. Agents with runner "document" write a document for an epic in
// TicketForge (the Agent doc); runner "guide" agents walk a person through a manual step.
//
// Administrators can turn agents on or off and set their model, effort and extra instructions in
// Administration → Agents. Overrides are stored in app_meta under "agent_settings".
import { getMeta, setMeta } from './appmeta';
import { askAI } from './claude';
import { wsKey, wsCache } from './wsmeta';

export const PHASES = ['Prepare', 'Plan', 'Build', 'Review', 'Test', 'General'];
export const TEAMS = ['Product', 'Coding', 'Automation', 'UI/UX', 'QA', 'Delivery'];
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
- Work efficiently. Start from the files the issue names or implies: find them with Grep/Glob on specific names
  (routes, components, functions, table names), then read only what you need. Never read node_modules, build output,
  lockfiles or generated files. Run the full check once your change is complete, not after every edit.
- Before finishing, run \`git diff\` and check the change against each acceptance criterion one by one. If one is not
  met, fix it; if it can't be met in this repository, say so plainly instead of claiming it is done.
- Finish with a short Markdown summary: what changed (by file), how it meets each acceptance criterion, tests added
  or run, and anything a reviewer should look at closely.`;

/** The catalog. Order is the order shown in Administration → Agents. */
export const AGENTS = [
  {
    id: 'test-plan', name: 'Test Plan', icon: '✏️', phase: 'Plan', team: 'QA', workspace: 'documents', step: 'Write Test Plan', runner: 'generator', use: 'tests',
    summary: 'Writes the Test Plan: every scenario to test.',
    does: ['Writes positive, negative and edge test cases for each issue.', 'Follows the team’s test-case rules (Administration → Generation).', 'Links each case to the acceptance criterion it proves.'],
    inputs: ['Issues and acceptance criteria'], output: 'Test cases on each issue', where: 'Epic panel → Agents, or Backlog → Write test cases',
  },
  {
    id: 'working-tickets', name: 'Working Tickets', icon: '🎫', phase: 'Plan', team: 'Product', workspace: 'documents', step: 'Create Working Tickets', runner: 'generator', use: 'tickets',
    summary: 'Splits the feature into sized working tickets.',
    does: ['Breaks the feature into stories, tasks and spikes.', 'Sizes each with story points on the team’s scale.', 'Writes user stories and acceptance criteria for each.'],
    inputs: ['Epic and its description', 'Source documents'], output: 'Issues in the backlog', where: 'Epic panel → Agents, New project, Add feature',
  },
  {
    id: 'build', name: 'Build a Ticket', icon: '🛠️', phase: 'Build', team: 'Coding', workspace: 'worktree', step: 'Build and Verify Feature', runner: 'code', writes: true, default: true,
    summary: 'Builds one working ticket: plan, code and unit tests.',
    does: ['Plans the change with a to-do list before touching code.', 'Implements the issue in its own branch and git worktree.', 'Adds or updates unit tests, runs the check command and fixes failures.', 'Checks its own diff against each acceptance criterion before it finishes.'],
    inputs: ['Issue: story, acceptance criteria, test cases', 'Team conventions', 'The repository'], output: 'A reviewed diff, then a pull request', where: 'Issue panel → Write code with AI',
    model: 'sonnet', effort: 'medium', tools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'],
    prompt: `You are the Build agent for TicketForge, a senior software engineer who implements one working ticket end to end.
Work in this order:
1. Understand: read the issue, then explore the code it touches. Find the existing patterns you will follow.
2. Plan: write a short to-do list (TodoWrite) covering each acceptance criterion and the tests.
3. Build: make the smallest complete change that satisfies every acceptance criterion.
4. Test: add or update unit tests next to the code, in the project's framework.
5. Verify: run the check command, fix failures, and re-run until it passes.
6. Self-review: read your own \`git diff\` as a reviewer would, criterion by criterion, and fix what you find.
Do all of this yourself: you have no subagents. A person can ask the Review agent for a second look afterwards.
${CODE_RULES}`,
  },
  {
    id: 'feature-tests', name: 'Feature Tests', icon: '✅', phase: 'Build', team: 'Automation', workspace: 'worktree', step: 'Build and Verify Feature', runner: 'code', writes: true,
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
    id: 'review', name: 'Review a Pull Request', icon: '🔍', phase: 'Review', team: 'Coding', workspace: 'readonly', step: null, runner: 'code', writes: false,
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
    id: 'feature-verification', name: 'Feature Verification', icon: '🔎', phase: 'Build', team: 'QA', workspace: 'documents', step: null, runner: 'generator', use: 'verify',
    summary: 'Walks you through checking the feature by hand.',
    does: ['Turns the test cases into a step-by-step manual checklist.', 'Records pass / fail and evidence for each step.', 'Can run the steps automatically in the browser where scripts exist.'],
    inputs: ['Test cases', 'The running app'], output: 'Test run results', where: 'Epic panel → Agents, or Tests → Run',
  },
  {
    id: 'review-panel', name: 'Review Panel', icon: '🤝', phase: 'Review', team: 'Coding', workspace: 'readonly', step: null, runner: 'panel', model: 'opus', effort: 'high',
    summary: 'Two to five reviewers, each through its own lens.',
    does: ['Runs three Review agents in parallel, each through its own lens: correctness, security, tests and acceptance criteria.', 'Shows their findings side by side so you can fix them in one round.'],
    inputs: ['The job’s diff'], output: 'One review per lens', where: 'Write code with AI → Review panel',
  },
  // ---------------------------------------------------------------- Coding
  {
    id: 'frontend', name: 'Frontend Developer', icon: '🖥️', phase: 'Build', team: 'Coding', workspace: 'worktree', step: 'Build and Verify Feature', runner: 'code', writes: true,
    summary: 'Builds the screens and components for a ticket.',
    does: ['Builds the UI in the project’s framework, reusing its components, styles and design tokens.', 'Handles every state: loading, empty, error, success, disabled.', 'Makes it accessible (labels, keyboard, focus, contrast) and responsive down to phone width.', 'Adds component tests and runs the check command.'],
    inputs: ['Issue and acceptance criteria', 'UX Design Spec, when written', 'The repository'], output: 'A diff to review, then a pull request', where: 'Epic panel → Agents, or Issue panel → Write code with AI',
    model: 'sonnet', effort: 'medium', tools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'],
    prompt: `You are the Frontend Developer agent for TicketForge, a senior frontend engineer with a strong eye for UI/UX.
1. Find the UI stack: framework, routing, component library, styling approach, design tokens, existing similar screens.
2. Plan the screens and components (TodoWrite), reusing existing components before creating new ones.
3. Build it: semantic HTML, every state (loading, empty, error, success, disabled), clear copy, consistent spacing
   and typography from the design system. No hard-coded colours when tokens exist.
4. Accessibility: labels for every control, keyboard operable, visible focus, sufficient contrast, ARIA only when
   native elements can't do it. Responsive down to 375px wide with no horizontal scroll.
5. Add component or UI tests in the project's framework and run the check command.
6. Self-review your \`git diff\` for each state, accessibility and responsiveness, and fix what you find.
${CODE_RULES}`,
  },
  {
    id: 'backend', name: 'Backend Developer', icon: '🗄️', phase: 'Build', team: 'Coding', workspace: 'worktree', step: 'Build and Verify Feature', runner: 'code', writes: true,
    summary: 'Builds the APIs, data and business rules for a ticket.',
    does: ['Builds endpoints, services, data models and migrations following the project’s patterns.', 'Validates input, checks permissions and handles errors explicitly.', 'Keeps changes backward compatible, or calls out what breaks.', 'Adds unit and integration tests and runs the check command.'],
    inputs: ['Issue and acceptance criteria', 'The repository'], output: 'A diff to review, then a pull request', where: 'Epic panel → Agents, or Issue panel → Write code with AI',
    model: 'sonnet', effort: 'medium', tools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'],
    prompt: `You are the Backend Developer agent for TicketForge, a senior backend engineer.
1. Find the server stack: framework, routing, data access, migrations, auth and permission checks, error handling.
2. Plan (TodoWrite): endpoints, data changes, business rules, tests.
3. Build: validate every input at the boundary, enforce authorization on every new endpoint, use parameterised
   queries, handle errors explicitly, keep APIs backward compatible (or say exactly what breaks), write migrations
   that can be rolled back.
4. Add unit and integration tests for each rule and failure path; run the check command.
5. Self-review your \`git diff\` for validation, authorization and error paths before you finish.
${CODE_RULES}`,
  },
  {
    id: 'bug-fix', name: 'Fix a Bug', icon: '🐞', phase: 'Build', team: 'Coding', workspace: 'worktree', step: 'Build and Verify Feature', runner: 'code', writes: true,
    summary: 'Reproduces a bug, finds the root cause and fixes it with a test.',
    does: ['Reproduces the bug from the issue’s steps and expected result.', 'Writes a failing test first, then finds the root cause.', 'Makes the smallest fix and checks for the same bug elsewhere.', 'Explains the cause and the fix in its summary.'],
    inputs: ['Bug issue: steps, expected and actual result', 'The repository'], output: 'A fix with a regression test', where: 'Epic panel → Agents, or Issue panel → Write code with AI',
    model: 'sonnet', effort: 'medium', tools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'],
    prompt: `You are the Fix a Bug agent for TicketForge, a senior engineer who fixes defects properly.
1. Read the bug: steps, expected and actual result. Find the code path involved.
2. Write a regression test that fails because of the bug (run it with the check command to confirm, when allowed).
3. Find the root cause, not the symptom. Explain it in one or two sentences.
4. Make the smallest fix that addresses the root cause. Search for the same mistake elsewhere and list it.
5. Run the check command; the new test must pass and nothing else may break.
Your summary must include: Root cause, Fix, Regression test, Other places with the same pattern.
${CODE_RULES}`,
  },
  // ---------------------------------------------------------------- Automation
  {
    id: 'test-automation', name: 'Test Automation', icon: '🤖', phase: 'Build', team: 'Automation', workspace: 'worktree', step: 'Build and Verify Feature', runner: 'code', writes: true,
    summary: 'Writes end-to-end browser tests in the repo for the feature.',
    does: ['Turns the issue’s test cases into end-to-end tests (Playwright, or the e2e framework the repo already uses).', 'Uses role and label locators, no fixed waits, one flow per test, test data prefixed QA.', 'Adds page objects and fixtures that other tests can reuse.', 'Sets up the e2e config and script if the repo has none, and says how to run it in CI.'],
    inputs: ['Issue test cases', 'The repository'], output: 'End-to-end tests in the diff', where: 'Epic panel → Agents, or Issue panel → Write code with AI',
    model: 'sonnet', effort: 'medium', tools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'],
    prompt: `You are the Test Automation agent for TicketForge, a QA automation engineer.
1. Find the end-to-end framework the repository uses (Playwright, Cypress, WebdriverIO…). If there is none, set up
   Playwright with a minimal config and an npm script, and explain how to install the browsers.
2. Write one end-to-end test per test case on the issue: role/label/text locators (never brittle CSS or XPath), web-first
   assertions, no fixed sleeps, one user flow per test, test data prefixed "QA", independent tests that clean up.
3. Put shared steps in page objects or fixtures, following the existing structure.
4. Only change test code, config and fixtures. If a test reveals a product bug, describe it instead of fixing it.
5. Run the check command when allowed. Summarise: tests added, how to run them locally and in CI, anything flaky.
${CODE_RULES}`,
  },
  {
    id: 'ui-review', name: 'UI/UX Review', icon: '🧐', phase: 'Review', team: 'UI/UX', workspace: 'readonly', step: null, runner: 'code', writes: false,
    summary: 'Audits the UI for usability, accessibility and consistency.',
    does: ['Reviews UI changes (or the screens an issue touches) against UX heuristics.', 'Checks accessibility: labels, keyboard, focus, contrast, semantics.', 'Checks consistency with the design system, every state, copy and responsive layout.', 'Never edits code: it returns findings with the fix for each.'],
    inputs: ['The job’s diff, or the screens for an issue', 'UX Design Spec, when written'], output: 'UI/UX findings (Markdown)', where: 'Write code with AI → UI/UX review, or as an audit on an issue',
    model: 'opus', effort: 'high', tools: ['Read', 'Glob', 'Grep', 'LS', 'TodoWrite'],
    prompt: `You are the UI/UX Review agent for TicketForge, a senior product designer who reads code. You never edit files.
Review the UI code you are given (a diff, or the screens and components an issue touches) for:
1. Usability (Nielsen's heuristics): clear feedback, visible system status, error prevention and recovery, consistent
   patterns, recognition over recall.
2. States: loading, empty, error, success, disabled and permission-denied are all handled and helpful.
3. Accessibility (WCAG 2.2 AA): labels and names, keyboard operability and order, visible focus, contrast, semantic
   elements, alt text, announcements for async changes.
4. Consistency: design-system components and tokens used instead of one-off styles; spacing and typography.
5. Copy: plain, specific, sentence case; buttons say what they do; errors say how to fix.
6. Responsive: works at 375px with no horizontal scroll; touch targets at least 24px.
Return Markdown: a one-line verdict, then findings ranked most severe first, each with file:line, the problem, who it
affects, and the concrete fix. Skip nits that don't affect users.`,
  },
  {
    id: 'free-worker', name: 'Free Worker', icon: '🤖', phase: 'General', team: 'Coding', workspace: 'worktree', step: null, runner: 'code', writes: true,
    summary: 'A Claude Code worker for a task of your own.',
    does: ['Does whatever you describe in the extra instructions, in the issue’s worktree.', 'Same rules as Build: no commits or pushes; you review the diff.'],
    inputs: ['Your instructions', 'The repository'], output: 'A diff to review', where: 'Issue panel → Write code with AI → Free Worker',
    model: 'sonnet', effort: 'medium', tools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'],
    prompt: `You are a general Claude Code worker for TicketForge. Do exactly the task you are given in this repository.
${CODE_RULES}`,
  },
  // ---------------------------------------------------------------- testing agents (Test automation)
  {
    id: 'self-healing', name: 'Self-healing Agent', icon: '🩹', phase: 'Test', team: 'Automation', workspace: 'documents', step: null, runner: 'testing', use: 'heal',
    summary: 'Repairs automated tests that broke because the page changed, not because the app is wrong.',
    does: ['When a script fails on a locator, label, wait or step order, reads the page as it was at the failure.', 'Rewrites the script with the right locators and re-runs it once.', 'Keeps the repaired script only when it passes, marks the result “Self-healed” and keeps the old script so you can revert.', 'Leaves real product bugs failing: it never changes what a test proves.'],
    inputs: ['The failed script and its error', 'The page’s URL, text and interactive elements at the failure', 'The test case and acceptance criteria'], output: 'A healed script, or the original failure', where: 'Test automation → runs (on by default)',
  },
  {
    id: 'failure-analysis', name: 'Test Failure Analysis', icon: '🧪', phase: 'Test', team: 'QA', workspace: 'documents', step: null, runner: 'testing', use: 'failures',
    summary: 'Explains every failed automated test: the likely cause, the evidence and the fix.',
    does: ['Classifies each failure: product bug, test script, test data, environment or flaky.', 'Names the failed step, expected vs actual, the evidence and who should fix it.', 'Adds the analysis to the issue’s test-run comment, notification and email.'],
    inputs: ['Error, script and test case', 'Page text and browser logs at the failure'], output: 'Failure analysis on the issue', where: 'Test automation → runs (when a test fails)',
  },
  {
    id: 'test-selection', name: 'Test Selection Agent', icon: '🎯', phase: 'Test', team: 'QA', workspace: 'documents', step: null, runner: 'testing', use: 'select',
    summary: 'Picks the tests worth running now, so a run takes minutes instead of the whole suite.',
    does: ['Reads what changed in the code since the last run, recently changed issues and recent failures.', 'Ranks the automated tests by risk and picks the ones that cover the change, within your budget.', 'Says why each test was picked and what was left out.'],
    inputs: ['Code changes (local repository)', 'Test cases with their last results', 'Recently changed issues'], output: 'A selection to run', where: 'Test automation → Smart selection',
  },
];
export const CODE_AGENT_IDS = AGENTS.filter((a) => a.runner === 'code').map((a) => a.id);

// ---------------------------------------------------------------- custom agents (Markdown with frontmatter)
// An administrator describes an agent in plain words and the AI writes its Markdown rules, or pastes / imports a .md
// file in the same format as Claude Code agent files:
//   ---
//   name: Migration Reviewer
//   description: Reviews database migrations for safety
//   runner: review            # code (edits in a worktree) · review (read-only on code) · document (writes a doc for an epic)
//   model: sonnet             # optional: opus · sonnet · haiku
//   effort: medium            # optional: low · medium · high · xhigh · max
//   icon: 🗄️                  # optional
//   ---
//   The agent's instructions in Markdown…
const CUSTOM_RUNNERS = { code: { runner: 'code', writes: true, workspace: 'worktree' }, review: { runner: 'code', writes: false, workspace: 'readonly' }, 'code-readonly': { runner: 'code', writes: false, workspace: 'readonly' }, document: { runner: 'document', writes: false, workspace: 'documents' } };
const WRITE_TOOLS = ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'];
const READ_TOOLS = ['Read', 'Glob', 'Grep', 'LS', 'TodoWrite'];
const slug = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'agent';

/** Parses an agent .md (frontmatter + body). Throws a readable error when it isn't usable. */
export function parseAgentMd(md) {
  const text = String(md || '').replace(/\r\n/g, '\n').trim();
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw Object.assign(new Error('Start the file with a frontmatter block: --- name: … description: … runner: … ---'), { status: 400 });
  const meta: any = {};
  for (const line of m[1].split('\n')) { const kv = line.match(/^\s*([a-zA-Z]+)\s*:\s*(.*?)\s*(#.*)?$/); if (kv) meta[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, ''); }
  const body = m[2].trim();
  if (!meta.name) throw Object.assign(new Error('The frontmatter needs a name.'), { status: 400 });
  if (!body || body.length < 40) throw Object.assign(new Error('Write the agent’s instructions under the frontmatter (at least a few sentences).'), { status: 400 });
  const kind = CUSTOM_RUNNERS[String(meta.runner || 'review').toLowerCase()] ? String(meta.runner || 'review').toLowerCase() : 'review';
  return { name: meta.name.slice(0, 60), description: String(meta.description || '').slice(0, 300), kind, model: MODELS.includes(meta.model) ? meta.model : '', effort: EFFORTS.includes(meta.effort) ? meta.effort : '', icon: (meta.icon || '').slice(0, 4), body: body.slice(0, 12000) };
}
/** A saved custom agent ({ id, md, enabled }) as a catalog entry. */
function customAgent(c) {
  let d;
  try { d = parseAgentMd(c.md); } catch (e) { return { id: c.id, custom: true, broken: e.message, name: c.id, icon: '⚠️', phase: 'General', team: 'Coding', runner: 'document', workspace: 'documents', summary: `Can’t be used: ${e.message}`, does: [], inputs: [], output: '', where: '', md: c.md, enabled: false }; }
  const r = CUSTOM_RUNNERS[d.kind];
  const where = r.runner === 'document' ? 'Administration → Agents → Hire (pick an epic)' : r.writes ? 'Issue panel → Write code with AI' : 'Pull requests → Review with AI, or a code job’s review';
  return {
    id: c.id, custom: true, kind: d.kind, name: d.name, icon: d.icon || (r.runner === 'document' ? '📄' : r.writes ? '🛠️' : '🔍'), phase: r.runner === 'document' ? 'Plan' : r.writes ? 'Build' : 'Review',
    team: r.runner === 'document' ? 'Delivery' : 'Coding', workspace: r.workspace, step: null, runner: r.runner, writes: r.writes,
    summary: d.description || d.name, does: d.body.split('\n').filter((l) => /^\s*[-*]\s+/.test(l)).slice(0, 4).map((l) => l.replace(/^\s*[-*]\s+/, '').slice(0, 160)),
    inputs: r.runner === 'document' ? ['The epic, its documents, issues and test results'] : ['The issue and the repository'], output: r.runner === 'document' ? 'A Markdown document on the epic' : r.writes ? 'A diff to review' : 'Findings (read-only)', where,
    model: d.model || 'sonnet', effort: d.effort || 'medium', tools: r.writes ? WRITE_TOOLS : READ_TOOLS,
    ...(r.runner === 'document' ? { docPrompt: d.body } : { prompt: `${d.body}\n${CODE_RULES}${r.writes ? '' : '\n- You are read-only: never edit files. Report findings with file:line.'}` }),
    md: c.md,
  };
}
/** Built-in and custom agents. */
async function allAgents() { const s = await getAgentSettings(); return [...AGENTS.filter((a) => !s.removed.includes(a.id)), ...(s.custom || []).map(customAgent)]; }

// ---------------------------------------------------------------- roles: which agent does each job
// Code jobs ask for a role, not a fixed agent, so the built-in agents can be removed and custom ones take over.
// An administrator picks the agent per role (Administration → Agents → Default agents); otherwise the built-in agent
// of that name when it's there, otherwise the first enabled agent of the right kind (edits code / read-only).
export const ROLES = {
  build: { label: 'Write code', writes: true, builtIn: 'build' },
  frontend: { label: 'Frontend repository', writes: true, builtIn: 'frontend', fallback: 'build' },
  backend: { label: 'Backend repository', writes: true, builtIn: 'backend', fallback: 'build' },
  review: { label: 'Review changes', writes: false, builtIn: 'review' },
};
/** The agent id for a role, or null when there's no usable agent. */
export async function agentForRole(role) {
  const r = ROLES[role] || ROLES.build;
  const s = await getAgentSettings();
  const usable: any[] = [];
  for (const a of await allAgents()) {
    if (a.runner !== 'code' || a.broken || Boolean(a.writes) !== r.writes) continue;
    if ((s.agents[a.id]?.enabled ?? true) === false) continue;
    usable.push(a.id);
  }
  const want = s.roles?.[role];
  if (want && usable.includes(want)) return want;
  if (usable.includes(r.builtIn)) return r.builtIn;
  if (r.fallback) return agentForRole(r.fallback);
  return usable.find((id) => id.startsWith('custom-')) || usable[0] || null;
}
/** Like agentForRole, but explains what to do when there's none. */
export async function requireRole(role) {
  const id = await agentForRole(role);
  if (!id) throw Object.assign(new Error(ROLES[role]?.writes === false ? 'There’s no review agent. Create one in Administration → Agents (kind: Review).' : 'There’s no agent that writes code. Create one in Administration → Agents (kind: Code).'), { status: 400 });
  return id;
}
/** A built-in agent as a custom agent's Markdown, to start a custom one from it. */
export function builtInAsMd(id) {
  const a = AGENTS.find((x) => x.id === id);
  if (!a) throw Object.assign(new Error('That built-in agent doesn’t exist.'), { status: 404 });
  const kind = a.runner === 'code' ? (a.writes ? 'code' : 'review') : 'document';
  const body = a.runner === 'code' ? String(a.prompt || '').replace(CODE_RULES, '').trim()
    : `You are the ${a.name} agent. ${a.summary}\n\n## Do\n${a.does.map((d) => `- ${d}`).join('\n')}\n\n## Output\n${a.output}`;
  return `---\nname: ${a.name}\ndescription: ${a.summary}\nrunner: ${kind}\nmodel: ${a.model || 'sonnet'}\neffort: ${a.effort || 'medium'}\nicon: ${a.icon}\n---\n${body}\n`;
}
/** Code agents people can pick (built-in + custom). */
export async function codeAgentIds() { return (await allAgents()).filter((a) => a.runner === 'code' && !a.broken).map((a) => a.id); }

/** Writes an agent's .md from a plain description, in the format above. */
export async function generateAgentMd({ description, kind = '', ai = {} }: any) {
  const md = await askAI({ ...ai, task: 'agents', reasoning: 'fast', system: `You write agent definition files for TicketForge, a ticketing and test management app whose agents run as Claude Code agents on a repository (code / review) or write a Markdown document for an epic (document).
Output ONLY the file: a frontmatter block, then the instructions in Markdown. Frontmatter keys: name (2-4 words), description (one sentence), runner (code | review | document), model (opus | sonnet | haiku: haiku for simple checks, sonnet for most, opus only for hard reasoning), icon (one emoji).
Instructions: a one-line role, then "## Do" with 4-8 specific bullet rules, "## Don't" with 2-4 bullets, and "## Output" describing exactly what it returns. Concrete, testable rules. No preamble.`,
    prompt: `Write the agent for this:\n${String(description).slice(0, 3000)}${kind ? `\nRunner: ${kind}` : ''}` });
  const fence = md.match(/```(?:markdown|md|yaml)?\s*([\s\S]*?)```/);
  const out = (fence && /^---/.test(fence[1].trim()) ? fence[1] : md).trim();
  parseAgentMd(out); // throws if the AI's file isn't usable
  return out;
}

// ---------------------------------------------------------------- administrator overrides
const KEY = 'agent_settings';
const G = globalThis;
const C: any = wsCache('__tfAgentsWs');

function clean(o: any = {}) {
  const out: any = {};
  for (const id of Object.keys(o || {})) {
    const a = AGENTS.find((x) => x.id === id) || (/^custom-[a-z0-9-]+$/.test(id) ? { id } : null);
    if (!a) continue;
    const s = o[a.id];
    if (!s || typeof s !== 'object') continue;
    const v: any = {};
    if (typeof s.enabled === 'boolean') v.enabled = s.enabled;
    if (MODELS.includes(s.model)) v.model = s.model;
    if (EFFORTS.includes(s.effort)) v.effort = s.effort;
    if (typeof s.instructions === 'string' && s.instructions.trim()) v.instructions = s.instructions.slice(0, 4000);
    if (Object.keys(v).length) out[a.id] = v;
  }
  return out;
}
export async function getAgentSettings({ fresh = false }: any = {}) {
  if (!fresh && C.v !== undefined && Date.now() - C.at < 30000) return C.v;
  let saved = null;
  try { saved = (await getMeta(wsKey(KEY))) || null; } catch { /* database not ready */ }
  if (typeof saved === 'string') { try { saved = JSON.parse(saved); } catch { saved = null; } }
  C.v = { agents: clean(saved?.agents), custom: cleanCustom(saved?.custom), removed: cleanRemoved(saved?.removed), roles: cleanRoles(saved?.roles), updatedBy: saved?.updatedBy || null, updatedAt: saved?.updatedAt || null };
  C.at = Date.now();
  return C.v;
}
const cleanRemoved = (list) => [...new Set((Array.isArray(list) ? list : []).filter((id) => AGENTS.some((a) => a.id === id)))];
const cleanRoles = (o) => Object.fromEntries(Object.entries<any>(o && typeof o === 'object' ? o : {}).filter(([k, v]) => ROLES[k] && typeof v === 'string' && /^[a-z0-9-]{1,60}$/.test(v)));
const cleanCustom = (list) => (Array.isArray(list) ? list : []).filter((c) => c && /^custom-[a-z0-9-]+$/.test(c.id) && typeof c.md === 'string').slice(0, 40).map((c) => ({ id: c.id, md: c.md.slice(0, 16000) }));
export async function saveAgentSettings(actor, agents, custom?, { removed, roles }: any = {}) {
  const cur = await getAgentSettings({ fresh: true });
  const v = { agents: clean(agents ?? cur.agents), custom: custom === undefined ? cur.custom : cleanCustom(custom), removed: removed === undefined ? cur.removed : cleanRemoved(removed),
    roles: roles === undefined ? cur.roles : cleanRoles(roles), updatedBy: actor?.name || null, updatedAt: new Date().toISOString() };
  await setMeta(wsKey(KEY), v);
  C.v = v; C.at = Date.now();
  return v;
}

/** One agent with the administrator's overrides applied. */
/** Adds or updates a custom agent from its .md; returns its id. */
export async function saveCustomAgent(actor, { id, md }: any) {
  const d = parseAgentMd(md);
  const s = await getAgentSettings({ fresh: true });
  const list = [...(s.custom || [])];
  let cid = id && list.some((c) => c.id === id) ? id : `custom-${slug(d.name)}`;
  if (!id) { let n = 2; while (list.some((c) => c.id === cid) || AGENTS.some((a) => a.id === cid)) cid = `custom-${slug(d.name)}-${n++}`; }
  const i = list.findIndex((c) => c.id === cid);
  if (i >= 0) list[i] = { id: cid, md }; else list.push({ id: cid, md });
  await saveAgentSettings(actor, s.agents, list);
  return cid;
}
export async function removeCustomAgent(actor, id) {
  const s = await getAgentSettings({ fresh: true });
  const agents = { ...s.agents }; delete agents[id];
  const roles = Object.fromEntries(Object.entries<any>(s.roles || {}).filter(([, v]) => v !== id));
  await saveAgentSettings(actor, agents, (s.custom || []).filter((c) => c.id !== id), { roles });
}

export async function resolveAgent(id) {
  const a = (await allAgents()).find((x) => x.id === id);
  if (!a) {
    const removed = AGENTS.find((x) => x.id === id);
    throw Object.assign(new Error(removed ? `The ${removed.name} agent was removed in Administration → Agents. Restore it under Built-in agents, or use one of your custom agents.` : `There’s no agent called “${id}”.`), { status: 400 });
  }
  const o = (await getAgentSettings()).agents[id] || {};
  return { ...a, enabled: !a.broken && (o.enabled ?? true), model: o.model || a.model, modelSet: Boolean(o.model), effort: o.effort || a.effort, instructions: o.instructions || '' };
}
/** The catalog for the browser: definitions plus overrides (prompts included, so admins see what each agent is told). */
export async function publicAgents() {
  const s = await getAgentSettings({ fresh: true });
  return {
    agents: [...AGENTS.filter((a) => !s.removed.includes(a.id)), ...(s.custom || []).map(customAgent)].map((a) => { const o = s.agents[a.id] || {}; return { ...a, workspaceLabel: WORKSPACES[a.workspace], enabled: !a.broken && (o.enabled ?? true), model: o.model || a.model || null, effort: o.effort || a.effort || null, instructions: o.instructions || '', defaults: { model: a.model || null, effort: a.effort || null } }; }),
    phases: PHASES, teams: TEAMS, models: MODELS, efforts: EFFORTS, updatedBy: s.updatedBy, updatedAt: s.updatedAt,
    removed: s.removed.map((id) => { const a = AGENTS.find((x) => x.id === id); return { id, name: a.name, icon: a.icon, summary: a.summary, runner: a.runner }; }),
    builtIns: AGENTS.map((a) => ({ id: a.id, name: a.name, icon: a.icon, runner: a.runner, writes: Boolean(a.writes), removed: s.removed.includes(a.id) })),
    roles: Object.fromEntries(await Promise.all(Object.keys(ROLES).map(async (k) => [k, { label: ROLES[k].label, writes: ROLES[k].writes, chosen: s.roles?.[k] || '', agent: await agentForRole(k) }]))),
  };
}

/**
 * The `--agents` JSON for Claude Code: every enabled code agent (the run picks one with `--agent`).
 * Each prompt gets the administrator's extra instructions and the project's conventions.
 */
export async function claudeAgentsJson({ notes = '', checkTool = '' }: any = {}) {
  const out: any = {};
  for (const id of await codeAgentIds()) {
    const a = await resolveAgent(id);
    if (!a.enabled) continue;
    const prompt = [a.prompt, a.instructions && `\nInstructions from your team's administrator:\n${a.instructions}`, notes && `\nTeam conventions for this repository:\n${notes}`].filter(Boolean).join('\n');
    const extra = Array.isArray(checkTool) ? checkTool : checkTool ? [checkTool] : [];
    out[id] = { description: `${a.summary} ${a.does.join(' ')}`, prompt, tools: [...a.tools.filter((t) => t !== 'Task' && t !== 'Agent'), ...extra], model: a.model };
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
