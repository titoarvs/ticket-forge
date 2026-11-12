# Test management: parity with Xray and BrowserStack Test Management

TicketForge's **Test management** (project sidebar → Quality) follows the model of **Xray for Jira**:
- reusable tests that cover requirements;
- test plans and test executions;
- coverage per issue.

It also borrows BrowserStack Test Management's import/export and its automation-to-test-management loop. This page lists what matches, what differs, and what's not built yet.

## Concepts

| Xray | BrowserStack TM | TicketForge |
|---|---|---|
| Test (issue type) | Test case | **Test** (`PROJ-T12`) in the Test repository |
| Test Repository (folders) | Folders | **Test repository**: Folders view or Epics view (epic → issues, derived from coverage) |
| Precondition | Preconditions field | **Preconditions** on each test |
| Test Plan | Test plan | **Test plan**: a set of tests, optional epic/sprint, progress |
| Test Execution / Test Run | Test run | **Test execution**: a run of tests, with a result per test and per step |
| Test Environment | Configuration | **Test environment** on each execution, with status per environment in Coverage |
| Requirement coverage (OK / NOK / Not run / Uncovered) | Requirement traceability | **Coverage** tab and **Tests** section on every issue |
| Defect from a run | Create a Jira bug from a run | **Create defect**: a Bug with the steps and failure, linked to the run and covered issues |

## Features

| Capability | Xray | BrowserStack TM | TicketForge |
|---|---|---|---|
| Manual tests with steps (action / data / expected) | ✓ | ✓ | ✓ |
| BDD / Gherkin tests | ✓ Cucumber | ✓ BDD template | ✓ **Cucumber** type with a Gherkin scenario |
| Generic / automated tests | ✓ | ✓ | ✓ Automated type |
| Folders | ✓ | ✓ | ✓ plus an **Epics view** |
| Link a test to many requirements | ✓ | ✓ | ✓ |
| Step-by-step execution, comments, evidence | ✓ | ✓ | ✓ (comment / evidence text; screenshots from automation runs) |
| Assignee per test run, bulk updates | ✓ | ✓ | ✓ |
| Status per test environment | ✓ | ✓ configurations | ✓ |
| Defects from failed runs | ✓ | ✓ | ✓ |
| Import automation results (JUnit XML) | ✓ | ✓ | ✓ **Import JUnit XML** in an execution (matches by test key in the name, then by title) |
| Automation feeding test management | REST API | Automate → TM | ✓ TicketForge's Playwright runs land in a daily **Automated runs — date** execution per environment |
| CSV import / export | ✓ | ✓ (also TestRail, Xray) | ✓ one row per step, with Xray / BrowserStack / TestRail column names recognised |
| Traceability report | ✓ | ✓ | ✓ CSV: issue → test → latest run → environment → defects |
| AI-built test plans | — | AI test generation | ✓ **Build plan with AI** (smoke, regression, epic, sprint, retest, custom), plus gaps |
| AI-written tests from code / requirements | — | ✓ | ✓ **Write tests with AI** for issues, **Improve with AI** on any test, and test cases from page code (Repository sync) |
| Company test standard enforced on AI output | — | — | ✓ Administration → Generation → **Test management**: start from ISTQB, Xray, BDD or BrowserStack, then edit format, title pattern, steps, data, priority rule, labels and plan rules |

| Test review workflow (Draft → Ready for review → Approved, Needs update, Deprecated) | ✓ (with Xray workflows) | ✓ test case states and review | ✓ **Reviews** tab with an approval queue, reviewer comments, optional **four-eyes** rule |
| Test versioning, runs tied to a version | ✓ | ✓ | ✓ editing an Approved test makes a new version (old ones kept, viewable, restorable); executions record the version run |
| Only approved tests in plans and executions | ✓ (configurable) | ✓ | ✓ Test management → **Workflow** → “Only Approved tests” |
| Self-healing automated tests | — | ✓ Self-healing agent | ✓ **Self-healing Agent**: repairs scripts broken by page changes, re-runs, keeps the fix only if it passes; never heals app bugs |
| AI failure analysis | — | ✓ Test Failure Analysis | ✓ **Test Failure Analysis** agent on every failed run |
| Smart test selection | — | ✓ Test Selection agent | ✓ **Smart selection**: tests worth running for the code changes, within a budget |

## Not built yet

| Capability | In | Notes |
|---|---|---|
| Test Sets (reusable groups separate from plans) | Xray | Plans and folders cover most uses today. |
| Parameterised tests / datasets | Xray | Steps take a Data column; there's no iteration matrix yet. |
| Shared / called tests (one test calling another) | Xray, BrowserStack | |
| Custom fields and templates on tests | BrowserStack | |
| File attachments as evidence (uploads) | both | Evidence is text or links today; automation screenshots are kept per run. |
| Dashboards and gadgets (burn-down, run trends) | both | Plan and execution progress bars, plus the Coverage tab. |
| Public REST API for CI to post results | both | Use **Import JUnit XML** for now. |
