# TicketForge

![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![PostgreSQL ready](https://img.shields.io/badge/PostgreSQL-ready-4169E1?logo=postgresql&logoColor=white)
![Node.js 22.3 or newer](https://img.shields.io/badge/Node.js-22.3%2B-5FA04E?logo=nodedotjs&logoColor=white)

TicketForge turns a requirements document (PRD, BRD, feature brief or meeting notes) into a backlog you can ship:
**epics → tickets → acceptance criteria → test cases**. Your team then plans, edits and tracks the work in a
Jira-style workspace. AI agents can also write the code, open pull requests and run the tests.

![The active sprint board, with issues in To Do, In Progress, In Review and Done columns](docs/images/board.png)

> [!NOTE]
> TicketForge runs on your own computer with no database to install and no API key. The AI features need either
> a signed-in [Claude Code](#step-6-connect-an-ai) or an API key. Everything else works without AI.

## Contents

- [Features](#features)
- [Set it up, step by step](#set-it-up-step-by-step)
- [Quick start: your first project](#quick-start-your-first-project)
- [Optional setup](#optional-setup)
- [Deploy for a team](#deploy-for-a-team)
- [Commands](#commands)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Backlog from documents:** upload PDF, Word, Markdown, text, HTML, Excel or CSV. The AI drafts epics, user
  stories, Given/When/Then acceptance criteria, story points and test cases, and lists what is unclear.
- **Jira-style planning:** backlog, sprints, board, epics, timeline, releases and reports, with your own workflow.
- **Testing:** test cases for every issue, Playwright automation, and Xray-style test plans and executions.
- **Code with AI:** agents build an issue in its own branch, then open a pull request for you to review.
- **GitHub:** import and sync issues and Projects, and follow pull requests from each ticket.
- **Teams:** invites, roles, per-project access and separate workspaces for each company.
- **Export:** Excel, Word, PDF, a self-contained HTML report, CSV and a Jira import CSV.

| Backlog and issue details | Timeline |
| --- | --- |
| ![Backlog with an issue open, showing its user story and acceptance criteria](docs/images/issue.png) | ![Timeline of five epics with progress bars and a today line](docs/images/timeline.png) |

## Set it up, step by step

This takes about five minutes.

### Step 1: install what you need

| You need | Version | Check it with |
| --- | --- | --- |
| [Node.js](https://nodejs.org) (includes npm) | 22.3 or newer (20.16+ in the 20 line also works) | `node -v` |
| [Git](https://git-scm.com) | Any recent version | `git --version` |

### Step 2: get the code

```bash
git clone https://github.com/titoarvs/automated-tickets.git
```

```bash
cd automated-tickets
```

While the repository is private, your GitHub account needs access to it before you can clone it.

### Step 3: install the dependencies

```bash
npm ci
```

You should see a line like `added 703 packages`. Warnings about deprecated packages are expected.

### Step 4: create your settings file

```bash
cp .env.example .env
```

You can leave it as it is for now. With an empty `DATABASE_URL`, TicketForge uses a built-in database stored in
`data/db`.

> [!CAUTION]
> Never commit `.env`. It holds your database, email and API credentials, and git ignores it.

### Step 5: build and start

```bash
npm run build
```

```bash
npm start
```

Wait for `✓ Ready`, then open <http://localhost:5173/setup> and create the **owner account**. The owner has full
access and can invite everyone else. Projects from earlier versions in `data/projects/` are imported automatically.

<img src="docs/images/setup.png" alt="Set up TicketForge form with name, work email, company and password fields" width="560">

### Step 6: connect an AI

Pick **one** of these. You can skip this step and come back later.

**Option A: your Claude account.** This is for running on your own computer, and needs no API key. Install Claude
Code:

```bash
npm install -g @anthropic-ai/claude-code
```

Then start it once and sign in:

```bash
claude
```

Reload TicketForge. The pill at the top right shows **Claude account**.

**Option B: an API key.** This works anywhere, and is required on a server:

1. Open **Administration → AI → Providers**.
2. Click **Add provider**, pick one (Anthropic, OpenAI, Gemini, OpenRouter, Ollama and others) and paste your key.
3. Click **Load models** and choose one.
4. Click **Test**, then **Add provider**.

On `localhost`, TicketForge uses your Claude account by default. To use the API there too, set `AI_MODE=api` in
`.env` and restart.

## Quick start: your first project

**Without AI:** on the Projects page click **Import backup** and choose
[`sample/freshcart-demo.json`](sample/freshcart-demo.json). It opens a demo project with 5 epics, 14 issues,
3 sprints and test cases.

**With AI:** click **Create project** and upload
[`sample/sample-requirements.md`](sample/sample-requirements.md), or your own document. Review the extracted text,
generate, and edit the result.

## Optional setup

Set these in `.env` and restart. See [Configuration](docs/guide/configuration.md) for every setting.

### Use PostgreSQL or Supabase

1. Create a database and copy its connection string. In Supabase, copy a **pooler** string.
2. Set it in `.env`:

   ```bash
   DATABASE_URL=postgresql://user:password@host:5432/database
   ```

3. Restart. TicketForge creates its tables on the first request.
4. To copy what is already in the built-in database, run this once:

   ```bash
   npm run db:push
   ```

For a PostgreSQL server without SSL, also set `PGSSL=disable`.

### Send invite and password-reset emails

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM`, then use **Administration → Email &
database → Send a test email to me**. Without email, you can copy invite links from the app instead.

### Run automated tests in a browser

```bash
npx playwright install chromium
```

Or use the **Install Chromium** button on the Test automation page.

## Deploy for a team

A shared server needs these settings:

| Setting | Value |
| --- | --- |
| `DATABASE_URL` | Your PostgreSQL connection string (Supabase: **Transaction pooler**, port 6543) |
| `APP_URL` | The public `https://` address; invite and reset links use it |
| `TICKETFORGE_SECRET` | A long random value that encrypts saved API keys. Keep it: changing it means entering the keys again |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` | Your AI API, unless you set it in Administration → AI |

**On Vercel:** import the repository, add the settings under **Settings → Environment Variables**, and deploy.
Claude Code and local folders aren't available there, so code jobs use your AI API and test runs use GitHub Actions.

**On your own server:** follow steps 1 to 5 above, keep `npm start` running with a process manager, and put an HTTPS
reverse proxy in front of port 5173.

> [!IMPORTANT]
> Don't expose port 5173 to the internet directly. TicketForge reads the visitor's address and the host name from
> the request headers, so have the reverse proxy set `Host`, `X-Forwarded-Host` and `X-Forwarded-For` itself.

Before you open it to the public, replace the placeholders in the [legal pages](lib/legal).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload on port 5173 |
| `npm run build` | Production build |
| `npm start` | Production server on port 5173 |
| `npm test` | Run the tests |
| `npm run lint` | Check the code with ESLint |
| `npm run format:check` | Check formatting with Prettier |
| `npm run db:push` | Copy the built-in database to `DATABASE_URL` |
| `npm run db:studio` | Browse the database in Drizzle Studio |
| `npm run db:schema` | Rebuild `lib/schema/` after changing tables in `lib/db.ts` |

To update an existing copy, run `git pull`, then repeat steps 3 and 5.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `EADDRINUSE` or port 5173 is taken | Stop the other server, or run `npx next start -p 8080`. The scripts ignore `PORT` |
| `Could not find a production build` | Run `npm run build` before `npm start` |
| "could not connect to its database" on start | Check `DATABASE_URL`, or clear it to use the built-in database |
| AI says it isn't connected on localhost | Run `claude` in a terminal and sign in. If it isn't on your PATH, set `CLAUDE_BIN` |
| AI says it isn't connected on a server | Add a provider in **Administration → AI** |
| A PDF has no text | It is a scan. Run OCR first, or paste the text |
| `.doc` files are refused | Save the file as `.docx` or PDF |

## Documentation

| Guide | What it covers |
| --- | --- |
| [Using TicketForge](docs/guide/using-ticketforge.md) | Documents, backlog, sprints, releases, export |
| [Configuration](docs/guide/configuration.md) | AI providers, settings, database, email, row-level security |
| [Accounts and workspaces](docs/guide/accounts-and-workspaces.md) | People, roles, workspaces, feature flags |
| [AI agents and code](docs/guide/ai-agents-and-code.md) | Agents, code jobs, GitHub, pull requests |
| [AI models and usage](docs/guide/ai-models-and-usage.md) | Model routing, usage limits, chatbots, MCP server |
| [Testing](docs/guide/testing.md) | Playwright automation and test management |
| [Plans and billing](docs/guide/billing.md) | Plans and payment gateways on a hosted service |
| [Architecture](docs/guide/architecture.md) | Project layout, code layers, Drizzle, performance |
| [Ticket layer rules](docs/ticket-layer-rules.md) | Choosing frontend, backend or both for an issue |
| [All documentation](docs/README.md) | The full index |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), then open an
[issue](https://github.com/titoarvs/automated-tickets/issues) or a
[pull request](https://github.com/titoarvs/automated-tickets/pulls).

## License

No open-source license has been granted: `package.json` marks this project `UNLICENSED`. Ask the repository owner
before you use, copy or redistribute it.
