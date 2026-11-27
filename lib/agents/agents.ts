import { CODE_RULES } from './review-lenses';

/** The catalog. Order is the order shown in Administration → Agents. */
export const AGENTS = [
  {
    id: 'problem-statement',
    name: 'Problem Statement',
    icon: '📝',
    phase: 'Prepare',
    team: 'Product',
    workspace: 'documents',
    step: 'Write Problem Statement',
    runner: 'generator',
    use: 'psd',
    summary: 'Drafts the Problem Statement from the epic, its issues and the source documents.',
    does: [
      'Reads the epic, its issues and the source documents.',
      'Writes the background, the problem, who is affected and the business impact.',
      'Lists the evidence still needed and marks anything it can’t know as [To confirm].',
    ],
    inputs: ['Epic and its issues', 'Source documents'],
    output: 'Problem Statement (.docx from the team template)',
    where: 'Epic panel → Problem Statement',
  },
  {
    id: 'feature-brief',
    name: 'Feature Brief',
    icon: '📄',
    phase: 'Prepare',
    team: 'Product',
    workspace: 'documents',
    step: 'Write Feature Brief',
    runner: 'generator',
    use: 'fbd',
    summary: 'Writes the Feature Brief from the Problem Statement.',
    does: [
      'Fills every section of the team’s Feature Brief template.',
      'Turns issues into acceptance scenarios (AS-01…) with exact pass conditions.',
      'Carries the problem and evidence over from the Problem Statement.',
    ],
    inputs: ['Problem Statement', 'Epic and its issues', 'Feature Brief template'],
    output: 'Feature Brief (.md / .docx)',
    where: 'Epic panel → Feature Brief',
  },
  {
    id: 'architecture-record',
    name: 'Architecture Record',
    icon: '🏗️',
    phase: 'Plan',
    team: 'Coding',
    workspace: 'documents',
    step: 'Write Architecture Record Design',
    runner: 'generator',
    use: 'ard',
    summary: 'Writes the Architecture Record Design (ARD) from the Feature Brief.',
    does: [
      'Fills the team’s ARD template: drivers, components, data flow and detailed design.',
      'Records each decision (AD-xx) with the options considered, plus rollout and rollback levels.',
      'Traces the design to the Feature Brief: acceptance scenarios (AS-xx) and open decisions.',
    ],
    inputs: ['Feature Brief', 'Problem Statement', 'Epic and its issues', 'Repository notes'],
    output: 'Architecture Record Design (.md / .docx)',
    where: 'Epic panel → Architecture Record Design',
  },
  {
    id: 'test-plan',
    name: 'Test Plan',
    icon: '✏️',
    phase: 'Plan',
    team: 'QA',
    workspace: 'documents',
    step: 'Write Test Plan',
    runner: 'generator',
    use: 'tests',
    summary: 'Writes the Test Plan: every scenario to test.',
    does: [
      'Writes positive, negative and edge test cases for each issue.',
      'Follows the team’s test-case rules (Administration → Generation).',
      'Links each case to the acceptance criterion it proves.',
    ],
    inputs: ['Issues and acceptance criteria'],
    output: 'Test cases on each issue',
    where: 'Epic panel → Agents, or Backlog → Write test cases',
  },
  {
    id: 'working-tickets',
    name: 'Working Tickets',
    icon: '🎫',
    phase: 'Plan',
    team: 'Product',
    workspace: 'documents',
    step: 'Create Working Tickets',
    runner: 'generator',
    use: 'tickets',
    summary: 'Splits the feature into sized working tickets.',
    does: [
      'Breaks the feature into stories, tasks and spikes.',
      'Sizes each with story points on the team’s scale.',
      'Writes user stories and acceptance criteria for each.',
    ],
    inputs: ['Epic and its description', 'Source documents'],
    output: 'Issues in the backlog',
    where: 'Epic panel → Agents, New project, Add feature',
  },
  {
    id: 'build',
    name: 'Build a Ticket',
    icon: '🛠️',
    phase: 'Build',
    team: 'Coding',
    workspace: 'worktree',
    step: 'Build and Verify Feature',
    runner: 'code',
    writes: true,
    default: true,
    summary: 'Builds one working ticket: plan, code and unit tests.',
    does: [
      'Plans the change with a to-do list before touching code.',
      'Implements the issue in its own branch and git worktree.',
      'Adds or updates unit tests, runs the check command and fixes failures.',
      'Checks its own diff against each acceptance criterion before it finishes.',
    ],
    inputs: ['Issue: story, acceptance criteria, test cases', 'Team conventions', 'The repository'],
    output: 'A reviewed diff, then a pull request',
    where: 'Issue panel → Write code with AI',
    model: 'sonnet',
    effort: 'medium',
    tools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'],
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
    id: 'feature-tests',
    name: 'Feature Tests',
    icon: '✅',
    phase: 'Build',
    team: 'Automation',
    workspace: 'worktree',
    step: 'Build and Verify Feature',
    runner: 'code',
    writes: true,
    summary: 'Writes and runs the feature’s automated tests.',
    does: [
      'Turns the issue’s test cases into automated tests.',
      'Covers the happy path, failures and edge cases.',
      'Runs them with the check command and reports what passes. Only changes test code unless a test exposes a real bug.',
    ],
    inputs: ['Issue test cases', 'The repository'],
    output: 'Automated tests in the diff',
    where: 'Issue panel → Write code with AI → Feature Tests',
    model: 'sonnet',
    effort: 'medium',
    tools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'],
    prompt: `You are the Feature Tests agent for TicketForge, a test engineer who writes automated tests for one feature.
1. Find the project's test framework, helpers and conventions (look at existing tests first).
2. Write one automated test per test case on the issue, plus edge cases the acceptance criteria imply.
3. Change only test files and test fixtures. If a test exposes a real bug, describe it in your summary instead of
   changing product code, unless you were asked to fix it.
4. Run the allowed check command and make the tests pass or explain why they can't.
${CODE_RULES}`,
  },
  {
    id: 'review',
    name: 'Review a Pull Request',
    icon: '🔍',
    phase: 'Review',
    team: 'Coding',
    workspace: 'readonly',
    step: null,
    runner: 'code',
    writes: false,
    summary: 'Reviews one pull or merge request.',
    does: [
      'Reads the diff and the code around it.',
      'Checks each acceptance criterion is met.',
      'Finds bugs, missing tests, security and performance problems.',
      'Never edits code: it returns findings ranked by severity.',
    ],
    inputs: ['The job’s diff', 'Issue and acceptance criteria'],
    output: 'Review findings (Markdown)',
    where: 'Write code with AI → Review changes',
    model: 'opus',
    effort: 'high',
    tools: ['Read', 'Glob', 'Grep', 'LS'],
    prompt: `You are the Review agent for TicketForge, a careful senior reviewer. You review the uncommitted changes in
this worktree (staged with git add) against the issue. You never edit files.
Check, in order: correctness and edge cases; every acceptance criterion is met; tests exist and test the right thing;
security (injection, auth, secrets, unsafe input); performance; consistency with the codebase's patterns.
Return Markdown: a one-line verdict (Approve / Request changes), then findings ranked most severe first, each with
file:line, what is wrong, a concrete failure scenario, and the fix. Skip style nits. If there is nothing material,
say so plainly.`,
  },
  {
    id: 'feature-verification',
    name: 'Feature Verification',
    icon: '🔎',
    phase: 'Build',
    team: 'QA',
    workspace: 'documents',
    step: null,
    runner: 'generator',
    use: 'verify',
    summary: 'Walks you through checking the feature by hand.',
    does: [
      'Turns the test cases into a step-by-step manual checklist.',
      'Records pass / fail and evidence for each step.',
      'Can run the steps automatically in the browser where scripts exist.',
    ],
    inputs: ['Test cases', 'The running app'],
    output: 'Test run results',
    where: 'Epic panel → Agents, or Tests → Run',
  },
  {
    id: 'review-panel',
    name: 'Review Panel',
    icon: '🤝',
    phase: 'Review',
    team: 'Coding',
    workspace: 'readonly',
    step: null,
    runner: 'panel',
    model: 'opus',
    effort: 'high',
    summary: 'Two to five reviewers, each through its own lens.',
    does: [
      'Runs three Review agents in parallel, each through its own lens: correctness, security, tests and acceptance criteria.',
      'Shows their findings side by side so you can fix them in one round.',
    ],
    inputs: ['The job’s diff'],
    output: 'One review per lens',
    where: 'Write code with AI → Review panel',
  },
  // ---------------------------------------------------------------- Coding
  {
    id: 'frontend',
    name: 'Frontend Developer',
    icon: '🖥️',
    phase: 'Build',
    team: 'Coding',
    workspace: 'worktree',
    step: 'Build and Verify Feature',
    runner: 'code',
    writes: true,
    summary: 'Builds the screens and components for a ticket.',
    does: [
      'Builds the UI in the project’s framework, reusing its components, styles and design tokens.',
      'Handles every state: loading, empty, error, success, disabled.',
      'Makes it accessible (labels, keyboard, focus, contrast) and responsive down to phone width.',
      'Adds component tests and runs the check command.',
    ],
    inputs: ['Issue and acceptance criteria', 'UX Design Spec, when written', 'The repository'],
    output: 'A diff to review, then a pull request',
    where: 'Epic panel → Agents, or Issue panel → Write code with AI',
    model: 'sonnet',
    effort: 'medium',
    tools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'],
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
    id: 'backend',
    name: 'Backend Developer',
    icon: '🗄️',
    phase: 'Build',
    team: 'Coding',
    workspace: 'worktree',
    step: 'Build and Verify Feature',
    runner: 'code',
    writes: true,
    summary: 'Builds the APIs, data and business rules for a ticket.',
    does: [
      'Builds endpoints, services, data models and migrations following the project’s patterns.',
      'Validates input, checks permissions and handles errors explicitly.',
      'Keeps changes backward compatible, or calls out what breaks.',
      'Adds unit and integration tests and runs the check command.',
    ],
    inputs: ['Issue and acceptance criteria', 'The repository'],
    output: 'A diff to review, then a pull request',
    where: 'Epic panel → Agents, or Issue panel → Write code with AI',
    model: 'sonnet',
    effort: 'medium',
    tools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'],
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
    id: 'bug-fix',
    name: 'Fix a Bug',
    icon: '🐞',
    phase: 'Build',
    team: 'Coding',
    workspace: 'worktree',
    step: 'Build and Verify Feature',
    runner: 'code',
    writes: true,
    summary: 'Reproduces a bug, finds the root cause and fixes it with a test.',
    does: [
      'Reproduces the bug from the issue’s steps and expected result.',
      'Writes a failing test first, then finds the root cause.',
      'Makes the smallest fix and checks for the same bug elsewhere.',
      'Explains the cause and the fix in its summary.',
    ],
    inputs: ['Bug issue: steps, expected and actual result', 'The repository'],
    output: 'A fix with a regression test',
    where: 'Epic panel → Agents, or Issue panel → Write code with AI',
    model: 'sonnet',
    effort: 'medium',
    tools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'],
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
    id: 'test-automation',
    name: 'Test Automation',
    icon: '🤖',
    phase: 'Build',
    team: 'Automation',
    workspace: 'worktree',
    step: 'Build and Verify Feature',
    runner: 'code',
    writes: true,
    summary: 'Writes end-to-end browser tests in the repo for the feature.',
    does: [
      'Turns the issue’s test cases into end-to-end tests (Playwright, or the e2e framework the repo already uses).',
      'Uses role and label locators, no fixed waits, one flow per test, test data prefixed QA.',
      'Adds page objects and fixtures that other tests can reuse.',
      'Sets up the e2e config and script if the repo has none, and says how to run it in CI.',
    ],
    inputs: ['Issue test cases', 'The repository'],
    output: 'End-to-end tests in the diff',
    where: 'Epic panel → Agents, or Issue panel → Write code with AI',
    model: 'sonnet',
    effort: 'medium',
    tools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'],
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
    id: 'ui-review',
    name: 'UI/UX Review',
    icon: '🧐',
    phase: 'Review',
    team: 'UI/UX',
    workspace: 'readonly',
    step: null,
    runner: 'code',
    writes: false,
    summary: 'Audits the UI for usability, accessibility and consistency.',
    does: [
      'Reviews UI changes (or the screens an issue touches) against UX heuristics.',
      'Checks accessibility: labels, keyboard, focus, contrast, semantics.',
      'Checks consistency with the design system, every state, copy and responsive layout.',
      'Never edits code: it returns findings with the fix for each.',
    ],
    inputs: ['The job’s diff, or the screens for an issue', 'UX Design Spec, when written'],
    output: 'UI/UX findings (Markdown)',
    where: 'Write code with AI → UI/UX review, or as an audit on an issue',
    model: 'opus',
    effort: 'high',
    tools: ['Read', 'Glob', 'Grep', 'LS', 'TodoWrite'],
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
    id: 'free-worker',
    name: 'Free Worker',
    icon: '🤖',
    phase: 'General',
    team: 'Coding',
    workspace: 'worktree',
    step: null,
    runner: 'code',
    writes: true,
    summary: 'A Claude Code worker for a task of your own.',
    does: [
      'Does whatever you describe in the extra instructions, in the issue’s worktree.',
      'Same rules as Build: no commits or pushes; you review the diff.',
    ],
    inputs: ['Your instructions', 'The repository'],
    output: 'A diff to review',
    where: 'Issue panel → Write code with AI → Free Worker',
    model: 'sonnet',
    effort: 'medium',
    tools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'],
    prompt: `You are a general Claude Code worker for TicketForge. Do exactly the task you are given in this repository.
${CODE_RULES}`,
  },
  // ---------------------------------------------------------------- testing agents (Test
  // automation)
  {
    id: 'self-healing',
    name: 'Self-healing Agent',
    icon: '🩹',
    phase: 'Test',
    team: 'Automation',
    workspace: 'documents',
    step: null,
    runner: 'testing',
    use: 'heal',
    summary:
      'Repairs automated tests that broke because the page changed, not because the app is wrong.',
    does: [
      'When a script fails on a locator, label, wait or step order, reads the page as it was at the failure.',
      'Rewrites the script with the right locators and re-runs it once.',
      'Keeps the repaired script only when it passes, marks the result “Self-healed” and keeps the old script so you can revert.',
      'Leaves real product bugs failing: it never changes what a test proves.',
    ],
    inputs: [
      'The failed script and its error',
      'The page’s URL, text and interactive elements at the failure',
      'The test case and acceptance criteria',
    ],
    output: 'A healed script, or the original failure',
    where: 'Test automation → runs (on by default)',
  },
  {
    id: 'failure-analysis',
    name: 'Test Failure Analysis',
    icon: '🧪',
    phase: 'Test',
    team: 'QA',
    workspace: 'documents',
    step: null,
    runner: 'testing',
    use: 'failures',
    summary: 'Explains every failed automated test: the likely cause, the evidence and the fix.',
    does: [
      'Classifies each failure: product bug, test script, test data, environment or flaky.',
      'Names the failed step, expected vs actual, the evidence and who should fix it.',
      'Adds the analysis to the issue’s test-run comment, notification and email.',
    ],
    inputs: ['Error, script and test case', 'Page text and browser logs at the failure'],
    output: 'Failure analysis on the issue',
    where: 'Test automation → runs (when a test fails)',
  },
  {
    id: 'test-selection',
    name: 'Test Selection Agent',
    icon: '🎯',
    phase: 'Test',
    team: 'QA',
    workspace: 'documents',
    step: null,
    runner: 'testing',
    use: 'select',
    summary:
      'Picks the tests worth running now, so a run takes minutes instead of the whole suite.',
    does: [
      'Reads what changed in the code since the last run, recently changed issues and recent failures.',
      'Ranks the automated tests by risk and picks the ones that cover the change, within your budget.',
      'Says why each test was picked and what was left out.',
    ],
    inputs: [
      'Code changes (local repository)',
      'Test cases with their last results',
      'Recently changed issues',
    ],
    output: 'A selection to run',
    where: 'Test automation → Smart selection',
  },
];
