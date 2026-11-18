# Ticket Forge: Problem Statement — Building Code Together

> **Source and status.** This document follows Ticket Forge's own Problem Statement (PSD) structure (`lib/psd.ts`). It focuses on development: how a team builds code together, and how every member can keep contributing when tickets, code or documents are already "done", whether by a teammate or by AI. It is based on the README and the app's code (code jobs in `lib/devagent.ts`, per-person repositories in `lib/mylocal.ts`, document review in `lib/epic-review.ts` and `lib/approval.ts`). It describes the problem, not the design. It contains no measured data from any named team. Each claim that still needs proof is marked *[To validate: …]* and listed in Part 8. Status: **Draft**.

## 1. At a Glance

| Item | Summary |
|---|---|
| **The problem** | When a ticket is finished, by a person or by AI, the rest of the team has no clear way to take part. They cannot easily see what was built, review it, improve it, build on it or pick up the next piece. So development ends up in the hands of one or two people. |
| **Why it matters** | Code that only one person understands is slow to review, risky to change, and stops when that person is away. New contributors take weeks to become useful, and the team's skills go unused. |
| **Who is affected** | Developers (senior and new), QA testers, Product Owners, Scrum Masters, tech leads and reviewers, and outside contributors such as freelancers or a client's own developers. |
| **What is proposed** | One workspace where every ticket, document, branch, pull request and review is linked. Each person sees what they can contribute next and works on their own copy without getting in anyone's way. |

**What does "contribute" mean here?** Any work that moves a feature forward: writing or reviewing a requirement document, building or reviewing code, testing, fixing a bug found in review, improving AI-written code, adding tests, or documenting a decision. "Done" for one person should be the starting point for the next.

## 2. Background and Current Situation

A feature passes through many hands: the Product Owner writes the requirement, an architect or tech lead plans it, developers build it, reviewers check it, QA tests it, and someone keeps the documents current. With AI tools, a large part of the first draft (tickets, documents, even code) can now be produced in minutes.

That raises a new question for the team: **if the AI or one fast teammate has already done the task, what is left for everyone else, and how do they join in?**

Today the answer is unclear:

- Code is written on one person's machine and only appears to others as a large pull request at the end.
- AI-written code is either merged without a real review, or thrown away because nobody trusts it.
- Two developers start on the same ticket, or change the same files, because nobody can see who is working on what.
- A new developer cannot tell where to start. Setup steps, the repository, the branch rules and the "why" behind the code live in people's heads.
- When a ticket is marked done, the follow-up work (review comments, missing tests, edge cases, documents) is not tracked as work anyone can pick up.
- Review and approval of documents and code are done in chat, so nobody can see who approved what, or which version.

## 3. Problem Statement

Teams have no shared, visible flow for building code together. Work moves from requirement to ticket to code to pull request, but each step belongs to one person and is hidden until it is finished. When a step is done, by a teammate or by AI, nothing tells the others what they can do next: review it, test it, improve it, or build the next part on top of it. Because of this, a few people carry the development, reviews become a bottleneck, AI output is not checked well, new contributors stay on the sidelines, and the team cannot grow its output by adding people.

### Why other people cannot contribute today

| Gap | What it means | Examples |
|---|---|---|
| **Work is invisible until it is finished** | Nobody can see who is building what, on which branch, or how far it has got. | **Board:** two developers both pick up "Export report" and build it twice. **Standup:** "almost done" for three days, with no branch anyone can look at. |
| **"Done" has no next step** | Finishing a ticket does not create the follow-up work for others: review, tests, fixes, documents. | **Pull request:** merged with three open review comments that nobody owns. **QA:** finds out a ticket is "done" only when the sprint ends. |
| **AI output has no owner** | Code or tickets written by AI are not clearly assigned to a person who reviews, accepts and improves them. | **Code job:** AI writes a change that passes its own check, but nobody on the team reads the diff before it is merged. *[To validate: share of AI-written changes merged without a human review.]* |
| **Contributors get in each other's way** | People work in the same checkout, the same branch or the same files, and their changes collide. | **Repository:** a teammate's local folder path is saved in the project and breaks for everyone else. **Merge:** two branches change the same module and conflict on the last day. |
| **Joining is hard** | A new or outside contributor has no clear entry point: setup, access, rules and context are scattered. | **Onboarding:** a freelancer needs a week of calls before their first commit. **Client developer:** cannot see which tickets are safe to take. |
| **Reviews and approvals are not recorded** | Who reviewed or approved a document or a change, and which version, is not tracked. | **Document:** the architecture record is edited after sign-off, and the team builds from a version nobody approved. |

## 4. Who Is Affected

