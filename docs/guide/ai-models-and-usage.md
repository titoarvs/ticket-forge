# AI models and usage

Choosing models, saving usage, limits, the chatbots and the MCP server. Back to the [documentation index](../README.md).

## On this page

- [Model routing (Administration → AI → Model routing)](#model-routing-administration--ai--model-routing)
- [Which AI runs it ("Runs on") and custom AI configurations](#which-ai-runs-it-runs-on-and-custom-ai-configurations)
- [Saving AI usage](#saving-ai-usage)
- [AI usage: report, suggestions and limits](#ai-usage-report-suggestions-and-limits)
- [AI chatbot in every project (drafts issues)](#ai-chatbot-in-every-project-drafts-issues)
- [Help chatbot and release announcement robot](#help-chatbot-and-release-announcement-robot)
- [Product timeline (`/timeline`)](#product-timeline-timeline)
- [MCP server (create, list, search and read issues and epics from other tools)](#mcp-server-create-list-search-and-read-issues-and-epics-from-other-tools)

## Model routing (Administration → AI → Model routing)

Every AI call names its task, and each task uses a **tier**:
- **High** (best model): tickets, documents and automation scripts.
- **Standard**: epics from documents, splitting issues, the repository scan, test cases and test plans.
- **Light** (fast and cheap): failure analysis, PR text, clarifying questions and small helper jobs. Light tasks skip extended thinking.

Each tier maps to a model on every AI:
- your Claude account: `opus` / `sonnet` / `haiku` by default;
- GitHub Copilot;
- each AI API. A blank field uses the provider's own model, e.g. set OpenAI's Light tier to `gpt-4.1-mini`.

Claude Code agents are routed too:
- **Coding agents** (Build, Frontend and Backend Developer, Fix a Bug) use High.
- **Test and helper agents** (Feature Tests, Test Automation, Free Worker) use Standard.
- **Code review** (Review a Pull Request, Review Panel, UI/UX Review) uses High.
- **Document agents** use Standard.

A model picked on an agent in Administration → Agents still wins over routing. Usage for agent runs shows the cost Claude Code reports.

Presets: **Best quality**, **Balanced** (the default) and **Economy**. The page also shows the calls, the volume of text and the model that answered for each task since the server started. When routing is on, it overrides each person's own model choice in the AI connection dialog. The code is in `lib/aitasks.ts`.

## Which AI runs it ("Runs on") and custom AI configurations

Every AI dialog, the issue panel's AI bar and the top bar show a **Runs on** picker:
- **Auto:** model routing decides per task.
- **A tier:** High, Standard or Light, showing the model it runs on here.
- **A custom configuration.**

The choice is per person, saved in the browser.

Administration → AI → **Configurations** defines named setups: Claude account, GitHub Copilot or an AI API provider, plus a model, a reasoning level and standing instructions. Model routing can also send a whole task to one.

## Saving AI usage

- **App context** (Project settings → App context): a compact brief of the app, built once from the code (pages, endpoints, data models), the issues and the documents. Every AI prompt for the project includes it, so the AI stops re-discovering the app and uses the real names. You can edit it, and it warns when the code has new commits.
- **Prompt caching:** with the Anthropic API, the stable part of every prompt (rules, app context) is cached and re-read at about a tenth of the price.
- **Answer cache:** identical requests for safe tasks reuse the stored answer for 14 days. The tasks and the number of days are set in Model routing → Save usage. "Again" and "Rewrite" always ask fresh.

The Model routing page shows reused answers and the tokens read from cache.

## AI usage: report, suggestions and limits

Administration → AI has four sections for this:
- **Model routing:** presets and the tier for each task.
- **Models per tier.**
- **Usage & suggestions.**
- **Savings & limits:** reused answers, budget, *Try Standard first* and prices.

What they contain:
- **Usage report.** Every AI call is kept in the `ai_usage` table: who, which project, which task, engine and model,
  tokens in and out (and read from the provider's prompt cache), time and cost. You see totals, a daily chart,
  breakdowns by task, project, person and model, the 20 largest calls, and a CSV export. API calls report their real
  tokens. The Claude account and Copilot don't, so their tokens are estimated from the text length; their "API
  value" is what the same tokens would cost on the API. Claude Code agent runs show the cost they report.
- **Suggestions** worked out from your actual usage, each with what it saves; some switch on with one click:
  - build the App context for projects using AI without one;
  - reuse answers for repeated tasks;
  - try Standard first for High work;
  - set a budget;
  - no thinking on Light tasks;
  - prices for unpriced models;
  - tasks that send a lot per call;
  - many failed calls.
- **Spending limits:** a monthly budget for API spend.
  - At 80% the AI menu in the top bar shows the percentage.
  - At 100% it warns, moves High work to Standard, or pauses AI, as you choose. Owners are never stopped.
- **Try Standard first** (also part of the *Smart savings* preset): tickets, test cases, epics, splitting and test plans
  routed to High run on Standard, and are re-asked once on High only when the answer doesn't parse or comes back
  empty. Step-ups are counted in the report.
- **Prices:** Anthropic's current models are built in. Add your other models (OpenAI, Gemini, OpenRouter…) with their
  prices; a model without one shows tokens only.

Less sent per call:
- Ticket actions send only the fields the action needs, as compact JSON: no test scripts, run results, history,
  comments or pull requests. This is 16–54% fewer tokens on a plain issue, and up to ~90% on issues with automated
  scripts.
- Light jobs (questions, failure notes, test selection) get only the start of the App context.
- Every task has its own output limit.
- The browser no longer uploads the whole project with each AI request; the server reads it from the database.

Fewer calls:
- *Write test cases* for many issues sends 5 issues per request (10 issues: 2 requests instead of 10, about half the
  tokens).
- It skips issues whose summary, story, description and acceptance criteria haven't changed since their test cases
  were written (*Write them anyway* is offered).
- The tray shows an estimate when the job starts.

## AI chatbot in every project (drafts issues)

Every project page (and so the refine board) has an **AI helper** chat panel (bottom right, beside the help chatbot; `client/ProjectChat.tsx`, `lib/chat.ts`). It replaced the earlier helper panel (below) and doesn't sit beside it. Any workspace user who can open the project can use it:
- **Ask:** type what you need; the assistant (the same AI call as *New issue*) answers with a **draft preview**: title, description, type, story points, priority and acceptance criteria. Asking again while a draft is open refines that draft. Nothing is written to `issues` at this point. Chat design follows common LLM chat apps (Tambo AI was only inspiration; no chat SDK is used).
- **Edit and Create:** every field of the preview can be edited. **Create** saves one issue in the current project (next key, first workflow status, end of the backlog, `rev` and `updated_by` set, new project version, activity entry; needs *Create issues*) and closes the preview. **Create is disabled while the title is empty**, and the server refuses it too (**400**). **Discard** closes the preview. `POST /api/projects/:id/chat/:messageId` `{ action: 'create' | 'discard', draft }`.
- **History:** messages are saved in `chat_messages` (`project_id`, `user_id`, `role`, `content`, `draft`, `created_at`) per person and per project, and restored when the panel opens (`GET /api/projects/:id/chat`). Row-level security and the query both limit rows to the signed-in person, so nobody sees another person's messages, and another project starts empty.
- **Metering:** each request is an AI call, so it adds one row to `ai_usage` (`user_id`, `project_id`, `workspace_id`) and counts against the plan's AI actions like any AI action. When the plan's limit is reached the server answers **402** (limit), the panel shows a limit notice, the request is not sent to the assistant and nothing is saved. No limit values or plan tiers changed. Tests: `tests/tf-128-ai-chatbot.test.ts`.

### Earlier AI helper (TF-125): server only

The helper's server side (`lib/helper.ts`, `/api/projects/:id/helper`) is still there, but the panel that used it was replaced by the chatbot. It had **Search**, **Generate** and **Assign**:
- **Access:** every call is checked on the server. A person who can't open the project (it isn't on their `workspace_members.project_access` list) gets **404 Project not found** and no project data. Only people who can open the project are offered as assignees, and the server refuses anyone else.
- **Per-person settings:** `helper_perms` holds search, generate and assign for each person in each project. With no row, search is on and generate and assign are off; workspace owners can do everything. People with *Edit project settings* change them in the panel (**Access**) or with `GET/PUT /api/projects/:id/helper/permissions`. A refused action shows the server's message in the chat and changes nothing. No role definitions change.
- **Search:** tickets of this project whose key, title, user story or description contain the text.
- **Generate:** also needs *Use Claude*. The AI's ticket is saved in `ticket_drafts` as a **Draft**, not as an issue, so it isn't in the backlog, the Issues page or search. **Approve** (needs *Create issues*) turns it into an issue with the next key and the first workflow status; **Discard** drops it (`POST /api/projects/:id/helper/drafts/:draftId`).
- **Assign:** gives a ticket (by key) to a person of the project; a draft must be approved first. Saved like any issue change (history entry, new project version, notification to the assignee).
- Tables `helper_perms` and `ticket_drafts` (`lib/db.ts`, created on start); API under `/api/projects/:id/helper`. Tests: `tests/tf-125-ai-helper.test.ts`.

## Help chatbot and release announcement robot

Every signed-in user has a chat button in the bottom-right corner. The chatbot is rule-based (no AI, no provider): it
answers from the FAQ in `lib/chatbot.ts` and from live ticket data. Ticket counts only cover projects the person can
access; asking about another project is refused, and people counts need the "Manage users and access" permission.
`GET/POST /api/chatbot` serve it (`client/Chatbot.tsx`).

The robot announces the latest release (or your own message) when `RELEASE_ANNOUNCEMENT=1`; set
`RELEASE_ANNOUNCEMENT_MESSAGE` to change the text. With the flag off nothing is shown. With "reduce motion" on, the
message is shown without animation. Dismissing it (or opening the chat) hides that message on this browser.

## Product timeline (`/timeline`)

A public, animated page that tells how TicketForge grew, day by day: a sparkline of features shipped per day, then every
feature as a card on a line that fills as you scroll. Filter by area, search, switch between newest and oldest first,
expand details, jump with the day rail (a swipeable bar on phones) or the `j` / `k` keys. It respects "reduce motion"
and is complete without scripts. It's linked from the public header and footer, and from the account menu
(*What's new: product timeline*).

The entries are in `lib/timeline.ts` (dates come from when each feature's code first appeared in the repository).
When something new ships, add an entry to its day, or a new day to `DAYS`.

## MCP server (create, list, search and read issues and epics from other tools)

`POST /api/mcp` is a stateless MCP server (Streamable HTTP, JSON-RPC 2.0, in the same app; `app/api/mcp/route.ts`, `lib/mcp.ts`) for AI agents, IDE and automation tools and other apps. There is no session and no server-to-client stream (`GET`/`DELETE` answer 405).
- **Credential:** an API token, sent as `Authorization: Bearer tfk_…`. A signed-in person makes one with `POST /api/me/tokens` `{ name, expiresInDays? }` (default 90 days, at most 365; shown once, only its hash is stored in `api_tokens`), lists them with `GET /api/me/tokens` and revokes one with `DELETE /api/me/tokens/:id`. A token acts as that person in that workspace; their role, permissions and project access are read again on every call, so changing a role or disabling the person applies at once. The browser's session cookie is never used on this route. A missing, unknown, revoked or expired token gets **401** before any tool runs. (A browser sign-in/OAuth flow for MCP clients isn't built; tokens cover every client type.)
- **Tools:** `create_issue` (`projectId`, `title`; optional `type`, `priority`, `description`, `userStory`, `acceptanceCriteria`, `labels`, `storyPoints`, `epicId`), `list_issues` (optional `query` search, `status`, `type`, `priority`, `assignee`, `epicId`, `limit`, `offset`), `get_issue` (id or key), `list_epics` (optional `query`), `get_epic` (id or key, with its issues). Draft epics aren't shown.
- **Access:** every tool opens the project through the same checks as the app. A project that doesn't exist, belongs to another workspace or isn't on the person's access list is **404 Project not found** with no data (for `create_issue` an id that doesn't exist at all is a **400** validation error). Reading needs project access; `create_issue` also needs *Create issues* (**403** otherwise, and the tool isn't listed for roles without it).
- **Created issues** go to the end of the project's backlog with the first workflow status and no sprint, the person as reporter and creator (`createdBy`), a history entry and a project timeline entry, and the project version is bumped so open browsers pick them up. A missing title or an invalid field is a **400** and nothing is saved.
- **Errors:** a refused tool returns a normal result with `isError: true` and `structuredContent.error` `{ status, code: validation_error | permission_denied | not_found, message }`.
- Table `api_tokens` (`lib/db.ts`, created on start). Tests: `tests/tf-126-mcp.test.ts`.
