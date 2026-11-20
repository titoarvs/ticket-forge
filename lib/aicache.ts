// AI answer cache: an identical request (same task, model choice, system prompt and prompt) within
// N days reuses the stored answer instead of calling the AI again. Only for tasks where a repeat
// answer is what you want (Administration → AI → Model routing → Save usage); "again" /
// "regenerate" actions send fresh: true and skip it. Server-only table.
import crypto from 'node:crypto';
import { asSystem, currentWs, DEFAULT_WS } from './db';
import { orm, aiCache, eq, and, desc, sql } from './orm';

// Each workspace has its own answers: other workspaces' keys start with "<workspace>:" (the default
// one's don't).
const wsPrefix = () => {
  const w = currentWs() || DEFAULT_WS;
  return w === DEFAULT_WS ? '' : `${w}:`;
};
const wsFilter = () =>
  wsPrefix()
    ? sql`${aiCache.key} like ${`${wsPrefix().replace(/[%_\\]/g, '\\$&')}%`}`
    : sql`${aiCache.key} not like '%:%'`;
const days = (n) => sql`(${String(n)}::text || ' days')::interval`;

export const cacheKey = (parts) =>
  wsPrefix() + crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');

export async function cacheGet(key, ttlDays) {
  try {
    const [r] = await asSystem(
      async () =>
        await orm
          .update(aiCache)
          .set({ hits: sql`${aiCache.hits} + 1`, usedAt: sql`now()` })
          .where(and(eq(aiCache.key, key), sql`${aiCache.createdAt} > now() - ${days(ttlDays)}`))
          .returning({ value: aiCache.value }),
    );
    return r ? r.value : null;
  } catch {
    return null;
  } // table not migrated yet, or no database: just call the AI
}
let lastSweep = 0;
export async function cachePut(key, task, value, ttlDays) {
  try {
    await asSystem(async () => {
      await orm
        .insert(aiCache)
        .values({ key, task: task || '', value: String(value), chars: String(value).length })
        .onConflictDoUpdate({
          target: aiCache.key,
          set: { value: String(value), createdAt: sql`now()`, usedAt: sql`now()` },
        });
    });
    if (Date.now() - lastSweep > 36e5) {
      lastSweep = Date.now();
      await asSystem(async () => {
        await orm.delete(aiCache).where(sql`${aiCache.usedAt} < now() - ${days(ttlDays)}`);
      });
    }
  } catch {
    /* caching is best-effort */
  }
}
/** For Administration: how much the cache holds and how often it answered. */
export async function cacheStats() {
  try {
    const hits = sql<number>`coalesce(sum(${aiCache.hits}), 0)::int`;
    const [r] = await asSystem(
      async () =>
        await orm
          .select({
            entries: sql<number>`count(*)::int`,
            hits,
            saved_chars: sql<string>`coalesce(sum(${aiCache.hits} * ${aiCache.chars}), 0)::bigint`,
          })
          .from(aiCache)
          .where(wsFilter()),
    );
    const byTask = await asSystem(
      async () =>
        await orm
          .select({ task: aiCache.task, entries: sql<number>`count(*)::int`, hits })
          .from(aiCache)
          .where(wsFilter())
          .groupBy(aiCache.task)
          .orderBy(desc(sql`coalesce(sum(${aiCache.hits}), 0)`)),
    );
    return { entries: r.entries, hits: r.hits, savedChars: Number(r.saved_chars), byTask };
  } catch {
    return { entries: 0, hits: 0, savedChars: 0, byTask: [] };
  }
}
export async function cacheClear() {
  try {
    await asSystem(async () => {
      await orm.delete(aiCache).where(wsFilter());
    });
  } catch {
    /* nothing to clear */
  }
}