| Who | Relationship to Ticket Forge | How they are affected |
|---|---|---|
| **Developer (experienced)** | Builds and reviews most of the code. | Becomes the bottleneck for every review and question, and cannot hand work off because nobody else knows it well enough. |
| **Developer (new or junior)** | Joins the project and wants to help. | Cannot find a safe first task, cannot set up the repository alone, and waits for someone to have time for them. |
| **Outside contributor** (freelancer, partner or client developer) | Works on the project part-time or with limited access. | Has no clear view of which work is open, which rules to follow, or how their work will be reviewed and merged. |
| **Tech lead / reviewer** | Reviews code and approves designs. | Gets large, late pull requests and AI-written changes with no context, and approves by trust instead of by evidence. |
| **QA tester** | Tests what was built. | Is not told when something is ready to test, and cannot link a failure back to the change that caused it. |
| **Product Owner and Scrum Master** | Own the scope and the flow of work. | Cannot see who is doing what, cannot spread work across the team, and cannot tell whether "done" is really done. |

## 5. Impact on the Business

| Pain point | What happens today | Consequence for the business |
|---|---|---|
| Development depends on a few people | One or two developers hold the knowledge and do most reviews. | Delivery stops when they are away, and losing one of them is a serious risk to the project. |
| Paid capacity sits idle | New or part-time contributors wait for tasks, setup or context. | The team pays for people who cannot contribute yet. *[To validate: days from joining to first merged change.]* |
| Duplicate and conflicting work | People cannot see what others are building. | Time is spent building the same thing twice and fixing merge conflicts late in the sprint. |
| Unchecked AI output | AI-written code is merged without a real human review, or thrown away. | Defects and security risks reach production, or the speed gain from AI is lost. |
| No record of review and approval | Approvals happen in chat, on unknown versions. | Disputes about scope cannot be settled, and the team cannot show a client or auditor who approved what. |

## 6. Impact on Users

### Developer (experienced)

| When this happens… | They cannot… | Consequence for them |
|---|---|---|
| They finish a ticket. | Hand the follow-up (tests, review fixes, documents) to a teammate as tracked work. | They do it all themselves, or it is never done. |
| AI writes a change for an issue. | Review the diff against the acceptance criteria before it is committed and pushed. | They either trust it blindly or rewrite it from scratch. |
| They go on leave. | Leave their work in a state someone else can pick up. | Their tickets stop, or they get called during their time off. |

### Developer (new or junior)

| When this happens… | They cannot… | Consequence for them |
|---|---|---|
| They join the project. | Connect the repository on their own computer without changing the project for everyone else. | They depend on a senior developer for setup. |
| They look for work. | See which tickets are open, ready and safe for them to take. | They wait to be told, or pick something already in progress. |
| They want to learn the feature. | Read the problem statement, feature brief and architecture record behind the code. | They learn from questions and old chat messages, slowly. |

### Outside contributor

| When this happens… | They cannot… | Consequence for them |
|---|---|---|
| They are invited to help. | Get access with the right role, and only to the projects they need. | Access is given too wide, too narrow, or too late. |
| They send a change. | Follow the project's branch and pull request rules without asking. | Their pull requests are rejected for format, not for content. |
| Their change is reviewed. | See the review result linked to the ticket it belongs to. | They do not know whether their work counted, or what to fix. |

### Tech lead / reviewer

| When this happens… | They cannot… | Consequence for them |
|---|---|---|
| A pull request arrives. | See the ticket, its acceptance criteria and its test results next to the diff. | Reviews take longer and miss what the change was meant to do. |
| A design document changes after approval. | Tell that it changed, and require a new approval. | The team builds from a version they did not agree to. |
| Several people work on one epic. | See all their branches and pull requests in one place. | Conflicts and gaps are found only at merge time. |

## 7. Cost of Inaction

- **AI makes the bottleneck worse, not better.** AI produces more tickets and more code, but if only one or two people can review and own it, the queue grows faster than it is cleared.
- **The team cannot grow.** Adding developers adds setup, questions and conflicts, not output, so bigger teams do not deliver much more.
- **Knowledge stays with a few people.** Every person who leaves takes part of the project with them.
- **Contributors lose motivation.** People who cannot find meaningful work, or whose work is not reviewed, disengage or leave. *[To validate with team leads: feedback from new joiners.]*
- **Quality drops quietly.** Unreviewed changes and untracked follow-ups pile up as defects and technical debt that surface later, when they cost more.

## 8. Evidence Needed

| Evidence | What it proves | Source | Status |
|---|---|---|---|
| Days from a developer joining to their first merged change. | How hard it is to start contributing. | Account creation and pull request dates for recent joiners. | Not collected |
| Share of pull requests reviewed by the same one or two people. | How concentrated review and knowledge are. | Repository review history for the last 3 months. | Not collected |
| Share of AI-written changes merged with and without a human review. | Whether AI output has a real owner. | Code job and pull request records. | Not collected |
| Number of tickets worked on by two people at once, or rebuilt. | How much work is duplicated because it is not visible. | Tracker and branch history. | Not collected |
| Open review comments and follow-ups left on merged pull requests. | How often "done" leaves untracked work behind. | Pull request comments after merge. | Not collected |
| Documents built from a version that was not approved. | The risk of missing review and approval records. | Document version and approval history. | Not collected |
