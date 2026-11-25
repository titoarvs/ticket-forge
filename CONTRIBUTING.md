# Contributing to TicketForge

## Set up

Follow the [setup steps](README.md#set-it-up-step-by-step), then run the development server:

```bash
npm run dev
```

For test automation, also install Chromium:

```bash
npx playwright install chromium
```

## Make a change

1. Branch from `develop`, for example `feature/tf-150-short-description` or `fix/short-description`.
2. Keep the change to one purpose. [Architecture](docs/guide/architecture.md) explains where UI, logic and API code go.
3. This project uses Next.js 16. Read the matching guide in `node_modules/next/dist/docs/` before you use one of its
   APIs, because they differ from earlier versions.
4. If you change a table in `lib/db.ts`, run `npm run db:schema` and commit the result.
5. If you change how something works, update its page in [`docs/guide`](docs/guide).

## Check it

```bash
npm run lint
```

```bash
npx tsc --noEmit
```

```bash
npm test
```

```bash
npm run build
```

Compare test results with a clean checkout of `develop`, so you only fix what your change broke.

## Open a pull request

1. Push your branch and open a pull request into `develop`.
2. Say what changed, why, and how you tested it. Add screenshots for anything visible.
3. Never commit `.env`, API keys, tokens, database dumps or customer data.
