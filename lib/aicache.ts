// AI answer cache: an identical request (same task, model choice, system prompt and prompt) within N days reuses the
// stored answer instead of calling the AI again. Only for tasks where a repeat answer is what you want (Administration →
// AI → Model routing → Save usage); "again" / "regenerate" actions send fresh: true and skip it. Server-only table.
import crypto from 'node:crypto';
import { qs, currentWs, DEFAULT_WS } from './db';

// Each workspace has its own answers: other workspaces' keys start with "<workspace>:" (the default one's don't).
const wsPrefix = () => { const w = currentWs() || DEFAULT_WS; return w === DEFAULT_WS ? '' : `${w}:`; };
const wsWhere = () => (wsPrefix() ? 'key like $1' : "key not like '%:%'");
const wsArgs = () => (wsPrefix() ? [`${wsPrefix().replace(/[%_\\]/g, '\\$&')}%`] : []);

/** Tasks whose answers are safe to reuse by default: the same input should give the same answer. */
export const CACHE_TASKS_DEFAULT = ['quick', 'repo', 'failure', 'pr', 'selection', 'healing', 'plan'];

export const cacheKey = (parts) => wsPrefix() + crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');

export async function cacheGet(key, days) {
  try {
    const r = (await qs(`update ai_cache set hits = hits + 1, used_at = now() where key = $1 and created_at > now() - ($2 || ' days')::interval returning value`, [key, String(days)])).rows[0];
    return r ? r.value : null;
  } catch { return null; } // table not migrated yet, or no database: just call the AI
}
let lastSweep = 0;
export async function cachePut(key, task, value, days) {
  try {
    await qs('insert into ai_cache (key, task, value, chars) values ($1, $2, $3, $4) on conflict (key) do update set value = excluded.value, created_at = now(), used_at = now()', [key, task || '', String(value), String(value).length]);
    if (Date.now() - lastSweep > 36e5) { lastSweep = Date.now(); await qs(`delete from ai_cache where used_at < now() - ($1 || ' days')::interval`, [String(days)]); }
  } catch { /* caching is best-effort */ }
}
/** For Administration: how much the cache holds and how often it answered. */
export async function cacheStats() {
  try {
    const r = (await qs(`select count(*)::int as entries, coalesce(sum(hits), 0)::int as hits, coalesce(sum(hits * chars), 0)::bigint as saved_chars from ai_cache where ${wsWhere()}`, wsArgs())).rows[0];
    const byTask = (await qs(`select task, count(*)::int as entries, coalesce(sum(hits), 0)::int as hits from ai_cache where ${wsWhere()} group by task order by hits desc`, wsArgs())).rows;
    return { entries: r.entries, hits: r.hits, savedChars: Number(r.saved_chars), byTask };
  } catch { return { entries: 0, hits: 0, savedChars: 0, byTask: [] }; }
}
export async function cacheClear() { try { await qs(`delete from ai_cache where ${wsWhere()}`, wsArgs()); } catch { /* nothing to clear */ } }
