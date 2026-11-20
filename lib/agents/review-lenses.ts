export const PHASES = ['Prepare', 'Plan', 'Build', 'Review', 'Test', 'General'];
export const TEAMS = ['Product', 'Coding', 'Automation', 'UI/UX', 'QA', 'Delivery'];
/** Lenses for the Review Panel: each one is a Review agent told to look only through it. */
export const REVIEW_LENSES = [
  {
    id: 'correctness',
    name: 'Correctness',
    focus: 'logic errors, edge cases, error handling, data integrity and regressions',
  },
  {
    id: 'security',
    name: 'Security',
    focus:
      'injection, authentication and authorization, secrets, unsafe input and output, dependency risk',
  },
  {
    id: 'tests',
    name: 'Tests & acceptance',
    focus:
      'whether every acceptance criterion is met and proven by a test, and whether the tests would catch a broken implementation',
  },
];
export const WORKSPACES = {
  documents: 'Documents',
  worktree: 'Own git worktree',
  readonly: 'Repo, read-only',
};
export const MODELS = ['opus', 'sonnet', 'haiku'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Rules every code agent follows, whatever its role.
export const CODE_RULES = `
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
