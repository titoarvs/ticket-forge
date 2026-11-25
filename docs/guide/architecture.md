# Architecture

Project layout, code layers, the data access layer and performance. Back to the [documentation index](../README.md).

## On this page

- [Project layout](#project-layout)
- [Drizzle ORM](#drizzle-orm)
- [Speed with thousands of people](#speed-with-thousands-of-people)
- [Notes](#notes)

## Project layout

```
app/                       Next.js App Router
  (app)/                   Signed-in pages: projects, create, admin, project workspace (/p/[id]/[view])
  (auth)/                  Sign-in pages: login, setup, forgot, reset/[token], invite/[token]
  api/                     Route handlers (auth, admin, projects, Claude, automation, exports, PR lookup)
  runs/[file]/             Screenshots from automated test runs (signed-in users only)
  globals.css              Jira-style design system
client/                    React components (client side)
  core.ts                  State store, data model, history, undo, patch saving and sync
  ui.tsx                   Shared components (icons, avatars, menus, dialogs, toasts)
  actions.tsx              Claude actions, automation runs, sprints, pull requests + their dialogs
  AppShell.tsx Auth.tsx    Signed-in shell / top navigation, and the sign-in screens
  Home.tsx Admin.tsx       Projects + create-from-document pages, Administration
  Workspace.tsx views.tsx  Project sidebar and views (Summary, Backlog, Board, Epics, Reports, Tests, Automation, Settings)
  Drawer.tsx               Issue and epic panels
  Brain.tsx markdown.tsx   The Brain page (notes, graph, editor) and the Markdown renderer with [[wikilinks]]
  api/                     API client modules: the only client code that builds requests to /api/*
  logic/                   Logic modules: pure rules and formatting, with no JSX and no requests
lib/                       Server modules
  server/http.ts           Route-handler helpers: sessions, permissions, streaming, setup
  db.ts auth.ts store.ts   Database (Supabase/Postgres or local), users & invites, projects & permission checks
  claude.ts prompts.ts generate.ts   Claude providers and prompts
  brain.ts                 The project brain: notes built from the project, retrieval for prompts, Obsidian import/export, folder sync
  automation.ts runner.mjs Playwright test automation
  exporters.ts parse.ts github.ts    Exports, document parsing, PR lookup
scripts/db-push.ts         Copies the local database to DATABASE_URL
scripts/db-migrate-host.ts Copies a PostgreSQL host to another one, verifies counts and checksums, cuts over
scripts/db-cutover-load.mjs  Load script for the cutover: failed requests and lost writes
```

### Code layers (UI, logic, API)

The client code is split into three layers so each concern lives in one place. A change to one layer should not need edits in the others.

| Layer | Where | Responsibility | May import |
| --- | --- | --- | --- |
| UI | `client/*.tsx` (for example `Versions.tsx`, `Admin.tsx`, `AgentsTab.tsx`) | Renders screens, reads input, shows loading, empty, error and success states (`toast`, modals). Calls the logic and API layers; it builds no request URLs and has no `fetch`. | `client/api/*`, `client/logic/*`, `core.ts`, `ui.tsx`, `fields.tsx` |
| Logic | `client/logic/*.ts` | Rules with no JSX and no requests: which fields are compared, how a value reads as text, what counts as a change. Easy to read and to reuse. | `core.ts` helpers and other logic modules |
| API client | `client/api/*.ts` | One function per server request: it owns the URL, method, query string and body. It returns what `api()` returns and does not catch errors, so the screen shows the same error state as before. | `api()` from `core.ts` only |
| Transport and state | `client/core.ts` | `api()` (the one `fetch` call: headers, errors, 401 sign-out, plan-limit prompt), the state store `S`, toasts, modals and undo. | none of the layers above |
| Server | `app/api/**/route.ts` → `lib/*.js` | Route handlers stay thin (`api()`, `authed()`, permission checks) and call `lib/store.ts` and the other server modules for the data and rules. | |

Migrated so far: issue versions (`api/versions.ts`, `logic/versions.ts`), Administration (`api/admin.ts`), the Agents tab (`api/agents.ts`) and project reads (`api/projects.ts`). Other screens in `client/` still call `api()` directly and move to these layers when they are next changed: add a function to `client/api/<feature>.ts` (and rules to `client/logic/<feature>.ts`) instead of building a URL in the component.

## Drizzle ORM

[Drizzle ORM](https://orm.drizzle.team) is the data access layer. It is being ported module by module from hand-written
SQL: these modules already use it, the rest still call `q()` / `qs()` / `tx()` and keep working unchanged.
Ported: `appmeta` (the `app_meta` settings table, used by settings, features, agents, generation rules, secrets, Google
Drive and GitHub connection), `files`, `shots`, `remote-jobs`, `notify`,
`prefs`, `user-ai`, `gateways`, `gateway-keys`, `aicache`, `limits`, `subscription`, `chatbot`, and the AI usage rows
written by `claude`. Not ported yet: `store`, `auth`, `brain`, `billing-plans`, `subscriptions`, `stripe`,
`paymongo*`, `aiusage` (reports), `gdrive` (the `drive_docs` queue), `coderabbit-pr`, the table setup, row-level
security and one-time migrations in `lib/db.ts`, and `scripts/db-push.ts`.

If the connection string in `DATABASE_URL` is not a valid `postgresql://` address, or the database can't be reached,
TicketForge stops at start-up (`instrumentation.ts`) with a message that says what to fix, instead of starting and
failing later.

- **`lib/orm.ts`**: the `orm` client (and the tables and the usual operators: `eq`, `and`, `inArray`, `desc`, `sql`…).
  It sends every statement through `lib/db.ts` (node-postgres), so it uses the same database (Supabase/PostgreSQL or the
  built-in local one), the same pool and the same **row-level security**: queries run as the signed-in user's role and
  workspace, and `asSystem(async () => await orm…)` is the system context, exactly like `qs()`. (Await the query inside
  the `asSystem` function: a Drizzle query only runs when it is awaited.)
  ```ts
  import { orm, projects, eq, desc } from '@/lib/orm';
  const mine = await orm.select().from(projects).where(eq(projects.workspaceId, ws)).orderBy(desc(projects.updatedAt));
  ```
  Relational queries work too (`orm.query.workspaces.findMany({ with: { workspaceMembers: true } })`). Drizzle's own
  `orm.transaction` isn't available through this driver: use `tx()` from `lib/db.ts` for transactions.
- **`lib/schema/`**: every table, typed, **one file per table** (`lib/schema/users.ts`, `lib/schema/issues.ts`…;
  `index.ts` re-exports them and `bytea.ts` is the shared binary column type), plus **`lib/relations.ts`**. They are
  generated, not written by hand: tables, policies, triggers and migrations are still defined in `lib/db.ts` (Drizzle Kit
  doesn't know about row-level security), so there is deliberately no `drizzle-kit push` or `migrate`.
- **`npm run db:schema`** rebuilds those files: it creates a throwaway local database with `lib/db.ts`, reads it back
  with Drizzle Kit and writes the schema, one file per table. It never touches your own database. Run it after changing a
  table in `lib/db.ts` and commit the result. **`npm run db:check`** fails when they are out of date (for CI).
- **`npm run db:generate`** has Drizzle Kit write a SQL migration of `lib/schema/` into `drizzle/`, to compare with the
  tables `lib/db.ts` creates.
- **`npm run db:studio`** opens Drizzle Studio on your database (`DATABASE_URL`, or `data/db` when there is none).

Notes: timestamps are `Date` objects; `bytea` columns (`files.data`, `screenshots.data`) are a `Buffer` on PostgreSQL
and a `Uint8Array` on the built-in local database; `jsonb` columns are untyped (`unknown`) until you add `.$type<…>()`.

## Speed with thousands of people

- **Teammates' changes arrive as "changes since my version".** Each browser asks every 10 s (a little random, and at
  once when the tab comes back into view) whether the project changed, and then downloads only the issues and
  sections saved since its version (`GET /api/projects/:id/changes?since=`), usually a few kB. Before, every change
  made every open browser download the whole project again (20 MB for 2,000 issues).
- **Nobody overwrites anybody.** Each save says which version of each issue and section it started from. If a teammate
  saved the same issue meanwhile, the server answers 409 with their copy; the browser merges both people's changes
  (both edited fields, both comments, both history entries, different epics or sprints) and saves again. When both
  changed the same field, the person saving now wins. Saves of one project queue on the project row, so none is lost.
- **Server caches** (per server, short-lived): the project version for 2 s, and each version of the whole project and
  of "changes since" once, shared by everyone asking. A thousand people opening the same project cost one database
  read. The project is downloaded gzipped (about 30–40 times smaller) and unpacked in the browser.
- **Database:** issue and section versions (`rev` columns, `issue_tombstones` for deleted issues) and the project list's
  counts come from small columns. Row-level security works out the user's access once per query instead of once per
  row. All of this is added automatically on start; nothing to run.
- **Browser:** rows redraw only when they change (menus, toasts and "Saved" don't redraw the list), and undo shares the
  saved text of unchanged issues instead of copying the whole project for every change.
- **An older TicketForge sharing the database** (a server not updated yet) doesn't record what it changed. Database
  triggers record it for it (issue versions, deleted issues, changed sections), and a browser that sees the version
  move with nothing listed reloads the project. Update every server anyway: an older server also puts back its own,
  slower row-level security rules each time it starts.

Measured on a local PostgreSQL with 2,000 issues (scripts not included): 100 people saving at the same moment
finished in 0.2 s (p95 186 ms, was 819 ms); 30 people changing different settings at once lost none of them (before:
28 lost); 2,000 version checks took 4 ms (was 138 ms); catching up after a teammate's change downloaded 9.7 kB
(was 20 MB). In a production build with 1,500 issues and 742 rows on screen, changing a status took 4 ms and a
search keystroke 17–37 ms.

**Running it for a big team**
- Run the production build (`npm run build` then `npm start`), not `npm run dev`.
- Host the server in the same region as the database (every database round trip counts on a save).
- Use Supabase's **Transaction pooler** (port 6543) and raise `PG_POOL_MAX` (for example 20 per server); run several
  copies behind a load balancer if needed. The caches above are per copy and short-lived, so copies stay in step
  within about 2 seconds.

## Notes

- [Scrum team pain points in the building phase](../scrum-pain-points.md), and how Ticket Forge may help, for the Scrum Master, Product Owner, developers and QA. A Word copy is built with `npm run docs:pain-points` (`docs/scrum-pain-points.docx`).
- [Ticket layer decision rules](../ticket-layer-rules.md): how to set an issue's Implementation to frontend, backend or both, with examples and open questions (TF-129).
- Keep `.env` private: it holds your database and email passwords. It is excluded from git.
- Scanned PDFs (images only) have no text layer; run OCR first or paste the text.
- Legacy `.doc` files are not supported; save as `.docx` or PDF.
- Big documents take a few minutes. Test cases are written per epic, so one failure doesn't lose the rest,
  and you can regenerate tests for any ticket later.
