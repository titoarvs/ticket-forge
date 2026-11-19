# Ticket layer: decision rules (TF-129 spike)

Every issue has an **Implementation** field (`layer` in the data). It says where the work happens:

| Value | Shown as | Meaning |
|---|---|---|
| `frontend` | Frontend / FE | Only the user interface changes. |
| `backend` | Backend / BE | Only the server, API or data changes. |
| `both` | Frontend + Backend / FE+BE | The user interface **and** the server change. |
| *(empty)* | Not set | Nobody has decided yet. |

This note sets the rules a person uses to choose the value, with worked examples, what we found in the current code, and
the open questions. It is a spike result: the ticket model and the automatic classifier are not changed here.

## What to read before deciding

Read the whole ticket, not only the title:

1. Title and type (Story, Task, Bug, Spike).
2. User story.
3. Description: context, scope and out of scope.
4. Acceptance criteria and test cases. These often show the real work. For example, "the layer **shows** frontend" is a
   screen, and "the API **rejects** …" is the server.
5. Labels and linked issues. Use them as hints only. A `frontend` **label** is not the layer.

## Decision rules

Apply the rules in order and stop at the first one that decides.

**Rule 0: enough information.** A ticket needs a title **and** at least one of a description, user story or acceptance
criteria before it gets a layer. If it has only a title:
- Leave Implementation as **Not set**.
- Flag it for review and say why, for example in a comment: "Layer not set: no description, so it isn't clear whether the
  UI, the server or both change." Then ask the reporter.
- Don't guess the layer from the title.

**Rule 1: list what changes.** Write down each change the ticket asks for and put each one in one of these columns:

| User interface (frontend) | Server, API or data (backend) |
|---|---|
| Pages, screens, panels, drawers, modals | API routes (`app/api/**`), GraphQL or REST endpoints |
| Components, buttons, menus, forms, tables, filters | Database tables, columns, indexes, migrations, RLS policies |
| Layout, styles, themes, icons, text on screen | Business rules and calculations that run on the server |
| Client-side validation, navigation, toasts, undo | Permission checks enforced on the server |
| Client state and client-only logic (`client/**`) | Integrations, webhooks, emails, background and scheduled jobs |
| Showing data the API already returns | AI prompts and calls, exports and imports built on the server |

**Rule 2: pick exactly one value.**
- Every change is in the left column, and the API it needs already exists or isn't needed: **frontend**.
- Every change is in the right column, and no screen changes in a way a user can see: **backend**.
- There is at least one change in each column: **both**.

A reviewed ticket always gets exactly one of these three values. Leave it Not set only under Rule 0, and always with a
reason.

**Rule 3: tie-breakers.**
- **A new field on screen that the API doesn't return yet** is **both**. The API changes and the screen changes.
- **A server change that the screen shows with no UI change** (new rows, a corrected total, a faster response) is
  **backend**.
- **A permission** is **both** when the server enforces it and the UI hides or disables the control. It is **backend**
  when only the server check is added.
- **A bug** gets the layer of the place where the fix lands. If the cause isn't known yet, leave it Not set and flag it
  (Rule 0), then set the layer when the cause is found.
- **A spike, documentation or confirmation ticket** that changes no code gets the side its findings inform most. If it
  informs both sides equally, use **both**. This is the rule the AI classifier in `lib/layers.ts` already follows. See
  open question 1.
- **Tests only:** use the layer of the code under test. End-to-end tests that drive the browser against the API are
  **both**.
- **Shared code** used by the server and the client (for example `lib/` helpers imported by `client/`): use the side
  whose behaviour changes for the user. If both sides change, use **both**.

## Worked examples

These cover the TF-129 test cases.

| Ticket | Changes | Layer |
|---|---|---|
| "Show the layer chip in the issue list columns." The data already has `layer`. | Table column and chip style | **frontend** |
| "Add a sort option to the Issues filter bar." | Client-side sort | **frontend** |
| "Reject MCP issue creation when the token's role lacks `issue.create`." | Server permission check | **backend** |
| "Add an index on `issues.project_id` to speed up loading." | Database index | **backend** |
| "Add a due-date field the user can edit and that is saved on the issue." | Data and API plus an editor in the drawer | **both** |
| "Add an AI helper chat panel that searches and creates tickets." | Panel UI plus server AI calls and permissions | **both** |
| "Fix login" (no description) | Unknown | **Not set**, flagged: "no description, so the affected layer isn't known" |
| "Write the scrum pain-points document." | No code. It informs planning on both sides. | **both** (spike/doc rule) |

## How to apply it in Ticket Forge today

- **One issue:** open the issue → details → **Implementation** → Frontend, Backend or Frontend + Backend.
- **Many issues:** Dev → **Mark unmarked with AI** (`POST /api/projects/[id]/layers`, `lib/layers.ts`). It only marks
  issues that have no layer, unless you choose to re-mark all. Check the result against the rules above and correct
  issues one by one. ⌘Z undoes the whole batch.
- **New tickets from documents:** the generator already asks the model for a `layer` (`TICKET_SHAPE` in
  `lib/prompts.ts`). Review it with the rules above like any other field.

## What we found in the current code

- The three values `frontend`, `backend` and `both` are used the same way everywhere: `LAYERS` in `lib/layers.ts`, the
  drawer select in `client/Drawer.tsx`, `LayerChip` in `client/ui.tsx`, the Issues filter and column in
  `client/Issues.tsx`, and dev order in `lib/devorder.ts`. Nothing needs to change in the model.
- The classifier's criteria in `lib/layers.ts` (both the Jev path and the AI path) match Rules 1 to 3.
- **Gap: tickets with only a title.** `classifyLayers` sends a ticket even when it has no description, user story or
  acceptance criteria, and the model picks a layer from the title alone. That breaks Rule 0. See open question 2.
- **Gap: reasons are dropped.** `classifyLayers` returns a short `reasons` entry for each ticket, but the Dev screen
  (`classify` in `client/DevCode.tsx`) only applies `layers`. The reason isn't shown or saved, so a reviewer can't see
  why a layer was chosen.
- The generator example puts `"labels": ["frontend"]` next to `layer`. That can mix up the label with the layer. Rule
  "labels are hints only" above covers this for reviewers.
- With no separate backend repository (`devBackend` off), Dev code treats every issue as frontend (`sideOf` in
  `client/DevCode.tsx`). The layer still matters there for planning, but it doesn't change where code is generated.

## Open questions

1. **No-code tickets.** Spikes and documents (for example TF-116, TF-117 and this spike) don't change code, but they get
   frontend, backend or both. Do we want a fourth value such as `none`? That would change the ticket model, which this
   spike leaves out. Until we decide, use the spike/doc rule.
2. **Classifier and thin tickets.** Should `lib/layers.ts` skip tickets with no description, user story or acceptance
   criteria, and report them as "needs review" instead of guessing? This is a follow-up ticket, not part of this spike.
3. **Where the "needs review" flag lives.** There is no field for it. Proposal: a comment with the reason, plus a label
   such as `needs-layer` so the Issues filter can find it. Does the team agree on the label name?
4. **Showing the AI's reason.** Should the reason from `classifyLayers` be stored, for example in the issue history next
   to the change by "Claude", so reviewers can check it?
5. **Single-repository projects.** For a project like Ticket Forge itself, where the server and the UI live in one
   repository, is the layer only for planning? Or should it also decide which agent or reviewer gets the work?
6. **Who reviews.** Does the layer have to be confirmed by a person (product owner or tech lead) before sprint planning,
   or is the AI's value accepted unless someone changes it?
