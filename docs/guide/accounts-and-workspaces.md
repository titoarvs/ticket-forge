# Accounts and workspaces

People, roles, workspaces, the public site and feature flags. Back to the [documentation index](../README.md).

## On this page

- [Accounts, invites and permissions](#accounts-invites-and-permissions)
- [Workspaces (one TicketForge, many companies)](#workspaces-one-ticketforge-many-companies)
- [Public site, legal pages, sign-up and the guided tour](#public-site-legal-pages-sign-up-and-the-guided-tour)
- [Feature flags (Administration → Features, owner only)](#feature-flags-administration--features-owner-only)
- [Google Drive storage (Administration → Google Drive, owner only, behind the "Google Drive storage" feature)](#google-drive-storage-administration--google-drive-owner-only-behind-the-google-drive-storage-feature)

## Accounts, invites and permissions

- **Owner**: created on first run. Always has every permission and can't be removed or demoted.
- **Invite people**: Administration → **Invite people** (or the account menu). Enter one or more emails, pick a
  role, and choose **All projects** or **Only selected projects**. Each person gets an email with a one-time link
  (valid 7 days); the link is also shown for you to copy, which is all you get if email isn't configured.
  Pending invites can be resent (new link) or revoked.
- **Roles & permissions**: Administration → **Roles & permissions** is a grid of roles × permissions. Tick
  boxes to change what a role can do; create roles (optionally starting from another role's permissions),
  rename or delete them. Starter roles: Administrator (locked, everything), Project lead, Team member,
  QA tester and Viewer.
- **Permissions**: create/import projects, edit project settings, delete projects, create issues, edit
  issues, delete issues, comment, manage sprints, manage epics, use Claude, run test automation, export, and
  manage users & access.
- **Users**: change someone's role or project access, send a password-reset link, disable (signs them out
  everywhere) or remove them.
- **Enforcement**: every request is checked on the server. Saves are sent as patches of what changed and
  rejected if they touch anything the role doesn't allow; comment authors are set by the server. The UI hides
  or disables what you can't use.
- **Working together**: issues are stored individually, so people editing different issues never overwrite
  each other, and teammates' changes appear within about 10 seconds.
- **Your account**: the avatar menu (top right) has your account, password change and log out. Forgot your
  password? Use the link on the sign-in page.

## Workspaces (one TicketForge, many companies)

Each company works in its own **workspace**: its own projects, people, roles, invites, AI providers and agents,
feature flags, generation rules and templates, AI usage and budget, and test-run screenshots. People have one login
and can belong to several workspaces; their role, project access and owner status are per workspace.

- **Switching**: the workspace menu in the top bar lists your workspaces. Switching reloads the app, so nothing
  from the previous workspace stays on screen.
- **Creating**: on the hosted service (`TICKETFORGE_MODE=saas`) anyone signed in can create a workspace from that
  menu; self-hosted, only owners can. Open sign-up creates one for each new company.
- **Inviting someone who already has an account**: they confirm with their own password and the workspace is added
  to their login. An owner can't see a password-reset link, or rename the account, for someone who also belongs to
  other workspaces: the link goes only to that person's email.
- **Removing someone** removes them from this workspace only. An account left with no workspace is deleted.
- **Existing data**: on first start the `ws-1` migration (recorded in `schema_migrations`) creates the `default`
  workspace owned by the current owner, makes every existing account a member with the role and access it had, and
  re-keys roles per workspace. Settings of the default workspace keep their original keys in `app_meta`; other
  workspaces' settings are stored as `ws:<id>:<key>`.
- **How isolation is enforced**:
  - In the app: every query filters by the request's workspace, and every `/api/projects/<id>/…` request is
    checked against it (another workspace's project is a 404). Project ids are unique across workspaces; a taken id
    gets a new one from the server.
  - In PostgreSQL (Supabase): the request's workspace is set for each transaction (`app.workspace_id`), and
    restrictive `tfw_tenant` row-level security policies hide other workspaces' projects, issues, activity,
    versions, files, screenshots, code jobs, roles and invites even from someone with access to all projects. Users
    are visible only to themselves and their co-workers. The local database has no row-level security, so there the
    app's own checks are the protection.
- **Hosted service (SaaS) safety**:
  - AI never uses the server's own Claude sign-in. Each workspace sets up its own AI providers, or people use My AI.
  - Code jobs and repository folders never run on the server itself. Repositories connect through GitHub, and code
    jobs go through the AI API and the GitHub API.
  - Server-wide `GITHUB_TOKEN`, `GH_TOKEN` and `GITLAB_TOKEN` are ignored, and so is the server's `gh` sign-in.
  - Test runs refuse apps on private or internal addresses. This checks the address you enter, not pages a test
    script opens later, so for full protection run tests on GitHub Actions or a remote browser.
  - Server-wide AI keys (such as `ANTHROPIC_API_KEY`) are available to every workspace, and each call counts
    toward the workspace's plan (see Plans and billing).
- **Before deploying**: back up the database (`pg_dump`). Stop or upgrade every running copy of the app that uses
  the same database: an older copy re-creates the old permission functions, which don't know about workspaces.

## Public site, legal pages, sign-up and the guided tour

- **Home page**: signed-out visitors to `/` see the product page (features, how it works, pricing). Signed-in
  people go straight to `/projects` (the projects list moved there).
- **Legal pages**: `/terms`, `/privacy` and `/cookies`, written in `lib/legal/*.ts`. They are **templates** with
  placeholders such as `[Company name]`, `[Address]` and `[Contact email]`: fill them in and have them reviewed by
  qualified counsel before you rely on them. Links are in the footer of the public and sign-in pages and in the
  account menu. Fonts are served from this site (`next/font`), and there are no analytics or advertising cookies,
  so no cookie banner is needed.
- **Consent**: setup, accepting an invite and sign-up have an unticked box to accept the Terms of Use and Privacy
  Policy; the server refuses without it. Each acceptance is stored in `legal_acceptances` (document, version,
  time, IP address, browser). When you change a document, bump its version in `lib/legal/versions.ts`
  (`material: true`): everyone is asked to accept the new version the next time they open the app. Accounts made
  before consent existed are asked once too. On the hosted service (`TICKETFORGE_MODE=saas`) the prompt can't be
  put off; self-hosted, people can choose "Remind me later".
- **Sign-up** (`/signup`), set with `SIGNUP_MODE`:
  - `closed` (self-hosted default): invitation only.
  - `waitlist`: people leave their name, email and company. The owner sees the requests at `GET /api/admin/signups`
    and invites them.
  - `open` (SaaS default): anyone creates an account and gets their own workspace (see [Workspaces](#workspaces-one-ticketforge-many-companies)).
  On a server with no accounts yet, sign-up creates the owner, the same as `/setup`. The form is rate-limited and
  has a hidden field for bots.
- **Guided tour** (Reactour): new people get a short tour the first time they reach the projects list, the
  create-project page, a project's backlog and an issue. Steps for features someone can't use are skipped. Finished
  or skipped tours are remembered per person on the server (`user_prefs`). Account menu → **Show me around**
  starts the tour for the page you are on; **Restart all tours** shows them all again. Accounts created before the
  tours were added don't see them automatically.
- **Settings**: `TICKETFORGE_MODE` (`selfhost` | `saas`), `SIGNUP_MODE` (`closed` | `waitlist` | `open`),
  `PLATFORM_NAME`, `PLATFORM_ADMIN_EMAILS`. Plans and prices for the pricing page are in `lib/plans.ts`.

## Feature flags (Administration → Features, owner only)

The owner can **lock** any feature for everyone. Each feature has a switch and an optional reason. Changes apply right away, and other open tabs pick them up within a minute.

Features you can lock:
- **Planning:** Issues page, Board, Timeline, Reports, Source documents.
- **AI:** AI features (every AI action), Epic documents, Agents, Split issues.
- **Quality:** Test cases page, Test management, Test automation, AI failure analysis, Repository sync.
- **Development:** Coding agents, Pull requests.
- **Data:** Export, Attachments, Google Drive storage (starts locked: see [Google Drive storage](#google-drive-storage-administration--google-drive-owner-only-behind-the-google-drive-storage-feature)).

A locked feature:
- disappears from the navigation, buttons and menus; opening its page directly shows a "locked" notice;
- has its API routes refuse requests with `423 Locked`, for everyone including the owner. This is checked in the shared API wrapper (`lib/server/http.ts`).

Locking **AI features** hides every AI control, because the `ai.use` permission counts only while AI is on. Test automation does the same for `test.run`, and Export for `export`.

Data is never deleted: unlocking brings everything back as it was. Flags are stored in `app_meta` (`feature_flags`), and the catalog is in `lib/features.ts`.

A feature marked `off` in the catalog is still being rolled out: it **starts locked** and the owner turns it on. Only **Google Drive storage** is like that today.

## Google Drive storage (Administration → Google Drive, owner only, behind the "Google Drive storage" feature)

The Super Admin (the owner) connects **one** Google account for the workspace with OAuth and pastes the link of **one** Drive folder. From then on, generated agent documents (as .docx) are saved to that folder instead of TicketForge storage (the `files` table). Nothing in Drive is browsed except that folder; documents already in the old storage are not moved.

- **Set up:** create a Google Cloud OAuth client (Web application, Drive API on) with the redirect URI `APP_URL/api/gdrive/callback`, then set `TICKETFORGE_GDRIVE_CLIENT_ID` and `TICKETFORGE_GDRIVE_CLIENT_SECRET`. The Select folder action stays disabled until Google Drive is connected.
- **Tokens** are encrypted in `app_meta` and never reach the browser. An expired access token is refreshed with the refresh token.
- **Save state:** each document shows *Saved*, *Queued* or *Failed* (the `drive_docs` table, `GET /api/projects/:id/gdrive?epicId=`).
- **Retries:** a save that fails is queued and retried in the background with exponential backoff (30 s, 1 min, 2 min… up to 1 hour), up to `TICKETFORGE_GDRIVE_MAX_RETRIES` retries (default 5, to be confirmed). After that the document shows *Failed*, with a message to contact the Super Admin, and nothing retries it again. The file is kept only while queued. The retry timer runs in the server process (`lib/gdrive.ts`), so it needs a long-running server.
- **Feature off:** documents use the existing storage and the admin setting is hidden. There is no fallback to the old storage while the feature is on and Drive is down.
