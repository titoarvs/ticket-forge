// Database access. Uses any PostgreSQL host (settings in lib/db-config.ts) when DATABASE_URL is
// set, otherwise an embedded local Postgres (PGlite) stored in data/db so the app runs with no
// setup.

export {
  ROOT,
  SERVERLESS,
  DATA_DIR,
  dbInfo,
  APP_ROLE,
  asUser,
  asSystem,
  asWorkspace,
  currentContext,
  currentWs,
  DEFAULT_WS,
  useOwner,
  authGen,
} from './db/context';
export {
  CUTOVER_KEY,
  FENCE_POLL_MS,
  connectionFailure,
  probe,
  db,
  q,
  tx,
  qrows,
  qs,
  txs,
} from './db/connection';
export { SCHEMA_VERSION, migrate } from './db/migrate';
export { TABLES } from './db/rls';
