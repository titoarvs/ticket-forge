# Scrum team pain points in the building phase, and how Ticket Forge may help

> **Source and status.** Written for issue TF-117 from common scrum pain points and from the Ticket Forge App Context. It contains no named-team data, interviews or measured results. Ticket Forge is mentioned only as a possible answer, and only through features the App Context lists. Anything not confirmed is marked **TBD**, not guessed. The format (this Markdown source in `docs/` and the generated Word file) still needs the Product Owner's confirmation: **TBD**.

## How to read this document

- **TBD** means "to be decided or confirmed". It is never a value. Don't quote a TBD item as fact.
- **Roles** are the four roles on a scrum team: **Scrum Master (SM)**, **Product Owner (PO)**, **Developer (Dev)** and **QA**.
- **Issue keys** such as `TF-24` point to the ticket where a Ticket Forge feature was specified.
- Part 1 lists the pain points. Part 2 shows how each one shows up in day-to-day work. Part 3 says how Ticket Forge may help. Part 4 lists open points.
- The pain points are common ones. They describe what scrum teams often meet while building, not what any one team has reported.

## 1. Common pain points in the building phase

| # | Pain point | Short description | Who feels it |
|---|---|---|---|
| 1 | Creating the backlog | Turning requirements into epics and tickets by hand is slow, and the result varies from person to person. | PO, SM |
| 2 | Turning requirements into tickets | Requirements arrive as documents, emails or conversations. Detail and intent get lost or misread when they are rewritten as tickets. | PO, Dev |
| 3 | Writing acceptance criteria | Criteria are written late, are vague, or differ between tickets, so "done" means different things to different people. | PO, Dev, QA |
| 4 | Writing test cases | Test cases take a long time to write and are often written after the code, or are thin. | QA, Dev |
| 5 | Running and checking tests | Repeating tests by hand, setting up logins and collecting proof of failures takes effort during the sprint. | QA, Dev |
| 6 | Documentation | Product, functional and design documents are written late, go out of date, or never get written. | PO, Dev, QA, SM |
| 7 | Handoffs and status visibility | Work moves between people (PO to Dev, Dev to QA), and nobody is sure of the current status, the owner or what changed. | SM, Dev, QA, PO |
| 8 | Tracking changes to tickets | Tickets change during the sprint, and it is hard to see what changed, when and why, or to go back. | PO, SM, Dev |
| 9 | From code to delivery | Linking finished code to builds, pull requests and ticket status is manual and easy to forget. | Dev, SM |
| 10 | Sprint planning and meeting overhead | Planning, estimating and running ceremonies take time away from building. | SM, PO, Dev |

## 2. How each pain point shows up day to day

### 1. Creating the backlog
- **Product Owner:** spends a large part of the week writing epics and tickets before the team can start. The backlog is thin or uneven when the sprint begins.
- **Scrum Master:** sees refinement sessions turn into writing sessions, and sees too few ready tickets for the sprint.

### 2. Turning requirements into tickets
- **Product Owner:** re-types or summarises a requirements document, and leaves out details without noticing.
- **Developer:** reads a ticket, finds it does not match the requirement, and has to ask. Work stops while waiting for an answer.

### 3. Writing acceptance criteria
- **Product Owner:** is asked to add or sharpen criteria at the last minute.
- **Developer:** builds against criteria that are open to more than one reading.
- **QA:** cannot tell what to verify, or finds out late that the criteria were different from what was built.

### 4. Writing test cases
- **QA:** writes cases from tickets that are still changing, and falls behind the developers.
- **Developer:** gets feedback late, near the end of the sprint, when a fix is more disruptive.

### 5. Running and checking tests
- **QA:** repeats the same checks by hand each sprint, logs in over and over, and has to collect screenshots and notes to show a failure.
- **Developer:** receives a bug report without enough evidence and has to reproduce it first.

### 6. Documentation
- **Product Owner:** documents are the first thing dropped when the sprint is busy.
- **Developer and QA:** work from old or missing documents, or from memory.
- **Scrum Master:** sees new team members take longer to get up to speed because nothing is written down.

### 7. Handoffs and status visibility
- **Scrum Master:** has to ask people for status, and chases blocked or unassigned tickets.
- **Developer and QA:** do not know when a ticket is ready for them, or who has it.
- **Product Owner:** is unsure what is finished and what is still in progress.

### 8. Tracking changes to tickets
- **Product Owner:** changes a ticket mid-sprint, and later cannot show what it said before.
- **Scrum Master:** cannot easily explain why scope moved.
- **Developer:** discovers a ticket changed after work had started.

