# AI agents and code

Agents, writing code with AI, and the repository and GitHub connections. Back to the [documentation index](../README.md).

## On this page

- [Agents](#agents)
- [Code with AI and pull requests](#code-with-ai-and-pull-requests)
- [Pull requests (Development panel)](#pull-requests-development-panel)
- [Separate backend repository](#separate-backend-repository)
- [Development order](#development-order)
- [Coding several issues at once without conflicts](#coding-several-issues-at-once-without-conflicts)
- [Decisions with Jev (optional)](#decisions-with-jev-optional)
- [AI flow (Administration → AI → AI flow)](#ai-flow-administration--ai--ai-flow)
- [Custom agents](#custom-agents)
- [Find built features: from the code](#find-built-features-from-the-code)

## Agents

TicketForge has one agent per job in the feature lifecycle (`lib/agents.ts`), shown in **Administration → Agents**:

| Phase | Agent | What it does | Works in |
| --- | --- | --- | --- |
| Prepare | Epic | Creates the epic for JIRA from the epic and its issues | Documents |
| Plan | Test Plan · Working Tickets · Kick Off | Test cases, sized tickets, kick-off notes | Documents |
| Build | **Build a Ticket** | Plans, codes and unit-tests one issue; runs the check command | Own git worktree |
| Build | **Feature Tests** | Turns the issue’s test cases into automated tests and runs them | Own git worktree |
| Build | Feature Verification | Manual / browser test runs | Documents |
| Review | **Review a Pull Request** | Reviews the job’s diff against the acceptance criteria; never edits | Repo, read-only |
| Release | Demo · Sign-Off · Deploy · Release Certification | Guided release steps (a person deploys) | Documents / worktree |
| Plan | UX Design Spec (UI/UX) | User flows, screens, copy, every state, accessibility and responsive rules | Documents |
| Build | **Frontend Developer** (Coding) | Builds screens and components with every state, accessible and responsive | Own git worktree |
| Build | **Backend Developer** (Coding) | Builds APIs, data, migrations and business rules with tests | Own git worktree |
| Build | **Fix a Bug** (Coding) | Failing test first, root cause, smallest fix | Own git worktree |
| Build | **Test Automation** (Automation) | End-to-end tests in the repo (Playwright or the repo's framework) | Own git worktree |
| Build | Automation Scripts (Automation) | Rewrites and runs TicketForge's browser scripts for the epic's test cases | Documents |
| Review | **UI/UX Review** (UI/UX) | Audits usability, accessibility, states, copy and layout; never edits | Repo, read-only |
| General | **Free Worker** | Any task you describe, same safety rules as Build | Own git worktree |

**Hiring agents.** Every agent can be hired: use **Hire** on a card in Administration → Agents and pick the project
and epic. (Epic and issue panels don't list agents.) Working Tickets, Test Plan and Feature Verification
run TicketForge's existing writers with the agent's instructions. Epic, Kick Off, Demo, Sign-Off and Manual, Deploy,
Release Certification and Review a Submission write a Markdown document from the epic, its issues, test
results and pull requests, saved on the epic (`lib/agentdocs.ts`). Code agents ask which issue to work on. In the code
window, **Review panel** runs three Review agents in parallel (correctness, security, tests & acceptance).

The agents in bold run as real Claude Code agents: TicketForge passes them to
`claude -p --agents <json> --agent <id>`, so each one gets its own system prompt and an enforced tool list, and Build
can delegate to Feature Tests and Review as subagents. Follow-up rounds resume the same Claude Code session
(`--resume`), so the agent keeps its context. Administrators can turn each agent off and set its model, effort and
extra instructions; a project’s model in Code & GitHub overrides the agent’s for jobs in that project.

### Repository: your GitHub repositories, a Git URL, or a local folder

Project settings → Code & GitHub is organised top to bottom:

1. **GitHub account**: how TicketForge signs in to GitHub. **Connect GitHub** (sign in with your account through
   GitHub's device flow: copy a short code, approve it on github.com/login/device), or it uses your `gh` sign-in on
   this computer, `GITHUB_TOKEN`, or a personal access token (*Use a personal access token instead*). The token is
   stored encrypted and used for cloning, pushing, pull requests and GitHub Actions. **Disconnect** forgets it.
   One-time setup for Connect GitHub: an administrator creates a GitHub **OAuth App** (Settings → Developer settings →
   OAuth Apps), ticks **Enable Device Flow**, and pastes its Client ID in the Connect GitHub dialog (or sets
   `TICKETFORGE_GITHUB_CLIENT_ID`). No client secret is needed.
2. **Repository**: a summary of the repository in use (name, *Cloned by TicketForge* or *Local folder*, path, default
   branch, current branch, uncommitted changes) with **Update** (clones) or **Check** (folders) and **Change**. To set or
   change it, pick a source:
   - **Your GitHub repositories**: choose from every repository your sign-in can see (personal and organisations),
     searchable; TicketForge clones it.
   - **Git URL**: any https or SSH URL, or `owner/name`, with an optional branch; TicketForge clones it into its data
     folder (`data/repos/`). Tokens are passed per command and never written into the clone; SSH URLs use your keys.
   - **Folder on this computer**: a clone you already have (Browse… or type the path).
   A new repository replaces the old one's name and base branch. Below it: **Branches and pull requests** (base
   branch, branch prefix, Claude model, draft pull requests) and **Advanced** (the GitHub owner/name, found
   automatically).
3. **Coding agent**, the **Backend repository** (same three sources) and **CodeRabbit**.

### Import and sync GitHub issues (TF-130)

Project settings → Code & GitHub → **GitHub issues** links a GitHub repository to the project and brings its issues in
as tickets. It signs in to GitHub with the project's existing GitHub connection (Connect GitHub, a saved token or
`GITHUB_TOKEN`: connect GitHub under Repository setup first). Only the **project owner** (its creator) and the **Super
Admin** (the workspace owner) can link a repository, import or sync; everyone else sees the link, and the buttons are
disabled with a permission message (the server refuses as well).

- **Link repository** takes `owner/name` (or a github.com address), checks that the connected account can open it and
  saves it on the project (`githubSync`).
- **Import issues** reads every issue (pull requests are skipped; at most 2000 per run) and creates a ticket for each. A
  ticket keeps its GitHub issue as an external key (`ticket.github`: repository and issue number), so importing again
  updates the same ticket instead of creating a duplicate. Mapping: title → title, body → description, labels →
  labels, assignee → assignee (a project member with the same name, otherwise the GitHub login), milestone → epic (an
  epic with that name is created when the project has none), open → the first workflow status, closed → the first
  "done" status.
- **Sync now** does the same and also writes Ticket Forge's changes (title, description, labels, assignee, status) to
  GitHub. A field changed on only one side since the last sync is copied across. When both sides changed it, **the newer
  change wins** (GitHub's *updated* time against the ticket's *updated* time; a tie goes to GitHub) and the ticket's
  activity gets a *Sync conflict* entry that says which side won and what the other value was. Milestones are read-only:
  a changed epic isn't written back.
- Sync runs when someone presses a button (there is no webhook or timer yet). Issues deleted or transferred in GitHub
  leave their tickets as they are. GitHub's rate limit stops the run with a message that says when to try again.

### Live GitHub Issues and Projects (TF-140)

Project settings → Code & GitHub also has an **Issues** and a **Projects** section. Each reads from the GitHub API
every time it opens (and on **Refresh**); nothing is copied into the project. They are read-only: creating or editing
GitHub issues and Projects from Ticket Forge is a follow-up.

- **Issues** lists the repository's most recent issues (up to 100, pull requests left out). **Projects** lists the open
  GitHub Projects of the repository and its owner (GraphQL API; the token needs Projects access).
- Both lists show 10 items per page with **Previous** / **Next** and a "Page n of m" indicator (TF-144). The pages are
  cut from the one load, so paging makes no extra GitHub request, and a load or **Refresh** starts again at page 1.
  On phones and tablets the page controls wrap under the list and the buttons stay at least 40px tall.
- The repository is the one chosen under **Repository** (else the one linked under GitHub issues). The sign-in is the
  project's existing GitHub connection (a saved token, else `GITHUB_TOKEN`, which every project shares).
- Only people whose custom role has **Set up the repository** (`project.repo`, the permission that opens Code & GitHub)
  see the sections; `GET /api/projects/:id/github-live?section=issues|projects` refuses everyone else (403).
- Without a GitHub connection both sections say to connect GitHub in admin settings and show no data. If GitHub fails
  the section shows an error with **Try again**; the earlier list is cleared before each load, never shown as current.
  A repository with no GitHub Projects shows an empty state.
- Administration → **GitHub** shows whether the workspace has a GitHub connection (`GET /api/admin/github`; never the
  token).

### GitHub connection and repository (TF-142)

Project settings → Code & GitHub starts with a **GitHub connection and repository** card. It is stored in two tables
(`github_connections`, `github_repo_links`; created by the schema in `lib/db/schema.ts`, with row-level security), so
it is the same after a reload. The token stays encrypted in the project's secrets and is never stored in these tables
or sent to the browser.

- **Status**: *Connected* (with the GitHub account), *Not connected* or *Error*. Each time the tab opens (and on
  **Refresh**) the sign-in is checked with GitHub, so a revoked or failing connection shows as an error with **Try
  again**, **Reconnect GitHub** and **Disconnect**.
- **Connect GitHub** (device sign-in or a personal access token) and **Disconnect** work as under *GitHub account*
  below, but need only the **Set up the repository** permission (`project.repo`).
- **Linked repository**: choose, change or clear the project's repository from the list of repositories the
  connection can access (searchable), then **Save repository**. The server refuses a repository that is not in that
  list. A GitHub error never clears the saved choice. The Issues and Projects sections read this repository first.
- Only people whose custom role has `project.repo` see the card's controls; everyone else gets a note and no actions
  (`GET`/`POST /api/projects/:id/github-link` answer 403).

### My AI: each person's own Claude subscription

Your avatar → **My AI** lets each person add **their own** Claude Pro/Max subscription token (`claude setup-token`,
`sk-ant-oat01-…`). It's stored encrypted in `user_ai`, readable only by that person (row-level security), never sent to
the browser (only its last 4 characters), and never used for anyone else's requests.

- **Your AI requests** run on your subscription first (Claude Code with your token). If it isn't available (usage
  limit, expired token), they use the team's AI from Administration → AI, unless you turn that off, in which case they
  stop with the reason.
- **Your code jobs** on the deployed TicketForge use the workspace's AI provider (Administration → AI), not your Claude
  subscription: a subscription token only works inside Claude Code, which runs on your computer.
- Using it for TicketForge's AI features needs Claude Code installed where TicketForge runs (your computer or a VPS);
  on serverless hosting it can't be used.
- The admin-level **Claude subscription, shared with everyone** provider still exists for one plan used by all.

### Claude subscription as an AI provider

Administration → AI → **Add provider** → **Claude subscription (Claude Code)** uses your Claude Pro/Max plan instead
of a billed API: TicketForge runs the real Claude Code on the server, signed in with a token from `claude setup-token`
(`sk-ant-oat01-…`, stored encrypted; or `CLAUDE_CODE_OAUTH_TOKEN` in the environment). Put it first to use it before
the APIs; when the plan's usage limit is reached, TicketForge moves to the next provider until it resets. It needs
Claude Code installed where TicketForge runs (your computer or a VPS); serverless hosting such as Vercel can't run
it. A subscription token is refused as an Anthropic API key, and an API key as a subscription token. The plan is
meant for your own use: for a whole team, use a team plan or an API.

### Code jobs on the deployed TicketForge (AI API + GitHub)

**Where code jobs and test runs go.** On your computer (localhost) code jobs run on this computer by default: Claude
Code next to your checkout, and Playwright in a local browser. The deployed TicketForge (Vercel, or opened from another
computer) has no checkout and no Claude Code, so **Write code with AI** asks your AI provider for the change and commits
it through the GitHub API. **No GitHub Actions workflow and no Claude Code on a server are needed for code jobs.** (Test
runs on the deployed app still use GitHub Actions.) A project on your computer can choose the API too: Project settings
→ Code & GitHub → **Where code jobs run**. The choice is yours, remembered in your browser, not saved in the project.

1. **Repository**: choose one of your GitHub repositories (or paste its URL / `owner/name`) and connect GitHub with
   write access (Contents and Pull requests). Nothing is cloned on the server.
2. **An AI provider** in Administration → AI (an API key; routing uses the *Coding agents* task, High tier by default).
3. **Write code with AI** (also bulk coding and Build both at once): TicketForge reads the repository's file list on
   GitHub, the AI picks the files that matter for the issue, then returns the change as exact edits (`find` / `replace`),
   new files and deletions, in the chosen agent's own instructions and with the issue, brain and repository profile as
   context. Every edit is checked against the file (the text to replace must appear exactly once; a failed edit is sent
   back to the AI once to correct) and the result is committed to the issue's branch with the Git Data API. The diff
   and summary appear in the code window like a local job. **Ask for changes** adds another commit to the same branch;
   **Open pull request** opens it as you; **Discard** deletes the branch; **Stop** commits nothing more.

Limits to know: the AI cannot run your tests, build or linter (review the diff and use the pull request's checks), and
it sees up to about 16 files and 220 KB of code per round, so large cross-cutting changes work better on your computer.
It never changes `.github/workflows`, `.env` files or lock files. A round runs after the response is sent and can take up
to 5 minutes (Vercel's limit); a round that goes quiet for 8 minutes is marked failed. Jobs are kept in the database
(`code_jobs`), so they survive serverless restarts. Jobs started on GitHub Actions in an earlier version can't continue:
start a new job. Reviews, CodeRabbit and committing locally need TicketForge on your computer.

**GitHub access: only the deployed app needs it.** On your computer, cloning a repository, pushing branches and opening
pull requests use your own git setup (an SSH key, your credential helper or `gh auth login`), so Project settings →
Code & GitHub works without connecting GitHub or saving a token. The *GitHub account* card there is optional on your
computer: connect it only to pick from your list of GitHub repositories, or if git can't sign in. The deployed
TicketForge has no git sign-in, so it needs the connection (or a token) to read the repository and push the branch.

**Trying hosted mode on your own computer.** With `TICKETFORGE_MODE=saas` in `.env`, TicketForge treats every request as
deployed, even at `localhost`, so the repository source *Folder on this computer*, cloning and Claude Code agents are
off (a visitor can send any `Host` header to a public server, so hosted mode never trusts it). To use them while
testing billing on your own computer, add `TICKETFORGE_ALLOW_LOCAL=1` to `.env` and restart: it is honoured only for
requests that come from this computer to `localhost`, with no other address passed on by a proxy. Never set it on a
server. Project settings → Code & GitHub says so when this is why folders are unavailable.

**Everyone sets up their own local copy.** The project shares *which* repository it is (name, provider, base branch,
branch prefix, conventions: the project settings permission), but the folder on disk belongs to each person: a
teammate's path doesn't exist on your computer. In Project settings → Code & GitHub anyone with access to the project
can choose a **Git URL** (cloned for them) or a **Folder on this computer**, and it is saved just for them (in their
preferences, `user_prefs`), per project and per side (frontend or backend). Code jobs, learning the repository, test
selection and the other features that read the code use your folder. If you haven't set one, the project's older shared
folder is used only when it exists on your computer; otherwise you are asked to set up your own. It works only when
TicketForge runs on your computer (opened at localhost).

### Code that follows your repository

- **Learn from repository** (Project settings → Code & GitHub → Coding agent, and the backend repository card): a
  read-only Claude Code agent reads the checkout (it can't change files) and writes the **Repository profile**: stack
  and versions, where each kind of code lives, how one or two real features are built end to end, conventions,
  data and migrations, tests, commands, what to reuse, and rules from the README / CONTRIBUTING / CLAUDE.md. You can
  view, edit, download or clear it, and learn again after big changes (it records the commit it learned).
- Every code job (and code review) gets the profile with its task, together with the issue, sub-tasks and epic, so new code is built the way the repository already works.
- **Repo-native Builder** (Create agent → Start from a template, or the button on an empty Agents page): a code agent
  that reads the profile, finds the closest existing feature and uses it as the pattern (file placement, names,
  libraries, data access, errors, tests), reuses existing helpers, adds no new dependencies unless needed, and says in
  its summary which feature it followed and where it had to do something different.

### Your own agents instead of the built-in ones

- **Built-in agents** (Administration → Agents) lists TicketForge's agents: remove any of them, or all at once with
  **Remove all built-in agents**. Removed agents leave the catalog and every picker; restore them at any time. Document
  features (test cases, agent documents…) keep working from the epic; testing agents that are removed
  are simply off in test runs.
- **Create agent**: describe it and the AI writes its rules, write the Markdown yourself, import a `.md` file, or
  **start from a template**, including any built-in agent (also from a built-in agent's details: **Copy as custom
  agent**), so you keep its rules and change what you want. The frontmatter takes `name`, `description`, `runner`
  (`code` edits in a worktree, `review` read-only, `document` writes for an epic), `model`, `effort` and `icon`.
- **Default agents** choose who does each job when nobody picks one: **Write code**, the **Frontend** and **Backend**
  repositories, and **Review changes**. *Automatic* uses the built-in agent while it's there, otherwise your first
  custom agent of the right kind (edits code / read-only). Write code with AI, bulk coding, Build both at once,
  follow-ups, pull request updates and reviews all use them. Without any code agent, the code window says to create one.
- Custom review agents also appear as extra review buttons on a code job and as reviewers for pull requests.

## Code with AI and pull requests

**Code jobs page** (top bar → *Code jobs*, `/code-jobs`; inside a project it is *Development → Code jobs*, with that project's jobs only, and the *Code jobs* button on the Pull requests page goes there): every code generation in your workspace's projects, on
this computer and through the AI API, in one list that updates live (every few seconds while something runs). It shows
counts of what's working, waiting, ready for review, shipped and needing attention, filters (*Running now*, *Ready
for review*, *All recent*), a project filter and search. Each job can be stopped, opened to review its changes (the
issue opens with its code job), or followed to its branch and pull request on GitHub. You only see projects you
have access to.

**Diff review.** A job's **Changes** button on the Code jobs page, and the expanded row of its pull request on the Pull
requests page, show what the AI changed as a side-by-side diff (added and removed lines highlighted) with a file list.
Everyone who can open the project sees it; no special role is needed. Choose what to compare with: the *Repository
default branch*, the *Previous job run* for the same issue, or the *Prior spec version* (specs keep no history, so this is
the last run made before the current spec was generated). The active comparison is shown above the diff, and *No changes*
appears when there is nothing different. The diff is always side by side: on narrow screens it scrolls sideways. The file
list sits beside the diff on desktop (1024px and up) and above it on tablet and phone, like the sidenav breakpoints, and
the chosen comparison is kept while the window is resized. Nothing can be edited or committed from it.

**Approve and merge.** The issue's **Write code** window is now a large, responsive dialog whose **Changes** tab is this
same diff (line numbers, added and removed lines marked, long lines scroll inside the panel). For code jobs that run
through the AI API and GitHub, any member who can open the project can **Approve** the code (recorded on the job in
`code_jobs.data` with their name, once per member; the person who started the job may approve too). The project asks for
a number of approvals (**Project settings → Code & GitHub → Approvals needed to merge**, 1 to 10, default 1). When the
pull request is open, **Approve and merge** records your approval and merges the pull request on GitHub once there are
enough; otherwise nothing is merged and you see, for example, *Approved 1 of 2. 1 more approval needed*. A draft pull
request is marked ready for review first. Asking the agent for more changes clears the approvals. After the merge the job
and the issue show the code as **Merged**. An issue that already has finished code (ready for review, pull request open,
merged or committed) has **Write code with AI** disabled and a **View code** button instead; the server also refuses to
start a second job for it (discard the code first to start over). Local jobs (Claude Code on this computer) have no
approval step.

**Done on code completion.** When a code job finishes with code for an issue (ready for review, committed or in a
pull request) while the project is open, the issue moves to the workflow's *Done* status by itself, from any status
including custom ones, with no approval step. An issue that is already done stays done, and an issue whose job failed,
was stopped or is still running keeps its status. If the change can't be saved (for example the server is unreachable)
the issue keeps its old status and an error is shown. It needs the *Edit issues* permission.

Set up once per project in **Project settings → Code & GitHub**:
- **Local folder**: a clone of the project's GitHub repository on the computer running TicketForge. **Browse…** opens a
  folder picker (Home, Desktop, Documents…; git repositories are marked) and checks the folder you choose. You can
  also type it: `~/code/app`, or `/desktop/app`, which is read as `~/Desktop/app`. **Check** confirms it's a git
  repository and fills in the GitHub repository and base branch from it.
- **Branch prefix** (default `tf/`), **Claude model**, **Open pull requests as drafts**.
- **Check command** (optional, e.g. `npm test`): the only command the agent may run, to check its work.
- **Team conventions**: how your team writes code, given to the agent every time.
- **GitHub access**: a token saved for the project (encrypted; fine-grained tokens need Contents and Pull requests
  read/write), `GITHUB_TOKEN` on the server, or your `gh` CLI sign-in.

Then code is written from the project's **Code jobs** page (Development → Code jobs), in its **Coding** section. The
issue panel no longer has a Write code button; it shows **View code** once an issue has code.
- Pick a **feature (epic)** (or all features, or tickets without one). Its tickets are listed with priority, points,
  acceptance criteria, layer, coding spec (draft or ready, with its files) and coding state (not coded, coding, code
  ready, PR open, merged), with a progress bar for the feature. Done and already-coded tickets hide unless you tick
  **Show done tickets**; **Find a ticket** filters the list.
- **Per ticket**: **Write code** (or **Retry**, **Watch**, **Review**, **View code**) opens the ticket's code panel,
  where the steps below happen (start, review, pull request).
- **Per feature**: tick tickets and choose **Write code for N selected**, or **Write code for all N**. It opens the bulk
  dialog, which first checks for tickets that touch the same code and splits them into rounds (see
  [Coding several issues at once without conflicts](#coding-several-issues-at-once-without-conflicts)).
  **Development order** sits beside it.
- The section can be collapsed, and remembers the feature you picked (this browser only).

The Development order dialog's **Write code** and the epic's **Write code for epic** open the same panels. An issue picked
from an epic's code agent still opens the Code jobs page in a new tab with its prompt (**Start writing code** there opens
its code panel; **Code a whole feature…** leads to the Coding section).
1. TicketForge creates a branch (`tf/pay-12-short-title`) from the base branch in its **own git worktree**, so your
   checkout and uncommitted work are never touched.
2. Claude Code (your account) implements the issue from its story, acceptance criteria and test cases, plus any
   extra instructions. You watch its steps live; it can read and edit files and run the check command, but it can't
   commit, push or browse the web. It runs in the background, so you can close the dialog.
3. Review: its summary and the diff of every file. **Ask for changes** runs another round on the same branch.
4. **Commit, push and open PR**: one commit (title, story, "Refs PAY-12" and a link back), the branch is pushed with
   the token for that command only (never written to the repository's config), and the pull request opens with the
   story, an acceptance-criteria checklist and the agent's summary. It's linked to the issue automatically.
   **Discard** removes the worktree and local branch instead.

Writing code needs TicketForge running on your computer (opened at localhost); on a deployed server the settings can
be edited but code can't be written. Jobs are kept in memory: if the server restarts, start the job again.

## Pull requests (Development panel)

In an issue, **Link pull request** and paste a GitHub, GitLab or Bitbucket URL. For GitHub the app reads the
title, status (Open, Draft, Merged, Declined), branch and author through the GitHub CLI (`gh`) when it is signed
in, which also covers private repositories, or the public GitHub API otherwise. **Refresh** re-checks the status
and records changes in the issue's history. GitLab and Bitbucket links are stored with the repository and
number parsed from the URL.

## Separate backend repository

Project settings → Code & GitHub → **Backend repository**: tick "This project has a separate backend repository", pick its local folder and click **Check**. Check finds where the repository is hosted.

- **Issues** have an **Implementation** field: Frontend, Backend or Frontend + Backend. It shows as FE / BE / FE+BE in the backlog.
  - The AI fills it when it writes issues.
  - **Mark unmarked with AI** in the same card fills it for existing issues. ⌘Z undoes it.
- **Write code with AI** shows **Frontend** and **Backend** tabs, one job per repository. Each agent is told which half of the app it is in, and the backend agent lists the APIs it added.
- A Frontend + Backend issue starts on Backend. The frontend job then receives the backend job's summary, so it builds on the real API.
- **Many issues at once**: select issues in the backlog and choose **Write code with AI**. Each issue gets its own
  branch, worktree and agent (Frontend + Backend issues get an API contract and a job in each repository). Up to 3 agents
  run at the same time; the rest wait in line (set `TICKETFORGE_CODE_PARALLEL`, 1 to 10, to change it). **Code jobs**
  (on the Pull requests page) shows every job live: running, waiting, ready for review, with changes and cost; click
  one to review it. A waiting job can be removed from the line, a running one stopped.
- **CodeRabbit review**: after an agent finishes, **🐇 CodeRabbit review** runs the CodeRabbit CLI
  (`coderabbit review --agent --uncommitted`) on the job's changes in the background (reviews can take several minutes).
  Findings show in the job's **CodeRabbit** tab by severity (critical, major, minor, trivial, info) with file, lines and
  fix instructions. For each one: **Fix with agent** (sends its fix instructions to the Build agent as a new round),
  **File as bug** (a Bug issue with the location and fix, priority from the severity, labelled `coderabbit`, linked to
  the issue), or **Dismiss**; or fix / file all critical and major findings at once. Findings and their status are
  saved on the issue, and **Reports → Code review findings** counts them by status, severity and file, with the open
  ones listed. Setup: install the CLI (`brew install coderabbit`) and run `coderabbit auth login` once, or save an
  Agentic API key in Project settings → Code & GitHub → CodeRabbit (encrypted). `CODERABBIT_BIN` points to another
  binary.
- **CodeRabbit on pull requests**: if CodeRabbit's app reviews your repositories, **🐇 CodeRabbit** on a linked pull
  request (issue panel → Development, or the Pull requests page) reads its review comments from GitHub or GitLab as
  findings: severity, category, file and lines, the comment with its suggested diff, and the "Prompt for AI Agents" fix
  instructions. Resolved threads show as *Resolved on PR* and outdated ones are flagged. The same actions apply: **Fix
  with agent** starts a round on the pull request's own branch (open requests only), **File as bug**, **Dismiss**. Reading
  again keeps each finding's status. The issue shows the open counts, and Reports includes these findings too. Private
  repositories use the project's GitHub token or `gh` sign-in, or the GitLab token.
- **Build both at once** (faster): for a Frontend + Backend issue, TicketForge first agrees a short API contract from the
  issue (a few seconds), then runs the backend and frontend agents in parallel, each told to implement or call exactly
  that contract. The contract shows in the panel. It takes about half the time of one after the other.
- Speed: the coding agents (Build, Frontend, Backend, Fix a Bug) default to Sonnet at medium effort; Review stays
  on Opus. Change either in Administration → Agents. Each job's worktree links the installed
  dependencies (node_modules, vendor, .venv) from your checkout, so the check command runs without installing.
- **Pull requests from either repository:** "Commit, push and open PR/MR" opens a **GitHub pull request** or a **GitLab merge request** (gitlab.com or self-hosted), depending on the repository's origin.
  - GitLab needs an access token (scopes `api` and `write_repository`), saved in the Backend card or set as `GITLAB_TOKEN`.
  - Without a token, the branch is pushed with your own git sign-in and you get a link that opens the merge request on GitLab.
  - **Commit locally only** commits the changes on the branch without pushing.

## Development order

**Development order** (an epic's panel, or a sprint's header in the backlog) shows the order to build the open issues in,
with a short reason per issue, and **Apply to backlog order** moves them into it. Only those issues move, within the
places they hold in the backlog now, and the change is saved (and undone) like any reorder. How it orders
(`lib/devorder.ts`):

1. **Links decide first.** An issue that *is blocked by* another listed issue comes after it. Open blockers outside the
   list push an issue down; links that block each other are named so you can fix them.
2. **Among the issues free to start**: priority, how many other issues wait on it (directly or not), backend before the
   screens that use it (when the list has frontend work), smaller story points first, and the current backlog order on ties.
3. **Hints, with Use Jev / AI hints** (on by default, needs *Use AI*): Jev, when it is on, answers per issue which other
   issue it needs first and how early to build it; issues it isn't sure about go to your AI in one call; when the AI fails
   too, the rules above decide alone. A suggested prerequisite never overrides a link and is dropped when it would make
   a loop. The reason line says where each hint came from ("Jev: builds on it").

**Writing the code from it** (needs *Use AI*, *Edit issues* and Write code with AI set up): each issue in the list has
**Write code** (or **View code** when its code is finished), which opens that issue's code job right in the app, and
**Write code for all N** starts the whole epic or sprint at once through the bulk dialog, with the conflict check and rounds
below. The epic panel also has **Write code for epic** for its open issues that have no finished code yet.

API: `POST /api/projects/:id/devorder` with `{ epicId | sprintId | ticketIds, smart }`. Nothing is saved there.

## Coding several issues at once without conflicts

When you select issues in the backlog and choose **Write code with AI**, the dialog first checks them
(`lib/parallel.ts`, `POST /api/projects/:id/code` with `action: "plan-parallel"`; nothing starts) and flags:

- **Same file / same module**: their coding specs (Coding specs on the epic) list the same file or module. This is
  `findOverlaps` from `lib/specs.ts`, with every selected issue compared as one batch, whatever its epic.
- **Busy**: another issue's code job is running or waiting, or its finished code isn't merged, and touches the same files
  (its changed files, or its spec while it runs).
- **Blocked**: an issue is blocked by another selected issue, so it waits for that one's code.
- **Likely**: an issue has no coding spec, and Jev (or the AI) expects it to edit the same code as another selected issue.

It then splits the issues into rounds, in development order: round 1 can be coded together now, each later round after
the one before it. **Start the N safe now** starts round 1 only; **Start all** starts everything anyway (the queue still
runs `TICKETFORGE_CODE_PARALLEL` jobs at once). Module overlaps that Jev or the AI judges to be separate files are shown
but don't hold an issue back. With Jev off, the AI answers; when the AI fails or *Use AI* is missing, the rules decide
(a shared module is a conflict, issues without a spec are listed as unchecked).

## Decisions with Jev (optional)

[Jev](https://docs.typesafe.ai) (TypeSafe AI, early access) is a fast model for decisions: you give it the state of something
and questions (pick one of up to 255 options, rate 0-9, yes/no) and it returns typed answers with calibrated probabilities
in a few hundred milliseconds, at a fraction of a general AI's price. It can't write text, so TicketForge uses it only for
small classification calls, **when an owner turns it on** in Administration → AI → **Decisions**:

- **Frontend, backend or both** for each issue (`lib/layers.ts`): one call per 25 issues.
- **Which automated tests are worth running** (`lib/testselect.ts`): a yes/no per test, ranked, up to the budget.
- **Development order** (`lib/devorder.ts`): per issue, which other issue it needs first (pick one) and how early to
  build it (0-9). See [Development order](#development-order).
- **Coding several issues at once** (`lib/parallel.ts`): for issues without a coding spec, which other selected issue
  will edit the same code (pick one); for issues that share only a module, whether they edit the same files (yes/no).
  See [Coding several issues at once without conflicts](#coding-several-issues-at-once-without-conflicts).

Anything Jev isn't sure about (below the confidence you choose, 60% by default), and every call when it is off,
unreachable, or answers an error, goes to your AI as before, so turning it on never makes these features fail. Setup: paste
the API key from console.typesafe.ai → Keys (stored encrypted per workspace and never sent back; `TYPESAFE_API_KEY` works
too), turn it on, and use **Test the connection**. `TICKETFORGE_JEV_URL` points tests at a stand-in server. The titles,
descriptions and test names being decided are sent to TypeSafe, so check their terms first. Client: `lib/jev.ts`
(`POST https://api.typesafe.ai/v1/systemone`, `jev-latest`, retries 429/529 twice).

## AI flow (Administration → AI → AI flow)

The AI settings as a canvas of nodes, like n8n. Left to right: **tasks** (grouped) → **tiers** (High, Standard, Light, and
your AI configurations) → the **router** → your **providers**, chained in fallback order.

- **Route a task:** drag from the dot beside a task onto a tier or a configuration. Click a wire and press Delete (or the ×)
  to put the task back on its default tier.
- **Set the fallback order:** drag a provider's bottom dot onto another provider: that one is tried next, after it. The
  Claude account and Copilot (on your own computer) always go first; providers set with environment variables come last.
- **Click a node** for its details: status, Test connection, Edit, Remove, and the model it uses for each tier. The
  router has the Model routing and fallback switches. Wires are saved as you make them; model edits have a Save bar.
- **Move around:** drag the background to pan, Ctrl/⌘ + scroll or pinch to zoom, drag nodes to arrange them (kept in your
  browser), ⤢ fits everything, ⛶ goes full screen. On phones the details open as a bottom sheet.

It reads and writes the same settings as Model routing, Models per tier and Providers, which stay available.

## Custom agents

Administration → Agents → **Create agent**. Describe what the agent should do and the AI writes its Markdown rules, or paste or import a `.md` file in the Claude Code agent format:
- a frontmatter block: `name`, `description`, `runner` (`code`, `review` or `document`), and optionally `model` and `icon`;
- then the instructions.

Where custom agents run:
- **Code** agents appear in Write code with AI.
- **Review** agents appear in Pull requests → Review with AI.
- **Document** agents are hired for an epic.

The lifecycle document agents nothing used any more were removed (Epic, Kick Off, UX Design, Demo, Sign-Off, Deploy, Release Certification, Review a Submission, Automation Scripts).

## Find built features: from the code

Test automation → **Find built features** works from the **code**. Without AI, it first takes an inventory of:
- every page's headings, actions, fields, links and API calls;
- the API endpoints (Next.js, Express, Fastify, Hono, NestJS, Laravel, Django);
- the data models (Prisma, Drizzle, TypeORM, Sequelize, Mongoose, SQL migrations, Django), also from the **backend repository** when one is set.

The AI groups that into epics and features, and writes each feature's tickets from its pages' code: real labels, fields, rules and endpoints.

Git history and `.md` documents (release notes, feature notes) are hints for naming only. Every feature must cite code that exists in the repository. Anything only the documents mention is listed separately as **not found in the code** and is never added, and existing issues are only marked Done when the code proves it. The code is in `lib/codeinventory.ts`.
