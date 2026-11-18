# Ticket Forge: Problem Statement

> **Source and status.** This document follows Ticket Forge's own Problem Statement (PSD) structure (`lib/psd.ts`). It is based on the README, the overview document (TF-115, TF-116) and the scrum pain points document (TF-117). It describes the problem, not the design. It contains no measured data from any named team. Each claim that still needs proof is marked *[To validate: …]* and listed in Part 8. Status: **Draft**.

## 1. At a Glance

| Item | Summary |
|---|---|
| **The problem** | Turning a requirements document into a backlog the team can build and test is slow manual work, and it goes wrong often. The meaning of the requirement gets lost at each handoff between the Product Owner, the developer and QA. |
| **Why it matters** | Sprints start with tickets that are not ready, "done" means different things to different people, and defects are found late, when they cost the most to fix. |
| **Who is affected** | Product Owners, Scrum Masters, Developers, QA testers, and the business that pays for each sprint. |
| **What is proposed** | One workspace that turns a requirements document into connected epics, tickets, acceptance criteria, test cases and project documents, and keeps them linked from the first draft to delivery. |

**What is a "ready" ticket?** A ticket the team can start without asking anyone a question. It has a clear user story, testable acceptance criteria and test cases, and it can be traced back to the requirement it came from.

## 2. Background and Current Situation

Requirements reach a scrum team as a PRD, a BRD, a feature brief, meeting notes or an email thread. Before anyone can write code, someone has to break the requirement into epics and tickets, write acceptance criteria, write test cases, write the documents the project needs (problem statement, feature brief, architecture), and then keep all of it up to date while the sprint is running.

Today this is mostly done by hand, spread over several tools:

- The Product Owner reads the document and re-types it as epics and tickets in the tracker, usually alone and under time pressure.
- Acceptance criteria are written late, often during refinement or after development has started, and each author writes them differently.
- QA writes test cases from tickets that are still changing, in a separate sheet or tool, and falls behind the developers.
- Project documents are written last, if at all, and are out of date by the next sprint.
- Ticket status, pull requests and test results live in different places, so the board rarely shows the real state of the work.

## 3. Problem Statement

There is no single, reliable path from **"here is what we need"** to **"here is a tested, delivered feature"**. Each step from requirement to ticket, ticket to acceptance criteria, criteria to test case, and code to status is a manual rewrite by a different person in a different tool. Every rewrite loses part of the original intent, and nothing connects the pieces afterwards. Because of this, teams start sprints without enough ready work, build against criteria that can be read more than one way, test late, and cannot show what changed or why.

### Why the link between requirement and delivery breaks today

| Gap | What it means | Examples |
|---|---|---|
| **Manual translation** | A person rewrites the requirement into tickets, and details are dropped or misread without anyone noticing. | **Backlog:** a 30-page PRD becomes 12 tickets, and two business rules from the appendix are missing. *[To validate: typical document size and ticket count.]* |
| **Inconsistent "done"** | Acceptance criteria are missing, vague or written in different styles, so Dev and QA read them differently. | **Ticket:** "User can export the report" with no format, limits or error case. **Review:** the feature is rejected at demo because the PO expected PDF and the developer built CSV. |
| **Testing starts late** | Test cases are written after the code, by hand, from tickets that keep changing. | **QA:** test cases for sprint 3 are still being written in sprint 4. **Dev:** bug reports arrive without screenshots or steps to reproduce. |
| **Documents fall behind** | Problem statements, feature briefs and architecture documents are written late or not at all. | **Onboarding:** a new developer learns the feature from Slack history. **Audit:** nobody can show the reasoning behind a scope decision. |
| **No traceability** | Requirements, tickets, tests, code and status are not linked, so changes cannot be followed. | **Mid-sprint change:** a ticket is edited and nobody can show what it said before. **Board:** a ticket says "In progress" although its pull request was merged two days ago. |

## 4. Who Is Affected

| Who | Relationship to Ticket Forge | How they are affected |
|---|---|---|
| **Product Owner** | Owns the requirements and the backlog. | Spends a large part of each week writing and rewriting tickets instead of talking to customers and setting priorities. *[To validate: hours per week spent on backlog writing.]* |
| **Scrum Master** | Runs refinement, planning and the sprint. | Refinement turns into writing sessions, sprints start with too few ready tickets, and status has to be chased person by person. |
| **Developer** | Builds the tickets. | Stops work to ask what a ticket means, builds against unclear criteria, and updates ticket status and pull request details by hand. |
| **QA tester** | Writes and runs the tests. | Writes test cases from changing tickets, repeats the same manual checks every sprint, and collects proof of failures by hand. |
| **Business owner / client** | Pays for the sprints and waits for the feature. | Gets features later than planned, pays for rework, and cannot see clearly how far the work has progressed. |

