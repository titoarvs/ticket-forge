# Configuration

AI providers, environment variables, the database and email. Back to the [documentation index](../README.md).

## On this page

- [AI connection](#ai-connection)
- [GitHub Copilot as the local AI](#github-copilot-as-the-local-ai)
- [Database (Supabase)](#database-supabase)
- [Row-level security](#row-level-security)
- [Email (SMTP)](#email-smtp)

## AI connection

TicketForge picks how it talks to AI from the address you open it on:

- **On your own computer** (`http://localhost:…`): your **personal Claude account** through Claude Code
  (`claude -p`). No API key needed. Install Claude Code and sign in once:

  ```bash
  npm install -g @anthropic-ai/claude-code
  ```

  ```bash
  claude
  ```

  Pick the model (`opus`, `sonnet`, `haiku` or a full ID) in the connection pill at the top right.
- **Anywhere else** (Vercel, a server, your own domain): an **AI API**, Anthropic or any OpenAI-compatible
  one. The easiest way to set it up is **Administration → AI → Providers**:
  1. Click **Add provider**, pick the provider and paste the API key.
  2. Click **Load models** and choose one.
  3. Click **Test**, then **Add provider**.

  **Add several providers to never get stuck.** TicketForge uses the first one that's available. When it hits
  a rate limit, runs out of credits or quota, is overloaded or fails, TicketForge switches to the next one
  for that request. It leaves the limited one alone for a while (its "retry after" time when it gives one,
  otherwise 1 minute for rate limits and 1 hour for credits), then tries it again. Switches show up in the
  generation log, and the top-right pill says **backup** while a backup is in use. In the list you can:
  - reorder with the arrows or **Use first**
  - turn a provider on or off
  - **Test** each one
  - **Retry now** to clear a cooldown

  On your own computer, when your **Claude account hits its usage limit** (or isn't signed in), TicketForge
  switches to these providers until it resets. Untick that option in the panel to turn it off.


  The key is stored encrypted (AES-256-GCM) in the database and never shown again; only its last 4
  characters are. Saved settings apply to every copy that uses the database (your computer and Vercel
  alike), and take priority over environment variables. The encryption key comes from `TICKETFORGE_SECRET`
  if you set it, otherwise it's derived from the database user and password. If those change, enter the
  API key again.

  You can also use environment variables instead:

  | `AI_PROVIDER` | Key variable (or `AI_API_KEY`) | Notes |
  |---|---|---|
  | `anthropic` | `ANTHROPIC_API_KEY` | Default model `claude-opus-5-5` |
  | `openai` | `OPENAI_API_KEY` | |
  | `gemini` | `GEMINI_API_KEY` | Google's OpenAI-compatible endpoint |
  | `openrouter` | `OPENROUTER_API_KEY` | Hundreds of models through one key |
  | `groq`, `deepseek`, `mistral`, `xai`, `together` | `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, … | |
  | `ollama` | none | Local models; `AI_BASE_URL` defaults to `http://localhost:11434/v1` |
  | `custom` | `AI_API_KEY` | Any OpenAI-compatible endpoint: set `AI_BASE_URL` |

  ```bash
  AI_PROVIDER=openai
  AI_API_KEY=your-key
  AI_MODEL=a-model-your-key-can-use
  ```

  On Vercel, add these under **Settings → Environment Variables** and redeploy. Providers other than
  Anthropic need a model name; there's no built-in default because model names change often, so use
  **Load models** in the panel to see the ones your key can use.

`AI_MODE=account` or `AI_MODE=api` overrides the automatic choice: for example, `AI_MODE=api` uses the API on
your own computer too.

"On your own computer" means the connection itself comes from this computer, to a `localhost` address, and no
proxy passed on another address. It isn't decided by the `Host` or `X-Forwarded-*` headers alone, because any
visitor can send those. Opening TicketForge from another device, through a tunnel, or through Docker's port
forwarding is not "on this computer". The same rule decides who may use local folders, git and Claude Code agents.

All settings live in `.env` (see `.env.example`):

| Env var | Purpose |
|---|---|
| `DATABASE_URL` | Supabase / PostgreSQL connection string. Empty = built-in local database in `data/db` |
| `PGSSL` | Database SSL: empty (encrypted), `verify` (also verify certificate) or `disable` |
| `PG_POOL_MAX` | Database connections per server (default 5) |
| `PG_CONNECT_TIMEOUT_MS` | How long start-up waits for the database before failing with a connection error (default 10000) |
| `TICKETFORGE_CUTOVER_POLL_MS`, `TICKETFORGE_CUTOVER_HOLD_MS` | Moving to another PostgreSQL host: how often servers check for a cutover (default 1000, `0` = off) and how long writes wait during it (default 30000). See [docs/postgres-host-migration.md](../postgres-host-migration.md) |
| `APP_URL` | Public address used in invite and password-reset links |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email for invites and password resets |
| `TRUST_PROXY` | `1` behind a reverse proxy, or the number of proxies: sign-in limits then use the address the proxy adds to `X-Forwarded-For` (otherwise that header is ignored). Turns off this computer's folders, git and Claude Code unless `TICKETFORGE_ALLOW_LOCAL=1`. Not needed on Vercel |
| `PORT` | Not read: `npm run dev` and `npm start` always use 5173. For another port, run `npx next start -p 8080` |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL` | The AI API used when TicketForge isn't opened on localhost (see AI connection) |
| `AI_MODE` | `account` or `api` to override the automatic choice |
| `TICKETFORGE_SECRET` | Optional: encrypts the AI key saved in Administration → AI (default: derived from the database credentials) |
| `TICKETFORGE_CONCURRENCY` | Parallel AI calls when writing test cases (default 3) |
| `CLAUDE_BIN` | Path to the `claude` executable if it is not on PATH |

## GitHub Copilot as the local AI

When TicketForge is opened at localhost, it can use **GitHub Copilot** through the Copilot CLI with your own Copilot subscription, the same way it uses your Claude account through Claude Code.

1. Install it with `npm install -g @github/copilot`, run `copilot` once, and sign in with `/login`.
2. In **Administration → AI → Local AI on this computer**, choose:
   - **GitHub Copilot CLI** to use Copilot first, with your Claude account and then the AI APIs as backups; or
   - **Claude Code**, optionally ticking "use GitHub Copilot when your Claude account is limited".
3. Pick a Copilot model, or leave Copilot's default.

**Switching quickly:** open the AI menu in the top bar and pick **Claude** or **Copilot** under *Local AI*, or press **⌥⇧A** (Alt+Shift+A) anywhere to flip between them. Owners and admins can switch; the choice applies to this computer's TicketForge.

**Claude plan limits:** the AI menu and Administration → AI → Local AI show your Claude plan's **5-hour** and **weekly** usage, with reset times (the same numbers as Claude's own usage page). TicketForge reads them from Anthropic every minute using the sign-in Claude Code keeps on this computer (macOS Keychain, or `~/.claude/.credentials.json`). The sign-in is only sent to Anthropic, and the browser only gets percentages. At 80% the AI pill shows a badge such as "Weekly 85%"; at 95% it turns red. Set `CLAUDE_PLAN_USAGE=off` to turn this off.

Copilot runs without tools in an empty temporary folder: it only answers prompts and can't read or change files. Limits and sign-in problems switch to the next AI automatically, and the top-bar AI pill shows which AI is answering.

## Database (Supabase)

TicketForge stores projects, issues, users, roles and invites in PostgreSQL.

1. In Supabase open **Project Settings → Database → Connection string → URI** and copy the **Session pooler**
   string (port 5432). Replace `[YOUR-PASSWORD]` with your database password. If more than one copy uses
   the database (say your laptop and Vercel), use the **Transaction pooler** string (port 6543) instead: the
   Session pooler only accepts 15 connections in total, and each TicketForge server keeps up to `PG_POOL_MAX`
   (default 5) open.
2. Put it in `.env` as `DATABASE_URL=...` and restart. Tables are created automatically on start.
3. Already used the built-in local database? Copy everything across once with:

```bash
npm run db:push
```

**Moving to another PostgreSQL host** (Supabase, Neon, RDS, your own server) needs configuration only: `DATABASE_URL`,
`PGSSL`, `PG_POOL_MAX` and `PG_CONNECT_TIMEOUT_MS` are the only settings, and the code has nothing host-specific. To copy the
data, verify row counts and checksums and switch with no downtime, use `npm run db:migrate-host` (`copy`, `verify`,
`cutover`, `finish`, `release`) and follow [docs/postgres-host-migration.md](../postgres-host-migration.md).
`npm run db:cutover-load` is the load script that proves no request failed and no write was lost.

The server talks to the database directly with the connection string; nothing is exposed to the browser.
Without `DATABASE_URL`, TicketForge uses an embedded Postgres stored in `data/db`, so it runs with no setup.

**Speed.** A hosted database is a network round trip away, so TicketForge keeps round trips down:
- each statement goes to Postgres in one message, together with the row-level security settings and the commit;
- the signed-in user is remembered for 15 seconds (cleared at once when users, roles or sessions change);
- a save writes all changed issues in one statement, reads only the issues it changes and writes only the project
  sections that changed (not the whole project);
- the schema check on start is one message.

See [Speed with thousands of people](architecture.md#speed-with-thousands-of-people) for syncing, caching and how to run it for a big team.

Pick the Supabase region closest to you and your server. To see what a request costs, start the server with
`TICKETFORGE_SQL_LOG=1`: each statement is logged with its time.

## Row-level security

On Postgres (Supabase), every table has row-level security switched on:

- **Supabase's public roles are locked out.** `anon` and `authenticated` get no privileges on any TicketForge table, so the Supabase REST/GraphQL API (and anyone holding your anon key) can't read or change anything.
- **The app queries as a restricted role.** Each request runs as `ticketforge_app` (no `BYPASSRLS`) with the signed-in user's id set for that transaction. Policies then decide what that user can touch:
  - projects and issues: only projects the user has access to; creating needs `project.create`. Deleting is a soft delete (the project is archived, `projects.archived_at`, and the app owner can restore it): only the project's creator and the workspace owner can do it, and the app asks them to re-enter their password. A database trigger and the delete policy enforce the same rule.
  - notifications: only the user's own (anyone signed in can send one).
  - users and roles: readable by signed-in users, written only by the sign-in system.
  - sessions, invites, password resets and settings: sign-in system only.
- **No user, no rows.** A query without a signed-in user returns nothing.

Migrations and `npm run db:push` run as the table owner. The policies are recreated on every start, and **Admin → Email & database** shows whether they're active. Set `TICKETFORGE_RLS=off` to run without the restricted role (the tables stay locked to Supabase's public roles).

## Email (SMTP)

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` in `.env` and restart. Examples:
Gmail uses `smtp.gmail.com`, port 587 and an [App Password](https://myaccount.google.com/apppasswords);
SendGrid uses `smtp.sendgrid.net`, user `apikey` and your API key as the password. Using SendGrid you can instead set just
`SENDGRID_API_KEY`, `SENDGRID_FROM` and `SENDGRID_FROM_NAME` (leave `SMTP_HOST` empty); the sender address must
be a verified Sender Identity or on an authenticated domain in SendGrid. Check it with
Administration → **Email & database** → **Send a test email to me**. Set `APP_URL` to the address your team
uses so links in emails work outside your machine.
