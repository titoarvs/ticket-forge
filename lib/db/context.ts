import os from 'node:os';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

// Paths are resolved from the project folder (where you run `npm start`), so they also work when
// bundled by Next.js.
export const ROOT = process.env.TICKETFORGE_ROOT || process.cwd();
/**
 * Serverless hosting (Vercel, AWS Lambda, Netlify): read-only app folder, no long-running
 * processes.
 */
export const SERVERLESS = Boolean(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.NETLIFY ||
  ROOT.startsWith('/var/task'),
);
// On serverless only the temporary folder is writable, and it doesn't last between requests.
export const DATA_DIR = process.env.TICKETFORGE_DATA
  ? path.resolve(process.env.TICKETFORGE_DATA)
  : SERVERLESS
    ? path.join(os.tmpdir(), 'ticketforge')
    : path.join(ROOT, 'data');
export const G = (globalThis.__ticketforgeDb ??= {
  impl: null,
  info: { kind: null, label: '', rls: null },
  als: new AsyncLocalStorage(),
  owner: false,
});
G.als ??= new AsyncLocalStorage();
export const dbInfo = G.info;
// ---------------------------------------------------------------- row-level security context On
// PostgreSQL every query runs as the restricted role APP_ROLE with the signed-in user's id set, so
// the RLS policies (see setupRls) decide which rows it can see or change. Sign-in, invites and
// startup tasks run in "system" context. Scripts and migrations run as the table owner.
export const APP_ROLE = 'ticketforge_app';
/** extra: other request facts, e.g. { local } = the app was opened on this computer. */
export const asUser = (userId, fn, user, extra: any = {}) =>
  G.als.run(
    { ...extra, userId: userId || '', user, ws: extra.ws ?? user?.workspace_id ?? null },
    fn,
  );
/**
 * System context keeps the request's workspace, so work done for a request stays inside that
 * company's data.
 */
export const asSystem = (fn) => G.als.run({ system: true, ws: currentWs() }, fn);
/**
 * System context for one workspace (sign-up, invites, background jobs that know their workspace).
 */
export const asWorkspace = (ws, fn) => G.als.run({ system: true, ws: ws || null }, fn);
export const currentContext = () => G.als.getStore() || {};
/** The workspace (company) the current request works in, or null outside one. */
export function currentWs() {
  const c = G.als.getStore() || {};
  return c.ws ?? c.user?.workspace_id ?? null;
}
/** The workspace every install starts with; data from before workspaces existed belongs to it. */
export const DEFAULT_WS = 'default';
export const useOwner = (on = true) => {
  G.owner = on;
};
const rlsActive = () =>
  dbInfo.kind === 'postgres' &&
  Boolean(dbInfo.rls?.appRole) &&
  !G.owner &&
  process.env.TICKETFORGE_RLS !== 'off';
// Every statement runs inside a transaction that first sets the role and user *for that transaction
// only* (set_config(..., true)). Nothing is left on the connection, so this stays correct behind
// connection poolers in session or transaction mode (Supabase Supavisor on 5432 or 6543,
// PgBouncer). Owner mode sets the role back to the connecting user, in case a shared connection
// still carries one.
export function beginSql(client) {
  let role = 'none',
    uid = '',
    sys = '',
    ws = '';
  if (rlsActive()) {
    const c = currentContext();
    role = APP_ROLE;
    uid = c.userId || '';
    sys = c.system ? 'on' : '';
    ws = currentWs() || '';
  }
  const lit = (v) => client.escapeLiteral(String(v));
  // app.writer = 2: this version records issue and section versions itself (see SYNC_TRIGGERS).
  return `begin; select set_config('role', ${lit(role)}, true), set_config('app.user_id', ${lit(uid)}, true), set_config('app.system', ${lit(sys)}, true), set_config('app.workspace_id', ${lit(ws)}, true), set_config('app.writer', '2', true)`;
}
// TICKETFORGE_SQL_LOG=1 logs every statement with its time (for finding slow requests).
export const SQL_LOG = process.env.TICKETFORGE_SQL_LOG === '1';
// Bumped whenever users, roles or sessions change, so cached sign-ins are dropped at once (see
// auth.js).
export const authGen = () => G.authGen || 0;
