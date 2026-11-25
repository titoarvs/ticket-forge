# Testing

Test automation with Playwright, and test management. Back to the [documentation index](../README.md).

## On this page

- [Test automation](#test-automation)
- [Test automation: repository sync and run settings](#test-automation-repository-sync-and-run-settings)
- [Test management (Xray-style)](#test-management-xray-style)
- [Test management: review workflow](#test-management-review-workflow)
- [AI failure analysis on automated tests](#ai-failure-analysis-on-automated-tests)
- [AI testing agents (Administration → Agents → Test)](#ai-testing-agents-administration--agents--test)

## Test automation

1. Open **Test automation** and enter the **Application URL** of the app under test (for example
   `http://localhost:3000` or a staging URL).
2. Pick which tests to run (all, never run, failed, active sprint, or one epic) and press **Run**. You can also
   run one test (▶ on a test case), all tests of an issue (**Run tests** in the issue panel), selected issues
   from the backlog, or the filtered list on the Test cases page.
3. For each test case without a script, the app opens the URL in a headless Chromium to take a snapshot of the
   page, and Claude writes a Playwright script from the test steps, expected result, the issue's acceptance
   criteria and that snapshot. Each script then runs in its own process with a time limit.
4. Results (pass/fail, duration, error, browser console and a screenshot) are saved on each test case, set its
   result, and appear in the issue's history and in the exports.

Scripts are stored with the test case: open **View** (or the *Automation script* section of a test case) to read
or edit one, or **Rewrite with Claude** to regenerate it. Scripts run on this machine with your user's
permissions, so only point automation at apps you trust, and review scripts you did not write.

### Results, failures and screenshots

The Test automation page has four tabs:
- **Results:** run tests and see the latest result of each.
- **Failures:** every failing test with a screenshot of the page when it failed, the error, Run again, and earlier
  failures.
- **App setup:** pages, roles, login and source code.
- **Settings:** application URL, test browser, what happens when a test fails.

Screenshots of **failed** tests are stored in the database (Supabase) as small JPEGs, in a `screenshots` table
under the same row-level security as issues, so only people with access to the project can open them. The last 5
per test case are kept; passing runs store nothing, and deleting a project deletes its screenshots.

**Test-run comments.** After a run, each issue gets one automated comment with its results: a PASSED or FAILED
badge, "2 of 3 tests failed", a pass/fail bar, time, who ran it and on which host, then each test (failures
first) with the first line of its error, **Details** for the full error and the screenshot, and **Re-run failed**.
The assignee is mentioned and notified (in-app and email) only when something failed. Settings → *When a test
fails* and *When all of an issue's tests pass* turn the comments and notifications on or off. Automated comments
can't be edited or changed by anyone, including through the API.

### Test browser

Tests run in the first browser available:
1. a **remote browser** an administrator connected in Test automation → Settings → Remote browser (for example
   [Browserless](https://www.browserless.io), or another machine running `npx playwright run-server`). Use the
   Playwright address (`wss://…/playwright?token=…`) or a Chrome DevTools one. It's tested before it's saved, stored
   encrypted and never shown again; `TICKETFORGE_BROWSER_WS` (and `TICKETFORGE_BROWSER_PROTOCOL=cdp`) set it from
   the environment instead. This is the way to run tests on **serverless hosting such as Vercel**, which can't run a
   browser itself;
2. Playwright's own Chromium (**Install Chromium** on the same page);
3. **Google Chrome or Microsoft Edge** already installed on the computer.

On serverless hosting the tests run inside the request (no separate process) and a run can take up to 5
minutes, so run a few issues at a time there. Failure screenshots are stored in the database as usual.

### GitHub Actions

Tests can run on **GitHub Actions** instead of this server (Test automation → Settings → GitHub Actions): no browser
is needed where TicketForge runs, so it works on Vercel without Browserless. Free for public repositories and within
your plan's Actions minutes for private ones.

1. Enter a repository (`owner/name`) and press **Set up**. TicketForge creates a random run key, saves it encrypted,
   stores it in the repository as the `TICKETFORGE_RUN_KEY` Actions secret, and opens a pull request adding
   `.github/workflows/ticketforge-tests.yml` and `.github/ticketforge/` (the same runner TicketForge uses locally).
2. Merge the pull request (GitHub only starts workflows that are on the default branch), press **Check**, and turn on
   **Run tests on GitHub Actions**.

Each run sends the scripts, App setup and test passwords **encrypted** with the run key (AES-256-GCM) as a
workflow input; the workflow runs them in Playwright's container (with the run settings and retries) and uploads the
results, also encrypted, as an artifact kept for one day. TicketForge downloads them and records them like any
run: results, failure screenshots, comments and notifications. A run takes about a minute to start. On serverless
hosting a request lasts at most 5 minutes; a longer run keeps going on GitHub and its results are collected
automatically (or with **Collect results**). Self-healing isn't applied to GitHub Actions runs. Big batches are split
into several runs to fit GitHub's input size limit.

It uses the project's GitHub token (Project settings → Code & GitHub), `GITHUB_TOKEN`, or the `gh` sign-in on the
computer. The token needs Actions, Contents, Pull requests, Secrets and Workflows (read and write) on the repository.
For GitHub Enterprise Server set `TICKETFORGE_GITHUB_API` (e.g. `https://github.example.com/api/v3`). Run **Set up**
again after updating TicketForge to update the runner (it opens a new pull request).

The Settings tab and each run say which browser is in use. Writing scripts uses your Claude account when it
works, and the AI APIs connected in Administration → AI when it isn't installed, isn't signed in, its sign-in
expired, or it hit its usage limit (Administration → AI, on by default).

**AI connection** (the pill in the top bar): when the AI is inactive (not set up, not signed in, or on a backup
because the main one is limited), a refresh icon appears next to it. The dialog shows when it was last checked and
has **Refresh**, which checks again right away (the Claude sign-in and the AI settings, skipping the caches);
administrators also get **Try the main AI again**, which clears the usage-limit pause.

### App setup: pages, roles and logins

Under **Test automation → App setup**, describe the app under test once per project:

- **Pages:** a name, path and short description for each page. **Discover pages** finds them by following the
  app's links, optionally signed in as a role. It only follows links: it never clicks buttons or submits
  forms, and skips logout and delete links.
- **Roles & logins:** one row per kind of user (Admin, Cashier…) with a test account's username and password.
  **Test login** signs in and shows where it landed, with a screenshot.
- **Source code:** connect the web app's code (a GitHub repository, or a folder when TicketForge runs on
  your own computer), and **Scan routes** turns its page routes into pages, dynamic ones included
  (`/orders/:id`). Supported: Next.js (app and pages), SvelteKit, Nuxt, Remix / React Router framework mode,
  Astro, React Router, Vue Router, Angular, Laravel, Django and Rails. Rescans show new routes and pages that
  left the code, and the Test automation page checks for changes when you open it. Private repositories need
  the `gh` CLI signed in on the server, or a GitHub token saved for the project (stored encrypted).
- **Login form:** found automatically. Without a login page set, TicketForge looks for a page with a password
  field: login-looking pages from the App setup first (a code scan lists them, e.g. `/sign-in/manual`), then
  `/login`, `/sign-in`, `/signin`, `/sign-in/manual`, `/auth/login` and other usual addresses. It waits for forms
  that appear after the page loads, and clicks the submit button of the password's own form (not "Sign in with
  Google"). **Find login form** shows what it found (page, fields, button, screenshot) without typing anything,
  and sets that page with one click. You can still set the login page, field labels, button text or a "signed
  in when" check yourself.
- **Notes for the AI:** test data and conventions, for example "use the product Test Mug".

Each test case has a **Run as** role. Scripts read like this:

```js
await app.loginAs('Cashier');
await app.goto('Orders');
await expect(page).toHaveURL(new RegExp(app.url('Orders')));
```

Dynamic routes take values: `await app.goto('Orders (id)', { id: 1001 })`. `app.credentials('Role')` returns `{ username, password }` for tests of the login form itself.

How passwords are protected:
- They're stored encrypted on the server, separately from the project, so they never appear in the
  project data, exports, the browser or the AI prompts.
- They're masked in errors and logs.
- They're only used with the project's saved application URL. A run against another address can't sign in.

## Test automation: repository sync and run settings

**Find built features** (Test automation → App setup → Repository) reads every page, the repository's `.md` documents (feature notes, change records, release notes, READMEs) and the git history.
- It organizes everything already built into **epics**: existing ones where they fit, new ones otherwise. Each feature is a **Done** issue with a user story, a description of what exists, acceptance criteria and its sources.
- Folder names like `docs/features/done/<area>/` guide the grouping.
- Epics are broad product areas (usually 4–10), each holding at least 3 features. Smaller ones are folded into the closest area.
- Each feature is split into small tickets: one testable behaviour each, 1–3 story points, sized on your team's point scale. Existing issues stay as they are; they're moved into their epic and sized if they have no points.
- Existing issues are reused: marked Done when they aren't, and moved into their epic when they have none.
- Everything is shown for review first.

- **Sync with the repository** (Test automation → App setup). TicketForge must be running on your computer for this. It reads the project's local repository (Project settings → Code & GitHub):
  - It finds the app's pages from its routes. TanStack Router is supported, alongside Next.js, Remix, React Router and the others.
  - It works out which pages changed since the last sync: commits, uncommitted edits and new files. The first sync looks at the last 30 commits.
  - The AI updates the test cases those changes affect and adds test cases for new behaviour. Updated cases lose their old script, so the next run writes a fresh one.
  - It reads the git history: issues it shows were delivered are marked Done, and delivered features with no issue are added to the backlog as Done, labelled `delivered`.

  Everything comes back as a review, and only what you tick is applied.
- **Run settings** (Test automation → Settings):
  - retries, with tests that pass only on a retry marked *flaky*;
  - time limits per test, per action, per page load and per check;
  - screen size (desktop, laptop, tablet, phone);
  - locale and time zone, and whether self-signed HTTPS certificates are accepted;
  - reduced motion.

  Failed network requests and 5xx responses appear in each test's log.

### Signing in: login form, SSO, MFA and saved sessions

Each role in Test automation → App setup → Roles & logins has a **Sign-in** method. Scripts always call `await app.loginAs('Role')`.

- **Login form:** fills the app's own form.
- **Single sign-on (SSO):** clicks the app's SSO button ("Continue with Google", "Sign in with Microsoft"…). It then fills the identity provider's pages with the role's username and password: Microsoft Entra, Google, Okta, Auth0, Keycloak or a generic page. It handles account pickers, "Stay signed in?" and pop-up windows.
- **Saved session:** "Sign in in a browser" opens a real Chrome or Edge window on your computer. You sign in by hand, any way the app allows, and the cookies and local storage are saved encrypted for the role. Use this when a provider blocks automated browsers (Google often does), or for passkeys and push approvals. When the session expires, the run tells you to save a new one.
- **MFA:** save the role's authenticator secret (the text under the QR code, or the `otpauth://` link). Form and SSO sign-ins then fill the 6-digit code automatically. `app.mfaCode('Role')` returns it for tests of the MFA step itself.

Passwords, MFA secrets and sessions are only used with the project's saved application URL.

## Test management (Xray-style)

**Test management** in the project sidebar:
- **Test repository:** reusable tests (keys like `T2-T7`) in folders. Each has a type, priority, labels, preconditions and numbered steps (action, data, expected result), and covers any number of issues. **Import from issues** turns the test cases issues already have into repository tests, linked to their issue, with one folder per epic.
- **Test plans:** sets of tests for an epic, sprint or release, with a progress bar of their latest results. **Save and run** starts an execution.
- **Test executions:** run tests step by step (✓ passed, ✗ failed, ⦸ blocked). The test's result follows its steps. Each test also takes a comment or evidence, and **Create defect** opens a Bug with the steps and failure, linked to the run and to the covered issues.
- **Coverage:** each issue is OK (all its tests pass), NOK (one fails or is blocked), Not run, or Uncovered.

Every issue's panel has a **Tests** section: link a test, create one, see each test's latest result, and the issue's coverage.

Test management follows Xray for Jira and BrowserStack Test Management. It also has:
- test environments, with coverage per environment;
- an assignee per test run, and bulk updates;
- BDD (Gherkin) tests;
- JUnit XML results import;
- TicketForge's own Playwright results feeding an "Automated runs" execution;
- CSV import and export;
- a traceability report.

See [docs/test-management-parity.md](../test-management-parity.md) for the full comparison, including what isn't built yet.

**AI in Test management** follows the company's test standard, set in Administration → Generation → **Test management**:
- Pick a corporate standard to start from (ISTQB, Xray for Jira, BDD (Cucumber) or BrowserStack TM), then change any rule:
  - format (steps, Gherkin or both) and title pattern;
  - number of steps, an expected result per step, the test-data column and preconditions;
  - Gherkin style, tests per issue, priority rule, allowed labels and test plan rules;
  - your own company standard, as free text.
- **Write tests with AI** writes repository tests for chosen issues, for review before they're added.
- **Improve with AI** in the test editor rewrites a test to the standard (or as asked, e.g. "convert to Gherkin").
- **Build plan with AI** follows the plan rules.

## Test management: review workflow

- Tests go **Draft → Ready for review → Approved**, with **Needs update** and **Deprecated**. The **Reviews** tab is the approval queue.
- Editing an Approved test creates a new **version**. Earlier versions are kept and can be restored, and executions record which version ran.
- Test management → **Workflow** has two rules: "Only Approved tests in plans and executions", and four-eyes approval (the last editor can't approve).

## AI failure analysis on automated tests

When automated tests fail, the test-run comment on the issue includes an AI analysis of each failure, using the **Light** tier. It covers:
- a category (product bug, test script, test data, environment or flaky), a confidence and an owner;
- expected and actual results, the likely cause, the evidence, a fix and next steps;
- for script problems, corrected script lines.

The analysis works from the error, the script, the test case, the issue's acceptance criteria, the page the test ended on and the browser logs.

The same analysis goes into the assignee's notification and email. From the comment you can copy it as a bug report, or rewrite the script and re-run. Turn it off in Test automation → Settings → "When a test fails". The code is in `lib/failures.ts`.

## AI testing agents (Administration → Agents → Test)

- **Self-healing Agent:** when an automated test fails because the page changed (renamed button, moved field, an extra step), it reads the page as it was at the failure and rewrites the script. It then re-runs it once and keeps the repaired script only if it passes. The result is marked **Self-healed**, and the old script can be reverted from the script dialog. Real app bugs are left failing: it never loosens an assertion. Turn it off per project in Test automation → Settings.
- **Test Failure Analysis:** the AI note on every failed test (cause, evidence, fix).
- **Test Selection Agent:** Test automation → **🎯 Smart selection**. It picks the tests worth running from code changes since the last run, recently changed issues and recent failures, within your budget, and gives a reason for each.

Each one can be turned off in Administration → Agents.
