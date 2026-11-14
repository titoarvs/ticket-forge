// Per-person preferences kept on the server (user_prefs, row-level security: only that person). Today: the guided
// tours someone has finished or skipped, so a tour shows once per person, on any browser.
import { q, currentContext } from './db.js';

const uid = () => currentContext().user?.id || null;
const TOUR_ID = /^[a-z][\w-]{0,39}$/;

function clean(d) {
  const tours = {};
  for (const [k, v] of Object.entries(d?.tours || {})) if (TOUR_ID.test(k) && typeof v === 'string') tours[k] = v.slice(0, 40);
  return { tours, toursOff: d?.toursOff === true };
}
export async function getPrefs(userId = uid()) {
  if (!userId) return clean({});
  try {
    const row = (await q('select data from user_prefs where user_id = $1', [userId])).rows[0];
    return clean(row ? (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) : {});
  } catch { return clean({}); }
}
/** Merges a change: { tourDone: 'home' }, { tourReset: true } (show every tour again), { toursOff: true|false }. */
export async function savePrefs(change = {}) {
  const userId = uid();
  if (!userId) throw Object.assign(new Error('Sign in to continue.'), { status: 401 });
  const p = await getPrefs(userId);
  if (typeof change.tourDone === 'string' && TOUR_ID.test(change.tourDone)) p.tours[change.tourDone] = new Date().toISOString();
  if (change.tourReset === true) { p.tours = {}; p.toursOff = false; }
  if (typeof change.toursOff === 'boolean') p.toursOff = change.toursOff;
  if (Object.keys(p.tours).length > 60) p.tours = Object.fromEntries(Object.entries(p.tours).slice(-60));
  await q(`insert into user_prefs (user_id, data, updated_at) values ($1, $2, now())
    on conflict (user_id) do update set data = excluded.data, updated_at = now()`, [userId, JSON.stringify(p)]);
  return p;
}