## 5. Impact on the Business

| Pain point | What happens today | Consequence for the business |
|---|---|---|
| Slow backlog creation | Turning a requirements document into a ready backlog takes days of PO time. *[To validate: days per project.]* | Development starts late, and the team's first sprint is partly idle or works on unready tickets. |
| Rework from misunderstood requirements | Features are built to the wrong reading of a ticket and rejected at review. | Paid sprint capacity is spent twice on the same feature. *[To validate: share of tickets reopened after review.]* |
| Late defect discovery | Testing starts at the end of the sprint. | Defects reach staging or production, where they cost more to fix and can damage client trust. |
| Missing documentation | Documents are skipped when the sprint is busy. | Onboarding is slow, knowledge leaves with people, and client or audit questions cannot be answered from a record. |
| Unreliable status | The board does not match the code and the tests. | Managers and clients make delivery decisions on wrong information, and commitments slip. |

## 6. Impact on Users

### Product Owner

| When this happens… | They cannot… | Consequence for them |
|---|---|---|
| A new requirements document arrives. | Get from the document to a reviewable backlog quickly. | They spend evenings writing tickets, and the backlog is thin when the sprint starts. |
| A developer asks what a ticket means. | Point to the exact line of the requirement the ticket came from. | They answer the same question several times and become a bottleneck. |
| A ticket changes during the sprint. | Show what it said before and why it changed. | Scope arguments happen at review, with no record to settle them. |

### Scrum Master

| When this happens… | They cannot… | Consequence for them |
|---|---|---|
| Sprint planning starts. | See which tickets are actually ready. | Planning runs long, and the sprint is committed on guesses. |
| Someone asks for status. | Trust the board to show the real state of code and tests. | They chase people one by one for updates. |
| A new person joins the team. | Hand them up-to-date documents for each feature. | Onboarding takes longer, and the rest of the team loses time explaining. |

### Developer

| When this happens… | They cannot… | Consequence for them |
|---|---|---|
| They pick up a ticket. | Start without first clarifying the criteria. | Work waits for an answer, or is built on an assumption that is wrong. |
| They finish the code. | Have the ticket status and pull request details update by themselves. | Status is forgotten, and the board falls out of date. |
| QA reports a bug. | See the failing step, screenshot and test case together. | They spend time reproducing the bug before they can fix it. |

### QA tester

| When this happens… | They cannot… | Consequence for them |
|---|---|---|
| A ticket is ready for test. | Start from test cases that already match its acceptance criteria. | They write cases under time pressure, and coverage is thin. |
| A regression check is due. | Re-run the same checks automatically, logged in as the right user. | They repeat manual work every sprint, and regressions slip through. |
| A test fails. | Attach proof of the failure without extra effort. | Bug reports are weak, and the fix-and-retest loop is slow. |

## 7. Cost of Inaction

- **Rework keeps growing.** Each new feature repeats the same manual translation, so the same misunderstandings and reopened tickets come back every sprint.
- **Teams cannot grow without more admin.** Adding developers needs more ready tickets, and more PO and QA hours to write them. The bottleneck moves but does not go away.
- **Quality depends on who wrote the ticket.** Without one standard for stories, criteria and tests, the result changes from person to person and from project to project.
- **Knowledge is lost.** With no documents and no trace from requirement to code, the reasons behind decisions leave with the people who made them.
- **Clients lose confidence.** Late features, defects found in production and a board that is wrong make delivery commitments hard to believe. *[To validate with account managers: client complaints linked to delivery or quality.]*

## 8. Evidence Needed

| Evidence | What it proves | Source | Status |
|---|---|---|---|
| Hours a Product Owner spends turning one requirements document into a ready backlog. | The size of the manual translation cost. | Time logs or interviews with 2 to 3 Product Owners. | Not collected |
| Share of tickets reopened or rejected at sprint review, and why. | How much rework comes from unclear tickets or criteria. | Tracker history for the last 3 to 6 sprints. | Not collected |
| Share of tickets that start a sprint without acceptance criteria or test cases. | How often teams start work that is not ready. | Backlog snapshot at sprint planning. | Not collected |
| Number of defects found after the sprint they were built in. | The cost of testing late. | Bug tracker, tagged by the sprint found and the sprint built. | Not collected |
| Number of features with no current problem statement, feature brief or architecture document. | The size of the documentation gap. | Project document folders. | Not collected |
| Time from code merged to ticket marked done. | How far the board lags behind the real state of the code. | Pull request and tracker timestamps. | Not collected |
