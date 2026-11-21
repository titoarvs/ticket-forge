# Moving TicketForge to another PostgreSQL host

TicketForge uses plain PostgreSQL through node-postgres. Nothing in the code depends on who hosts the database
(Supabase, Neon, RDS, your own server...). Moving means: copy the data, then change configuration and redeploy.

## 1. The configuration (the only thing the app reads)

| Variable | Meaning |
|----------|---------|
| `DATABASE_URL` | `postgresql://user:password@host:5432/database` (`SUPABASE_DB_URL` is read too if `DATABASE_URL` is empty). URL-encode special characters in the password (`@ # /` as `%40 %23 %2F`). |
| `PGSSL` | Empty: encrypted, certificate not verified (or the URL's `?sslmode=`). `verify`: also verify the certificate. `disable`: no SSL. |
| `PG_POOL_MAX` | Connections each server keeps open (default 5). Mind the new host's connection limit. |
| `PG_CONNECT_TIMEOUT_MS` | How long start-up waits for the first connection (default 10000). |
| `TICKETFORGE_SECRET` / `TICKETFORGE_KEY_FROM_URL` | Saved API keys (AI, payment gateways, Drive) are encrypted with `TICKETFORGE_SECRET`, or, when that is empty, with a key derived from the database **user and password**. A new host has new credentials, so **before you deploy green, set `TICKETFORGE_KEY_FROM_URL` to the old connection string** (the same on every server). The key then stays the same and nothing has to be entered again. If `TICKETFORGE_SECRET` is already set, leave it unchanged. |

Connect as the database owner: TicketForge creates its tables, row-level security, triggers and the `ticketforge_app`
role on start.

**If the connection string is invalid or the host can't be reached, the app stops at start-up** (`instrumentation.ts`)
with a message such as `Can't connect to the database at db.example.com:5432: the host name was not found...`.
Start-up only runs `select 1`; no table is created or changed before the connection works.

## 2. What the tool copies

Every table TicketForge owns (`TABLES` in `lib/db.ts`): users, roles, workspaces and members, invites, sessions, projects,
issues (epics, tickets, test cases), issue versions, activity, notifications, files and screenshots, app settings
(`app_meta`), AI usage and caches, user preferences, billing plans, payment gateways, usage counters and subscriptions,
coding specs, epic documents, reviews and sign-offs, Drive queue, and so on. Serial ids continue after the highest copied id.

Rows are copied as they are: `rev`, `version` and timestamps are kept (the tool writes as TicketForge's own writer, so the
sync triggers don't renumber anything).

## 3. Zero-downtime cutover (blue/green)

You need: the current host (**source**), the new host (**target**, empty database, owner credentials), and the ability to run a
second set of TicketForge servers (**green**) with the new `DATABASE_URL` that does not get traffic yet. On platforms
like Vercel this is a new deployment with the changed environment variable that you promote afterwards.

Both servers must run this version of TicketForge (the fence below is part of it), so deploy it to the current servers
first and wait until they are all updated.

```bash
export SOURCE_DATABASE_URL='postgresql://...old host...'   # defaults to DATABASE_URL in .env
export TARGET_DATABASE_URL='postgresql://...new host...'
# SOURCE_PGSSL / TARGET_PGSSL override PGSSL for one side
```

1. **Copy while the app is in use.** Creates the tables on the target and copies everything. Safe to repeat; each run only
   writes rows that changed.
   ```bash
   npm run db:migrate-host -- copy
   npm run db:migrate-host -- copy      # catch up
   ```
2. **Start green** on the target: same code, `DATABASE_URL` = the new host. Don't send it traffic yet. (Its tables
   already exist and hold the copied data.)
3. **Cut over.**
   ```bash
   npm run db:migrate-host -- cutover
   ```
   It: (a) puts a `hold` marker on the source, (b) waits until every server has seen it and the transactions that started
   before it have finished, (c) copies the last changes and removes rows deleted since, (d) compares **row counts and
   checksums** of every table, (e) when everything matches marks the source `moved`. If anything does not match, it
   re-opens the source and exits with an error: nothing is lost and you can run `copy` again.
4. **Send traffic to green** (swap the load balancer / promote the deployment) right after `cutover` prints "Verified".
5. Stop the old servers when they are idle.

What users see during steps 3-4 (a few seconds):

- Plain reads keep working on the source.
- Writes (and anything that runs in a transaction) **wait** while the source is on `hold` (up to `TICKETFORGE_CUTOVER_HOLD_MS`, 30 s) instead of failing.
- Once the source is `moved`, an old server refuses a write *before running it* with a 503 (`code: "db-moved"`). The
  browser (`client/core.ts`) retries it with a short back-off, up to 8 times (about 18 s), and the retry reaches green. Nothing
  is written to the old host after its last copy, so no write is lost. API clients and load balancers must retry such a 503
  too (it is safe: the request did not run). `scripts/db-cutover-load.mjs` does.

If your platform needs longer than that to switch traffic, run `cutover --keep-hold` (writes stay on hold, waiting up to
30 s and then answering with the same retryable 503), switch, then run `finish`. Abort at any time with `release`.

Settings: `TICKETFORGE_CUTOVER_POLL_MS` (how often a server checks the marker, default 1000; `0` turns the fence off; keep it
the same on all servers) and `TICKETFORGE_CUTOVER_HOLD_MS`.

## 4. The migration report

`verify` and `cutover` print a table and write `data/migration-reports/db-migration-<time>.json` with, for every table,
the row count and checksum on both hosts and whether they match. The checksum is the sum of a 64-bit hash of every row as
JSON, so it doesn't depend on row or column order. Running `verify` while users are still writing shows differences;
the report that counts is the one from `cutover`.

```bash
npm run db:migrate-host -- verify
```

## 5. Check the load and the writes

```bash
# before the cutover, in another terminal (tf_session = the cookie of a signed-in user)
TF_COOKIE=... PROJECT_ID=... BASE_URL=https://app.example.com DURATION_S=180 npm run db:cutover-load
# ... run the cutover and swap traffic while it runs ...
# afterwards, against the app on the new host:
TF_COOKIE=... PROJECT_ID=... BASE_URL=https://app.example.com npm run db:cutover-load -- --check
```

The first run must print `Failed requests: 0`. The `--check` run must find every confirmed issue on the new host.

## 6. Check the features on the new host

Sign in, open a project and edit a ticket, open the AI documents (Problem Statement, Feature Brief, Architecture), run a
test from Test automation, open Code integration, change a setting in Administration, and open Billing / subscription.
Each one reads and writes the same tables as before.

## 7. Roll back

Until you stop the old servers nothing on the source was removed. To go back: set `DATABASE_URL` to the old host, run
`SOURCE_DATABASE_URL=<old> npm run db:migrate-host -- release` (this removes the `moved` marker, which otherwise makes the old
host refuse writes), redeploy. Writes made on the new host after the cutover are only there: copy them back first by running
the tool the other way round (swap `SOURCE_DATABASE_URL` and `TARGET_DATABASE_URL`).

## 8. Supabase free plan full: work on a local database, move back later

When the Supabase free plan (500 MB of database space) fills up, run TicketForge on PostgreSQL on your own computer and
move the data back to Supabase once there is room (a paid plan, or space freed). Administration → Email & database shows
how full the database is and, near the limit, these commands. Stop `npm run dev` first and restart it after each switch.

```bash
npm run db:switch -- status   # which database the app uses, its size, the share of the free plan
npm run db:switch -- local    # Supabase -> PostgreSQL on this computer
npm run db:switch -- hosted   # back to Supabase
```

- `local` creates the database `ticketforge` on `localhost:5432` (or `LOCAL_DATABASE_URL`), copies everything with the tool
  above (`copy` + `cutover`, every table checked), then points `DATABASE_URL` in `.env` at it and saves the Supabase address
  as `HOSTED_DATABASE_URL`. Supabase is marked `moved`: the deployed site still shows data but refuses saves, so nothing is
  written there that the move back would overwrite. (A Supabase database that is already read-only because the plan is
  full can't be marked; the copy is then verified instead.)
- `hosted` copies everything back while Supabase is still frozen, checks it, re-opens Supabase, marks the local database
  `moved` and points `.env` back. Supabase needs room for the data. It refuses to start while anything else is connected to
  the local database (a running TicketForge would write after the last copy).
- `.env` is copied to `.env.before-db-switch` before it changes. The deployed site can't reach a database on your computer:
  while you work locally only the local app saves.

## Out of scope

Moving to a non-PostgreSQL database, and switching providers from the UI (use `npm run db:switch`).