### 9. From code to delivery
- **Developer:** manually writes pull request descriptions, triggers builds and updates the ticket status after finishing the code. The status is sometimes forgotten.
- **Scrum Master:** sees a board that does not match the real state of the code.

### 10. Sprint planning and meeting overhead
- **Scrum Master:** spends time on scheduling and running planning, review and retrospective sessions.
- **Product Owner and Developer:** estimate and plan on limited detail.

How often each of these happens, and how much time each costs, is **TBD**. This document does not measure it.

## 3. How Ticket Forge may help

Only features listed in the Ticket Forge App Context are named. "May help" means the feature is aimed at the pain point. It is not a claim about results. Where the App Context lists no matching feature, the table says so.

| # | Pain point | Ticket Forge features that may help (App Context) | Notes |
|---|---|---|---|
| 1 | Creating the backlog | Generate backlog from requirements (TF-24). Add features with AI (TF-1). Export backlog to files (TF-35). | TF-24 gives epics and tickets from requirements. Generated content still needs the team's review: how review is done is **TBD**. |
| 2 | Turning requirements into tickets | Generate backlog from requirements (TF-24). Document upload, which parses PDF (TF-82). Attach UI references to tickets for AI generation (TF-80). Generation rules (TF-66) and generation guide (TF-67). | What the generation rules and guide cover in detail is **TBD**. |
| 3 | Writing acceptance criteria | No current feature in the App Context is confirmed to address this. | Whether generated tickets include acceptance criteria is **TBD**. The App Context does not say. |
| 4 | Writing test cases | Batch test cases (TF-25). Test plan (TF-39). Select tests (TF-40). Build a test repository with AI (TF-41). | Test case format and the standard they follow: **TBD**. |
| 5 | Running and checking tests | Run test automation (TF-42). Install browser automation (TF-43). Automation status (TF-44). Open a run output file (TF-45). Project credentials (TF-46) and credentials session (TF-47). Test the login with saved credentials (TF-49). Failure screenshots (TF-50, TF-51). | Which browser engine is used: **TBD** (the App Context says "likely Playwright", unconfirmed). Plan limits may block some actions. |
| 6 | Documentation | Generate each of PSD, FBD, ARD and the Agent document, and download each as Word (TF-27 to TF-34). Per-project document templates (TF-36 to TF-38). Coding specs per epic, with overlap detection (TF-99). | What PSD, FBD and ARD stand for is **TBD** in the App Context. |
| 7 | Handoffs and status visibility | Set backlog status and assignee (TF-4). Ticket details in a side panel (TF-2, TF-76). Activity (TF-20) and Changes (TF-21). Notifications, with mark as read (TF-22, TF-23). | Status names are **TBD**. |
| 8 | Tracking changes to tickets | Tickets are versioned on status change, with view, diff and restore (TF-71). Project version check for changes (TF-19). Changes (TF-21). | Versions are created on a status change. Versions for other kinds of edit: **TBD**. |
| 9 | From code to delivery | Trigger a build (TF-3). Generate pull request info (TF-58). Sync the repository (TF-56). Auto-update ticket status on code completion (TF-79). | The code host is **TBD** in the App Context. |
| 10 | Sprint planning and meeting overhead | No current feature in the App Context addresses this. | Not covered by this document. |

### Summary by role

| Role | Pain points they feel (by number) | Ticket Forge features that may help (see Part 3) |
|---|---|---|
| Scrum Master | 1, 6, 7, 8, 9, 10 | Backlog generation (1), documents (6), status, activity and notifications (7), ticket versions (8), delivery status update (9). Nothing listed for 10. |
| Product Owner | 1, 2, 3, 6, 7, 8, 10 | Backlog generation and upload (1, 2), documents and templates (6), versions (8). Nothing listed for 3 or 10. |
| Developer | 2, 3, 4, 5, 6, 7, 8, 9, 10 | Documents and coding specs (6), builds and pull request info (9), status and activity (7), versions (8). Nothing listed for 3 or 10. |
| QA | 3, 4, 5, 6, 7 | Batch test cases and test repository (4), test automation and failure screenshots (5), documents (6), status and notifications (7). Nothing listed for 3. |

## 4. Open points (TBD)

- Agreed document format and where it is stored: **TBD**. This version is a Markdown source in `docs/` with a generated Word file, as for the earlier Ticket Forge overview document. The Product Owner needs to confirm it.
- How often each pain point happens, and its cost: **TBD**. Out of scope for this document.
- Whether Ticket Forge writes acceptance criteria: **TBD**.
- Which statuses a ticket moves through, and who may change them: **TBD**.
- A formal one-line Ticket Forge product summary: **TBD**.
- Whether any of these pain points should lead to new features: out of scope. This document makes no roadmap commitment.
