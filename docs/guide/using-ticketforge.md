# Using TicketForge

From uploading a document to planning, tracking and exporting the work. Back to the [documentation index](../README.md).

## On this page

- [How it works](#how-it-works)
- [Generation rules (team standard)](#generation-rules-team-standard)
- [Questions before the AI writes](#questions-before-the-ai-writes)
- [Splitting issues into smaller ones](#splitting-issues-into-smaller-ones)
- [Coding specs per epic, with overlap detection](#coding-specs-per-epic-with-overlap-detection)
- [Epic drafts (save an AI-generated epic and publish it later)](#epic-drafts-save-an-ai-generated-epic-and-publish-it-later)
- [Backlog: Jira-style actions](#backlog-jira-style-actions)
- [Pull requests page](#pull-requests-page)
- [Issues page](#issues-page)
- [Releases (versions)](#releases-versions)
- [Activity (the project timeline)](#activity-the-project-timeline)
- [Brain (the project's knowledge vault)](#brain-the-projects-knowledge-vault)
- [Top bar and searchable dropdowns](#top-bar-and-searchable-dropdowns)

## How it works

1. **Upload** a PDF, Word (.docx), Markdown, text, HTML, Excel or CSV file, or paste text. You can review
   and edit the extracted text before sending it.
2. **Generate.** Claude reads the document and returns a summary, assumptions, open questions, epics and
   tickets with user stories and Given/When/Then acceptance criteria. Then it writes test cases per epic,
   several epics at a time. Progress streams live.
3. **Work in a Jira-style project** (sidebar on the left):
   - **Summary**: totals, active sprint, status overview, test results, priority breakdown, recent activity,
     epic progress, and the document's summary, assumptions and open questions.
   - **Backlog** grouped by **sprint** (or epic, status, none). Create sprints, drag issues into them, then
     **Start sprint** (name, duration, dates, goal) and **Complete sprint** (open issues move to the backlog, the
     next sprint or a new one). Filter by epic, type, priority, status or assignee avatars; create issues inline;
     select several to move to a sprint or epic, set status, assign, delete, have Claude write test cases, or run
     their automated tests.
   - **Board / Active sprint** (Jira-style): one column per workflow status with sticky headers; drag cards to
     change status; swimlanes by epic or assignee (collapsible); collapse columns to a narrow strip; column limits
     (the header turns red when a column has too many issues); **Create issue** at the bottom of a column; days
     remaining; switch to all issues. Change a card's **assignee**, **story points** (any positive number) and
     **priority** right on the card: it saves at once, and if the save fails the old value comes back with an error
     message. Changing an assignee or priority sends an in-app notification to the assignee only. On a tablet or
     phone the board shows one column at a time, with a tab per column, so nothing scrolls sideways.
   - **Epics**: progress bars per epic; create, rename, recolour or delete; **Re-organize with Claude**.
   - **Timeline**: every epic on a calendar (weeks, months or quarters), with a sprints row and a today line. Each
     epic has a start and due date (set them in the epic panel, or on the timeline: click or drag an empty row to
     schedule, drag a bar to move it, drag its ends to change dates; arrow keys work too). Epics without dates
     show an estimate from their issues' sprints (dashed). Bars fill with progress and turn red at the end when
     overdue. Expand an epic to see its issues, placed by sprint. Dates are included in the Excel and Jira exports.
   - **Add feature with AI** (Backlog and Epics): add a new feature or epic to an existing project. Describe it
     or import a document (PDF, Word, Markdown and more). The AI sees the project's epics and issues, so it adds
     to an existing epic when one fits, creates a new one when not, and skips work the project already has
     (raised as an open question instead). Review the plan, untick anything you don't want, then add it: new
     issues continue the project's keys (for example ALP-7…), with test cases, and ⌘Z undoes it.
   - **Reports**: velocity (committed vs completed points per sprint), sprint burndown, and a sprint report.
   - **Test cases**: every test case with its manual or automated result.
   - **Test automation**: see [Testing](testing.md#test-automation).
   - **Project settings**, in four sections (a menu on the left, tabs on a phone; changes save automatically):
     **Details** (name and key; a **project description** in your own words; the **initial feature**, meaning
     the summary, assumptions and open questions the AI read from the first document, as readable lists you can
     edit, with reference codes such as A-PR-01 shown as tags and unconfirmed items flagged; other documents; and
     the project at a glance), **People** (team
     members with an account, and people without one you can assign issues to), **Workflow** and **Danger zone**
     (delete the project). **Workflow**: add, rename, reorder or delete statuses, set each
     one's category (to do, in progress or done) and column limit, and choose the **transitions**, like Jira:
     *any status to any status* (the default), or *custom transitions* with a From → To grid, "any status can
     move here" per status, and quick starts (step by step, allow every move, clear). A **Status flow** node
     graph at the top shows every status as a node and every saved transition as an arrow (everyone who can open
     the project sees it). With *Edit project settings* you can add statuses, drag them, connect two statuses,
     and remove a status or transition (after a confirmation), then **Save flow**; a duplicate status name is
     refused. Without that permission the controls are hidden.
     With custom transitions the issue panel only offers allowed statuses, the board greys out columns an issue
     can't move to while you drag it, and bulk "Set status" skips (and reports) issues that can't move.
   - **Issue panel** (click any issue; expand for a full view): summary, status, details (assignee with
     “Assign to me”, reporter, labels, priority, story points, sprint, epic or parent, type), description, user
     story, acceptance criteria, **child issues** (sub-tasks), **linked issues** (blocks / is blocked by /
     relates to / duplicates / clones; blocked issues get a flag), test cases, **Development** (linked pull
     requests), dependency notes and **Activity** (comments with edit/delete, and a full change history).
   - **Comments** are rich text, like Jira (TipTap): bold, italic, strikethrough, inline code, bulleted and
     numbered lists, quotes, code blocks and links, from the toolbar, keyboard shortcuts or Markdown as you type
     (`**bold**`, `- list`, `> quote`, backticks); web addresses link themselves. **Attach files** with the
     paperclip, by dropping them on the box or by pasting (screenshots straight from the clipboard): images show
     as thumbnails, other files as chips. Images, PDF, Office files, text, CSV, JSON, ZIP and video up to 20 MB
     each, stored in the database with the project's access rules; web pages and SVGs are refused, and anything
     that isn't an image, PDF or video always downloads instead of opening. ⌘↩ saves. Older plain-text comments
     still show as before.
   - **Claude actions** on an issue: *Enhance*, *Improve acceptance criteria*, *Regenerate test cases*,
     *Split into smaller issues*, or *Ask Claude…*. Each suggestion opens a before/after review first.
   - **Create** (top bar, or press `C`): Jira-style create dialog, or **Write with Claude**.
   - **Sidebar:** collapse it to an icon rail with the arrow on its edge, or press `[`. TicketForge remembers your choice.
   - **Issue panel width:** drag its left edge to resize it (or focus the edge and use the arrow keys); double-click
     the edge to reset. TicketForge remembers the width.
   - Undo/redo (⌘Z / ⇧⌘Z), `/` to search, `Esc` to close panels, and autosave. Projects are stored as JSON in
     `data/projects/`.
   - **Source documents**: the document the project was created from plus every document or description added
     later (with Add feature with AI, or **Add document** for reference). Each shows its words and reading time,
     who added it and when, the AI's summary, assumptions and open questions, and the epics and issues it produced.
     **Document** view shows it like the original: PDFs open in the browser's PDF viewer, Word files as a
     formatted page (headings, lists, tables, images), and text-only documents as a white A4 page with zoom and
     **Print / PDF**. **Text** view shows the plain text with find. Copy, download, rename or remove it, or **Plan
     work from it** with AI.
   - **Original files:** PDF and Word (.docx) uploads are kept (up to 20 MB) in the database, with the same access
     rules as the project. Documents added before this can get theirs with **Attach original**. Word files are
     shown in a sandboxed frame with no scripts or outside requests.
4. **Export** from the Export menu:

| Format | Contents |
|---|---|
| Excel (.xlsx) | Overview, Epics, Tickets, Test Cases (with automation results) and Sprints sheets |
| Word (.docx) | Summary, assumptions, open questions, then each epic → ticket with AC and a test case table |
| PDF | The same report, paginated |
| HTML | A single self-contained, searchable report (works offline, prints well) |
| CSV — tickets | One row per issue, with sprint, parent, links, pull requests and comment count |
| CSV — test cases | One row per test case, with automation status, last run and error |
| CSV — Jira import | Epics, issues and sub-tasks linked with `Issue Id` / `Parent`, plus sprint, assignee and status |
| Project backup (.json) | Re-import from the home screen |

## Generation rules (team standard)

**Administration → Generation** sets one standard for everything the AI writes. That covers new projects
from documents, Enhance, acceptance criteria, test cases, splitting issues, new issues and automation
scripts. The defaults:

- **Reasoning: Fast & consistent.** No extended thinking; the AI follows the rules directly. Balanced and
  Thorough think more, which is slower and costs more. Locally this is Claude Code's `--effort`; with APIs it's
  the provider's effort setting, skipped automatically where a model doesn't support it.
- **Stick to the document:** no extra features; unclear points become open questions.
- **Tickets:**
  - imperative titles of at most 10 words
  - "As a…, I want…, so that…" user stories
  - 3–6 Given/When/Then acceptance criteria
  - story points 1, 2, 3, 5, 8, 13, with anything over 8 split
  - types Story, Task, Bug, Spike
  - Medium priority unless stated
  - descriptions with Context / Scope / Out of scope
  - at most 3 labels
- **Test cases:**
  - exactly 3 per ticket (one positive, one negative, one edge case)
  - titles start with "Verify"
  - one action per step, at most 8 steps
  - preconditions always filled
- **Automation scripts:**
  - user-facing locators first
  - no fixed waits
  - only the described flow
  - test data prefixed "QA-"
- **Team rules:** anything else, in plain words.

**What the AI is told** shows the instructions for each kind of generation (tickets, test cases, improving an
issue, automation scripts), with their size in tokens. *Readable* splits them into the built-in role, your team
standards and the generation guide; *Exact text* shows the full text with a Copy button. It updates as you edit,
before you save.

Some rules are also enforced after generation:
- story points snap to the scale
- only the allowed ticket types are used
- labels are trimmed to the limit
- extra test cases are dropped
- test titles get the prefix

**Generation guide (Markdown):** import a `.md` file, or start from the template, with your glossary, roles,
conventions and example tickets and test cases. The AI gets it as reference context for tickets, test cases
and/or automation scripts (your choice), so it uses your words and structure. For example, a guide that says
"patron, never customer" is followed even when the request says "customer". You can preview, edit, download
or replace it. The limit is 60,000 characters, about 15k tokens.

**Reset to defaults** restores the standard. The create-project form uses the standard number of test cases
unless you change it for that run.

## Questions before the AI writes

- **Questions first:** before the AI writes anything, it reads what it was given and asks up to 5 questions, each with suggested answers. You answer what you can or skip; your answers go to the AI as instructions. This applies to:
  - generating a project or adding a feature;
  - writing, enhancing or splitting an issue;
  - acceptance criteria and test cases.

## Splitting issues into smaller ones

On the Epics page (**AI actions → Split issues**) or in an epic's panel (**Split issues**):
- **Pick the issues.** Big ones are ticked for you: over 3 points, or unestimated with many acceptance criteria, many test cases or a long description.
- **The AI proposes** small tickets for each issue: one testable behaviour each, 1–3 points, following your team's acceptance-criteria rules, and covering exactly the original scope. It shares the issue's test cases out to the part each one tests. Issues that are already small are kept, with the reason.
- **On apply**, the first part keeps the original issue (key, history, comments, pull requests, links). The other parts become new issues next to it, in the same epic, sprint and status, linked with "relates to". Parts that no test case covers are flagged so you can write tests for them. ⌘Z undoes it.

## Coding specs per epic, with overlap detection

In an epic's panel, **Coding specs** (needs a connected git remote: Project settings → Code & GitHub; any remote works):
- **Generate coding specs** writes one coding prompt per issue of the epic (`lib/specgen.ts`). Each spec lists the issue's acceptance criteria and the files and modules it is expected to touch. When the repository is on this computer the AI sees its file names, otherwise it goes by the Repository Profile. Generating again replaces the spec and sets it back to draft. Nothing here runs an AI agent or writes code.
- **Overlaps** (`lib/specs.ts`): two specs that list the same file or module are flagged, naming the issues and the file. Specs of one epic are always compared; specs of different epics are compared when one of them is ready (being coded in parallel).
- **Mark ready** follows the project's setting (Coding specs → Settings, needs *Edit project settings*): **block** refuses with a message naming the issues and files, **warn** marks the specs ready and shows the overlap. Specs without an overlap are marked ready with no warning. Blocking is the default.
- **Reviewer approval:** link AI-produced changes (a branch, pull request or commit) to a ready spec. They can be marked accepted only after one of the project's required reviewers (chosen in the same settings) has approved them; until then the server answers 409.
- Tables `coding_specs` and `spec_changes` (`lib/db.ts`); API under `/api/projects/:id/specs`.

## Epic drafts (save an AI-generated epic and publish it later)

In **Add feature with AI**, each new epic in the review step has **Save as draft** (shown only with *Manage epics*, the permission that creates epics; `client/EpicDrafts.tsx`):
- A draft is an epic with `draft: true`, saved with the project like any epic change. It keeps the AI's output as generated (`aiOriginal`: title, description and the planned issues) and who saved it (`draftBy`). Its planned issues are not added to the backlog.
- Drafts show in the **Epics** list among real epics, with a **Draft** badge. Open one to edit its title and description (saved and shown again on reload) and to see **Original AI output**, which is never edited.
- **Publish** (in the draft's panel) removes the draft flag, so it becomes a real epic. A draft with an empty title can't be published: the app shows a message, and the server refuses a save that does it with **400**.
- **Notifications:** saving or publishing sends an in-app notification (the bell, kinds `epic-draft-saved` and `epic-published`) to the person who saved the draft and to the project owner, once each. `POST /api/projects/:id/epic-drafts` (`lib/epic-drafts.ts`) sends it after checking what was saved.

## Backlog: Jira-style actions

Every backlog row works like Jira's: click the field you want to change and pick from a small popup.
- **Status**, **assignee** (search, *Assign to me*, *Unassigned*), **story points** (type any positive number or pick
  1, 2, 3, 5, 8, 13, 21; *Clear estimate*) and **priority**, right on the row. Assignee, points and priority save at
  once and go back to their old value, with an error message, if the save fails. Only the statuses the workflow allows are offered.
- **"…" or right-click** a row: move it to the top or bottom of the backlog or to a sprint, assign to me, unassign,
  change status, points, priority or epic, add or remove a **flag** (flagged issues are highlighted, as in Jira),
  open, copy the issue link or key, duplicate, delete.
- **Selecting several:** tick the boxes, **⌘/Ctrl-click** rows to add or remove them, **Shift-click** to select a range.
  The row menu and the selection bar then act on all of them (status, assignee, priority, story points, flag, sprint,
  epic, delete). Changes to many issues show a toast with **Undo** (⌘Z also works).
- The same popups work on the Issues page, and right-click works on Board cards. Flags show on the board and in the
  issue panel (*Add flag* / *Remove flag* in its menu), and are recorded in the issue history.
- Rows are drawn 200 per group at first, with *Show more*, so a backlog of thousands opens at once.

## Pull requests page

Every pull and merge request linked to the project's issues, with what GitHub / GitLab says about it:
- **On each row:** status, checks (passing, failing, running), reviews (approved, changes requested, review requested),
  merge conflicts, *Ready to merge* (approved, checks green, no conflicts), size (+added −removed, files), comments, the
  AI review verdict, branch → base, author, when it was opened and updated, and the linked issue.
- **Needs attention:** one click shows the requests with failing checks, requested changes, conflicts, no review yet,
  or ready to merge. The status cards (Active, Open, Draft, Merged, Declined, All) still filter by status.
- **Find and arrange:** search (title, branch, issue, label, author), repository, sort (recently updated, oldest open
  first, largest change, issue key) and group by status, repository or epic. Status, sort and grouping are remembered.
- **Click a row** for its details: description, labels, every check (failed first, linked), reviewers, the AI review,
  branch (copy), merge conflicts and the timeline.
- **Actions:** Review with AI, Update with AI, refresh, open on GitHub / GitLab, and in "…": copy the branch or link,
  open the issue, unlink.
- Open requests last read 10 or more minutes ago refresh by themselves, one at a time, when the page opens (up to 12).
  *Refresh open* reads them all now. GitHub details come through the signed-in `gh` CLI (or `GITHUB_TOKEN`); GitLab
  through the project's GitLab token.

## Issues page

**Issues** (sidebar → Planning) is a flat, sortable table of every issue, like an issue navigator:
- **Quick views:** All, Open, Assigned to me, Unassigned, Open bugs, Blocked, Failing tests, Updated this week, Done. Each shows its count.
- **Filters:** search (key, summary, description), type, status, priority, assignee, epic, sprint, layer and label. Sub-tasks can be shown too.
- **Sorting and columns:** click a column header to sort. A column chooser covers type, status, priority, assignee, epic, sprint, layer, points, labels, tests passing, PRs, reporter, due, updated and created.
- **Saved views:** save the current filters, sort and columns as a view (kept in this browser).
- **Editing:** change status and assignee inline, select rows for the usual bulk actions, and **Export CSV** of what's shown.

## Releases (versions)

Jira-style versions: **Releases** in the project sidebar.
- **Create version:** name, start and release dates, description. The list shows each version's status (Unreleased,
  Released, Archived, *Overdue* when its release date has passed), progress (done / in progress / to do) and dates.
- **Fix versions on issues:** in the issue panel (*Fix versions*), the backlog row menu (*Fix version…*), the selection
  bar for many issues at once, or *Add issues* on a version. Rows show their version; the filter bar has a *Version*
  filter (including *No version*).
- **A version's page:** progress and story points, what still blocks it (unfinished issues, open pull requests, failing
  tests), its issues by status (remove one with ×) and **release notes** (new features, improvements, bug fixes from
  its done issues) to copy or download as Markdown.
- **Release:** pick the release date and where unfinished issues go (another unreleased version, or out of this one).
  Released versions can be archived or moved back to unreleased; deleting one removes it from its issues (⌘Z undoes).
- Managing versions needs *Manage sprints* or *Edit project settings*; setting an issue's Fix version, *Edit issues*.

## Activity (the project timeline)

**Activity** in the project sidebar: every change in the project, newest first, grouped by day: issues created and
every field change (with from → to), comments, links, test results, pull requests, and the project-level changes
the server records on each save: sprints started and completed, epics, versions created, released and archived,
workflow and members, project settings, test management, and deleted issues. Filter by type, person, time (24 hours,
7 or 30 days) and text; click an issue to open it. Project-level entries are kept in the `activity` table (created
automatically); changes made before this existed show from the issues' own history.

## Brain (the project's knowledge vault)

**Brain** in the project sidebar: an Obsidian-compatible vault of Markdown notes linked with `[[wikilinks]]`, so the AI
and the code agents never miss a project's context.

- **What's in it.** One note per thing TicketForge knows, each with frontmatter (`title`, `type`, `key`, `status`,
  `tags`, `updated`, `origin`): an *Index* and *Project Overview* (summary, assumptions, open questions), every epic
  and issue (user story, description, acceptance criteria, status, sprint, Fix versions, dependencies, links, sub-tasks,
  test cases, pull requests, recent comments), releases, source documents, the
  project's open questions, the **App context** and the **Repository profile** from *Learn from repository*. Links go
  both ways: issue ↔ epic, issue ↔ dependencies and links, epic ↔ release, decision ↔ issue, question ↔ issue.
- **Always up to date.** The notes are rebuilt from the project whenever its version changes (when the Brain page or an
  AI task reads them), or with **Refresh brain**. Only changed notes are written. Generated notes are read-only.
- **Your own notes.** **New note** (types: note, decision, question, document; tags; status). Type `[[` to link a note.
  They're kept in *Notes/* (or the folder they were imported to) and a refresh never touches them. A missing link shows
  dashed; click it to create that note.
- **The viewer.** A list with search (titles, keys, tags and full text), filters by type and tag; the note rendered as
  Markdown with clickable wikilinks, its outgoing links and backlinks; **Open PRJ-12** for issues and epics; and an
  interactive **Graph** (drag, pan, zoom, "around the open note") drawn on a canvas, with no extra dependency. Light and
  dark themes, and phone width (list, then note).
- **AI uses it.** Before ticket writing and enhancing, test cases (backlog and test management), splits, test plans,
  document agents and test scripts, TicketForge picks the notes for the task:
  the notes of its issue or epic, the notes they link to and that link to them (one and two hops; decisions, questions,
  documents and team notes at two hops), and the best keyword matches. They go at the start of the prompt as a compact
  **PROJECT BRAIN** block (about 9,000 characters at most, less for light tasks). The system prompt, with the App
  context, stays the same text, so provider prompt caching keeps working; the block itself is deterministic (same
  project, same task, same text), so cached answers still match. **What the AI reads** on an issue or epic note shows
  the exact block. Turn it off per project in **Brain settings**.
- **Code jobs.** Jobs on this computer get the block in their prompt and the notes as files in the worktree's
  `.ticketforge/brain/` folder (with a README listing them); that folder is never staged or committed. Jobs on GitHub
  Actions get the block in their (encrypted) prompt.
- **Obsidian.** **Download for Obsidian** gives a zip: unzip it and choose *Open folder as vault* (folders per type,
  frontmatter, wikilinks, `Index.md`). **Import Obsidian notes** takes `.md` files or a vault `.zip`: notes become your
  own (frontmatter and `#tags` kept; notes TicketForge wrote, `origin: ticketforge`, are skipped because they come back
  on their own).
- **Folder sync (on this computer only).** When TicketForge is opened at localhost (never on the hosted or SaaS app),
  **Brain settings → Sync with a folder** keeps a folder, such as one inside your Obsidian vault, in step: generated
  notes are written to it; your notes go both ways (the side that changed since the last sync wins; when both changed,
  the newer one), new files become notes, and deletions on one side since the last sync are applied to the other.
- **Permissions and data.** Reading needs access to the project; writing and importing notes needs *Edit issues* or
  *Edit project settings*; downloading needs *Export*; folder sync and the settings need *Edit project settings*. Notes
  are stored in `brain_notes` and `brain_state` (created automatically) per project, with the same row-level security
  as issues: project access, and the restrictive workspace policy (`tfw_tenant`). The owner can lock the feature in
  **Administration → Features → Project brain**, which also stops adding notes to prompts.

## Top bar and searchable dropdowns

- **Top bar**, left to right: TicketForge, Projects and Administration, the project you're in (switch project);
  **search** (⌘K / Ctrl+K: issues and epics by key or summary in a project, projects elsewhere; ↑↓ and Enter) and
  **Create**; the project's save state, undo, redo and export; the **AI menu** (which AI is connected, a backup and why,
  *Runs on* for your next AI actions, check the connection again, AI settings); notifications; your account (with the
  light/dark theme). On a phone it keeps the icons only, and the search opens across the bar.
- **Dropdowns with 8 or more choices** open with a search box: type to narrow the list, ↓ to move into it, Enter to pick
  the first match. Shorter ones stay a plain list; `searchable` on `SF` forces it on or off.
