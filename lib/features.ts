// Feature flags: the owner can lock any feature (Administration → Features). A locked feature is
// hidden in the app and its API routes refuse requests for everyone (owners included) until the
// owner unlocks it. Stored in app_meta.
import { getMeta, setMeta } from './appmeta';
import { wsKey, wsCache } from './wsmeta';

/**
 * The features. `api`: pathname patterns of the API routes that belong to it (checked for every
 * request by the API wrapper); `views`: the project pages it owns (hidden from the navigation when
 * locked); `perms`: permissions that mean nothing while it's locked (the app hides every control
 * behind them). `off`: a feature still being rolled out: it starts locked and the owner turns it on
 * (unlocks it) when the workspace is ready.
 */
export const FEATURES = [
  // Planning
  {
    id: 'issues',
    group: 'Planning',
    label: 'Issues page',
    desc: 'The issue navigator: quick views, filters, saved views, CSV export.',
    views: ['issues'],
  },
  { id: 'board', group: 'Planning', label: 'Board', desc: 'The sprint board.', views: ['board'] },
  {
    id: 'timeline',
    group: 'Planning',
    label: 'Timeline',
    desc: 'Epics and sprints on a timeline.',
    views: ['timeline'],
  },
  {
    id: 'releases',
    group: 'Planning',
    label: 'Releases',
    desc: 'Versions, Fix versions on issues and release notes.',
    views: ['releases'],
  },
  {
    id: 'activity',
    group: 'Planning',
    label: 'Activity',
    desc: 'The project timeline of every change.',
    views: ['activity'],
    api: [/^\/api\/projects\/[^/]+\/activity(\/|$)/],
  },
  {
    id: 'reports',
    group: 'Planning',
    label: 'Reports',
    desc: 'Sprint and progress reports.',
    views: ['reports'],
  },
  {
    id: 'source',
    group: 'Planning',
    label: 'Source documents',
    desc: 'Requirement documents attached to the project.',
    views: ['source'],
  },
  // AI
  {
    id: 'ai',
    group: 'AI',
    label: 'AI features',
    desc: 'Every AI action: writing and enhancing tickets, test cases, scripts, documents, splits and plans. Locking it hides every AI button.',
    perms: ['ai.use'],
    api: [
      /^\/api\/(generate|ai\/)/,
      /^\/api\/projects\/[^/]+\/(feature|split|layers|testrepo-ai|testplan|testselect)(\/|$)/,
      /^\/api\/projects\/[^/]+\/agent$/,
    ],
  },
  {
    id: 'agents',
    group: 'AI',
    label: 'Agents',
    desc: 'The agent catalog and document agents (Epic, Kick Off, Demo, Sign-Off…).',
    api: [/^\/api\/agents(\/|$)/, /^\/api\/projects\/[^/]+\/agent(\/|$)/],
  },
  {
    id: 'brain',
    group: 'AI',
    label: 'Project brain',
    desc: 'The Brain page: linked Markdown notes about each project (Obsidian-compatible) that AI actions and code agents read first. Locking it also stops adding them to prompts.',
    views: ['brain'],
    api: [/^\/api\/projects\/[^/]+\/brain(\/|$)/],
  },
  {
    id: 'split',
    group: 'AI',
    label: 'Split issues',
    desc: 'Splitting big issues into small ones with AI.',
    api: [/^\/api\/projects\/[^/]+\/split(\/|$)/],
  },
  // Quality
  {
    id: 'tests',
    group: 'Quality',
    label: 'Test cases page',
    desc: 'Test cases grouped by feature.',
    views: ['tests'],
  },
  {
    id: 'testmgmt',
    group: 'Quality',
    label: 'Test management',
    desc: 'Test repository, plans and executions (Xray-style).',
    views: ['testmgmt'],
    api: [/^\/api\/projects\/[^/]+\/(testrepo-ai|testplan)(\/|$)/],
  },
  {
    id: 'automation',
    group: 'Quality',
    label: 'Test automation',
    desc: 'Playwright runs, App setup, sign-in, repository sync.',
    views: ['automation'],
    perms: ['test.run'],
    api: [
      /^\/api\/automation\//,
      /^\/api\/projects\/[^/]+\/(discover|login-detect|login-test|credentials|reposync|routes|screenshots|testselect)(\/|$)/,
      /^\/api\/screenshots\//,
    ],
  },
  {
    id: 'failure-analysis',
    group: 'Quality',
    label: 'AI failure analysis',
    desc: 'The AI root-cause note on failed automated tests.',
  },
  {
    id: 'reposync',
    group: 'Quality',
    label: 'Repository sync',
    desc: 'Sync changes, Find built features and Test cases from the code.',
    api: [/^\/api\/projects\/[^/]+\/reposync(\/|$)/],
  },
  // Development
  {
    id: 'code',
    group: 'Development',
    label: 'Coding agents',
    desc: 'Write code with AI, code review, updating pull requests, and the Code jobs page.',
    views: ['codejobs'],
    api: [/^\/api\/projects\/[^/]+\/code(\/|$)/],
  },
  {
    id: 'prs',
    group: 'Development',
    label: 'Pull requests',
    desc: 'The Pull requests page and linking pull requests.',
    views: ['prs'],
    api: [/^\/api\/pr-info(\/|$)/],
  },
  // Data
  {
    id: 'export',
    group: 'Data',
    label: 'Export',
    desc: 'Excel, Word, PDF, CSV and backup exports.',
    perms: ['export'],
    api: [/^\/api\/export\//],
  },
  {
    id: 'attachments',
    group: 'Data',
    label: 'Attachments',
    desc: 'Uploading and opening files on issues and comments.',
    api: [/^\/api\/files\//, /^\/api\/projects\/[^/]+\/files(\/|$)/],
  },
  {
    id: 'gdrive',
    group: 'Data',
    label: 'Google Drive storage',
    off: true,
    desc: 'Save generated and uploaded project documents to a shared Google Drive folder instead of TicketForge storage. Turn it on to show Administration → Google Drive.',
    api: [/^\/api\/gdrive(\/|$)/, /^\/api\/projects\/[^/]+\/gdrive(\/|$)/],
  },
];
const IDS = new Set(FEATURES.map((f) => f.id));

const KEY = 'feature_flags';
const C: any = wsCache('__tfFlagsWs');

/**
 * { locked: { [id]: { at, by, note } }, unlocked: { [id]: { at, by } }, updatedBy, updatedAt } —
 * cached for 15 s so other server instances follow. `unlocked` is only for features that start
 * locked (`off`): they stay locked until it lists them.
 */
export async function getFlags({ fresh = false }: any = {}) {
  if (!fresh && C.v !== undefined && Date.now() - C.at < 15000) return C.v;
  let v = null;
  try {
    v = (await getMeta(wsKey(KEY))) || null;
  } catch {
    /* database not ready */
  }
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  const locked: any = {};
  for (const [id, x] of Object.entries<any>(v?.locked || {}))
    if (IDS.has(id))
      locked[id] = {
        at: x?.at || null,
        by: x?.by || null,
        note: String(x?.note || '').slice(0, 300),
      };
  const unlocked: any = {};
  for (const [id, x] of Object.entries<any>(v?.unlocked || {}))
    if (IDS.has(id)) unlocked[id] = { at: x?.at || null, by: x?.by || null };
  for (const f of FEATURES as any[])
    if (f.off && !unlocked[f.id]) locked[f.id] = { at: null, by: null, note: 'Not turned on yet.' };
  C.v = { locked, unlocked, updatedBy: v?.updatedBy || null, updatedAt: v?.updatedAt || null };
  C.at = Date.now();
  return C.v;
}
/**
 * Lock or unlock features: changes = { [id]: { locked: boolean, note? } }. Owner only (checked by
 * the route).
 */
export async function setFlags(actor, changes) {
  const cur = await getFlags({ fresh: true });
  const locked = { ...cur.locked };
  const unlocked = { ...cur.unlocked };
  const at = new Date().toISOString();
  for (const [id, c] of Object.entries<any>(changes || {})) {
    if (!IDS.has(id)) continue;
    if ((FEATURES as any[]).find((f) => f.id === id).off) {
      // Starts locked: turning it on is remembered in `unlocked`; locking it again forgets that.
      if (c?.locked) delete unlocked[id];
      else
        unlocked[id] = { at: unlocked[id]?.at || at, by: unlocked[id]?.by || actor?.name || null };
    } else if (c?.locked)
      locked[id] = {
        at: locked[id]?.at || at,
        by: locked[id]?.by || actor?.name || null,
        note: String(c.note ?? locked[id]?.note ?? '').slice(0, 300),
      };
    else delete locked[id];
  }
  for (const f of FEATURES as any[]) if (f.off) delete locked[f.id]; // its lock comes from starting locked, not from the owner
  const v = { locked, unlocked, updatedBy: actor?.name || null, updatedAt: at };
  await setMeta(wsKey(KEY), v);
  return getFlags({ fresh: true });
}
export async function isLocked(id) {
  return Boolean((await getFlags()).locked[id]);
}

/**
 * The locked feature that owns this API path, if any. Owner settings, auth and the flags route
 * itself are never locked.
 */
export async function lockedFeatureFor(pathname) {
  if (/^\/api\/(auth|admin|features|status|notifications)(\/|$)/.test(pathname)) return null;
  const { locked } = await getFlags();
  if (!Object.keys(locked).length) return null;
  return (
    FEATURES.find((f) => locked[f.id] && (f.api || []).some((re) => re.test(pathname))) || null
  );
}
export const lockedMessage = (f) =>
  `${f.label} is locked by the owner. Ask the owner to unlock it in Administration → Features.`;

/** For the browser: the catalog (without the route patterns) and what's locked. */
export async function publicFlags() {
  const v = await getFlags();
  return {
    features: FEATURES.map(({ api: _api, ...f }: any) => ({
      ...f,
      locked: Boolean(v.locked[f.id]),
      lock: v.locked[f.id] || null,
    })),
    locked: Object.keys(v.locked),
    updatedBy: v.updatedBy,
    updatedAt: v.updatedAt,
  };
}
