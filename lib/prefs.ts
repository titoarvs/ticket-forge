// Per-person preferences kept on the server (user_prefs, row-level security: only that person).
// Today: the guided tours someone has finished or skipped, so a tour shows once per person, on any
// browser.
import { currentContext } from './db';
import { orm, userPrefs, eq, sql } from './orm';

const uid = () => currentContext().user?.id || null;
const TOUR_ID = /^[a-z][\w-]{0,39}$/;

function clean(d) {
  const tours: any = {};
  for (const [k, v] of Object.entries<any>(d?.tours || {}))
    if (TOUR_ID.test(k) && typeof v === 'string') tours[k] = v.slice(0, 40);
  // Each person's own local copy of a project's repositories: { [projectId]: { frontend: { path,
  // source }, backend: {…} } }.
  const local: any = {};
  for (const [pid, sides] of Object.entries<any>(d?.local || {})) {
    if (!/^[\w-]{1,64}$/.test(pid)) continue;
    for (const side of ['frontend', 'backend']) {
      const e = sides?.[side];
      if (e && typeof e.path === 'string' && e.path)
        (local[pid] ??= {})[side] = {
          path: e.path.slice(0, 500),
          source:
            e.source && typeof e.source === 'object'
              ? {
                  type: String(e.source.type || '').slice(0, 20),
                  url: String(e.source.url || '').slice(0, 500),
                  branch: String(e.source.branch || '').slice(0, 200),
                  clonedAt: String(e.source.clonedAt || '').slice(0, 40),
                }
              : null,
        };
    }
  }
  return { tours, toursOff: d?.toursOff === true, local };
}
async function readPrefs(userId: string) {
  const [row] = await orm
    .select({ data: userPrefs.data })
    .from(userPrefs)
    .where(eq(userPrefs.userId, userId));
  return clean(row ? (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) : {});
}
/** This person's preferences; defaults when they can't be read (prefs never block a page). */
export async function getPrefs(userId = uid()) {
  if (!userId) return clean({});
  try {
    return await readPrefs(userId);
  } catch {
    return clean({});
  }
}
/**
 * Merges a change: { tourDone: 'home' }, { tourReset: true } (show every tour again), { toursOff:
 * true|false }.
 */
export async function savePrefs(change: any = {}) {
  const userId = uid();
  if (!userId) throw Object.assign(new Error('Sign in to continue.'), { status: 401 });
  // Read strictly: saving over a row we couldn't read would wipe the person's other preferences.
  const p = await readPrefs(userId);
  if (typeof change.tourDone === 'string' && TOUR_ID.test(change.tourDone))
    p.tours[change.tourDone] = new Date().toISOString();
  if (change.tourReset === true) {
    p.tours = {};
    p.toursOff = false;
  }
  if (typeof change.toursOff === 'boolean') p.toursOff = change.toursOff;
  // { myLocal: { projectId, side, path, source } }: set (or, with no path, forget) this person's
  // local copy of a repository.
  if (
    change.myLocal &&
    /^[\w-]{1,64}$/.test(String(change.myLocal.projectId)) &&
    ['frontend', 'backend'].includes(change.myLocal.side)
  ) {
    const m = change.myLocal;
    p.local ??= {};
    if (m.path)
      (p.local[m.projectId] ??= {})[m.side] = { path: String(m.path), source: m.source || null };
    else if (p.local[m.projectId]) {
      delete p.local[m.projectId][m.side];
      if (!Object.keys(p.local[m.projectId]).length) delete p.local[m.projectId];
    }
  }
  if (Object.keys(p.tours).length > 60)
    p.tours = Object.fromEntries(Object.entries<any>(p.tours).slice(-60));
  await orm
    .insert(userPrefs)
    .values({ userId, data: p, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: userPrefs.userId, set: { data: p, updatedAt: sql`now()` } });
  return p;
}
