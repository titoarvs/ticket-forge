// Feature flags: the owner can lock any feature (Administration → Features). A locked feature is hidden in the app and
// its API routes refuse requests for everyone (owners included) until the owner unlocks it. Stored in app_meta.
import { qs } from './db.js';
import { wsKey, wsCache } from './wsmeta.js';

/**
 * The features. `api`: pathname patterns of the API routes that belong to it (checked for every request by the API
 * wrapper); `views`: the project pages it owns (hidden from the navigation when locked); `perms`: permissions that
 * mean nothing while it's locked (the app hides every control behind them).
 */
export const FEATURES = [
  // Planning
  { id: 'issues', group: 'Planning', label: 'Issues page', desc: 'The issue navigator: quick views, filters, saved views, CSV export.', views: ['issues'] },
  { id: 'board', group: 'Planning', label: 'Board', desc: 'The sprint board.', views: ['board'] },
  { id: 'timeline', group: 'Planning', label: 'Timeline', desc: 'Epics and sprints on a timeline.', views: ['timeline'] },
  { id: 'releases', group: 'Planning', label: 'Releases', desc: 'Versions, Fix versions on issues and release notes.', views: ['releases'] },
  { id: 'activity', group: 'Planning', label: 'Activity', desc: 'The project timeline of every change.', views: ['activity'], api: [/^\/api\/projects\/[^/]+\/activity(\/|$)/] },
  { id: 'reports', group: 'Planning', label: 'Reports', desc: 'Sprint and progress reports.', views: ['reports'] },
  { id: 'source', group: 'Planning', label: 'Source documents', desc: 'Requirement documents attached to the project.', views: ['source'] },
  // AI
  { id: 'ai', group: 'AI', label: 'AI features', desc: 'Every AI action: writing and enhancing tickets, test cases, scripts, documents, splits and plans. Locking it hides every AI button.',
    perms: ['ai.use'], api: [/^\/api\/(generate|ai\/)/, /^\/api\/projects\/[^/]+\/(feature|split|layers|testrepo-ai|testplan|testselect)(\/|$)/, /^\/api\/projects\/[^/]+\/(psd|fbd|ard|agent)$/] },
  { id: 'docs', group: 'AI', label: 'Epic documents', desc: 'Problem Statement, Feature Brief and Architecture Record per epic.', api: [/^\/api\/projects\/[^/]+\/(psd|fbd|ard)(\/|$)/] },
  { id: 'agents', group: 'AI', label: 'Agents', desc: 'The agent catalog and document agents (Epic, Kick Off, Demo, Sign-Off…).', api: [/^\/api\/agents(\/|$)/, /^\/api\/projects\/[^/]+\/agent(\/|$)/] },
  { id: 'brain', group: 'AI', label: 'Project brain', desc: 'The Brain page: linked Markdown notes about each project (Obsidian-compatible) that AI actions and code agents read first. Locking it also stops adding them to prompts.',
    views: ['brain'], api: [/^\/api\/projects\/[^/]+\/brain(\/|$)/] },
  { id: 'split', group: 'AI', label: 'Split issues', desc: 'Splitting big issues into small ones with AI.', api: [/^\/api\/projects\/[^/]+\/split(\/|$)/] },
  // Quality
  { id: 'tests', group: 'Quality', label: 'Test cases page', desc: 'Test cases grouped by feature.', views: ['tests'] },
  { id: 'testmgmt', group: 'Quality', label: 'Test management', desc: 'Test repository, plans and executions (Xray-style).', views: ['testmgmt'], api: [/^\/api\/projects\/[^/]+\/(testrepo-ai|testplan)(\/|$)/] },
  { id: 'automation', group: 'Quality', label: 'Test automation', desc: 'Playwright runs, App setup, sign-in, repository sync.', views: ['automation'], perms: ['test.run'],
    api: [/^\/api\/automation\//, /^\/api\/projects\/[^/]+\/(discover|login-detect|login-test|credentials|reposync|routes|screenshots|testselect)(\/|$)/, /^\/api\/screenshots\//] },
  { id: 'failure-analysis', group: 'Quality', label: 'AI failure analysis', desc: 'The AI root-cause note on failed automated tests.' },
  { id: 'reposync', group: 'Quality', label: 'Repository sync', desc: 'Sync changes, Find built features and Test cases from the code.', api: [/^\/api\/projects\/[^/]+\/reposync(\/|$)/] },
  // Development
  { id: 'code', group: 'Development', label: 'Coding agents', desc: 'Write code with AI, code review, updating pull requests, and the Code jobs page.', views: ['codejobs'], api: [/^\/api\/projects\/[^/]+\/code(\/|$)/] },
  { id: 'prs', group: 'Development', label: 'Pull requests', desc: 'The Pull requests page and linking pull requests.', views: ['prs'], api: [/^\/api\/pr-info(\/|$)/] },
  // Data
  { id: 'export', group: 'Data', label: 'Export', desc: 'Excel, Word, PDF, CSV and backup exports.', perms: ['export'], api: [/^\/api\/export\//] },
  { id: 'attachments', group: 'Data', label: 'Attachments', desc: 'Uploading and opening files on issues and comments.', api: [/^\/api\/files\//, /^\/api\/projects\/[^/]+\/files(\/|$)/] },
];
const IDS = new Set(FEATURES.map((f) => f.id));

const KEY = 'feature_flags';
const G = globalThis;
const C = wsCache('__tfFlagsWs');

/** { locked: { [id]: { at, by, note } }, updatedBy, updatedAt } — cached for 15 s so other server instances follow. */
export async function getFlags({ fresh = false } = {}) {
  if (!fresh && C.v !== undefined && Date.now() - C.at < 15000) return C.v;
  let v = null;
  try { v = (await qs('select value from app_meta where key = $1', [wsKey(KEY)])).rows[0]?.value || null; } catch { /* database not ready */ }
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  const locked = {};
  for (const [id, x] of Object.entries(v?.locked || {})) if (IDS.has(id)) locked[id] = { at: x?.at || null, by: x?.by || null, note: String(x?.note || '').slice(0, 300) };
  C.v = { locked, updatedBy: v?.updatedBy || null, updatedAt: v?.updatedAt || null };
  C.at = Date.now();
  return C.v;
}
/** Lock or unlock features: changes = { [id]: { locked: boolean, note? } }. Owner only (checked by the route). */
export async function setFlags(actor, changes) {
  const cur = await getFlags({ fresh: true });
  const locked = { ...cur.locked };
  const at = new Date().toISOString();
  for (const [id, c] of Object.entries(changes || {})) {
    if (!IDS.has(id)) continue;
    if (c?.locked) locked[id] = { at: locked[id]?.at || at, by: locked[id]?.by || actor?.name || null, note: String(c.note ?? locked[id]?.note ?? '').slice(0, 300) };
    else delete locked[id];
  }
  const v = { locked, updatedBy: actor?.name || null, updatedAt: at };
  await qs('insert into app_meta (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [wsKey(KEY), JSON.stringify(v)]);
  C.v = v; C.at = Date.now();
  return v;
}
export async function isLocked(id) { return Boolean((await getFlags()).locked[id]); }

/** The locked feature that owns this API path, if any. Owner settings, auth and the flags route itself are never locked. */
export async function lockedFeatureFor(pathname) {
  if (/^\/api\/(auth|admin|features|status|notifications)(\/|$)/.test(pathname)) return null;
  const { locked } = await getFlags();
  if (!Object.keys(locked).length) return null;
  return FEATURES.find((f) => locked[f.id] && (f.api || []).some((re) => re.test(pathname))) || null;
}
export const lockedMessage = (f) => `${f.label} is locked by the owner. Ask the owner to unlock it in Administration → Features.`;

/** For the browser: the catalog (without the route patterns) and what's locked. */
export async function publicFlags() {
  const v = await getFlags();
  return { features: FEATURES.map(({ api: _api, ...f }) => ({ ...f, locked: Boolean(v.locked[f.id]), lock: v.locked[f.id] || null })), locked: Object.keys(v.locked), updatedBy: v.updatedBy, updatedAt: v.updatedAt };
}
