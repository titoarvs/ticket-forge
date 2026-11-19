// Reads and writes the app_meta table (key → JSON value) with Drizzle. Settings, feature flags,
// generation rules, agents and saved secrets all live there; row-level security limits the table to
// the server, so these run in system context.
// Keys of a workspace come from wsKey() in wsmeta.ts.
import { eq } from 'drizzle-orm';
import { orm, appMeta } from './orm';
import { asSystem } from './db';

/** The value saved under `key`, or undefined. */
export async function getMeta(key: string): Promise<any> {
  // `await` inside asSystem: a Drizzle query only runs when awaited, and it must run inside the
  // system context.
  return asSystem(async () => {
    const [row] = await orm
      .select({ value: appMeta.value })
      .from(appMeta)
      .where(eq(appMeta.key, key));
    return row?.value;
  });
}

/** Saves `value` under `key`, replacing what was there. */
export async function setMeta(key: string, value: any): Promise<void> {
  await asSystem(async () => {
    await orm
      .insert(appMeta)
      .values({ key, value })
      .onConflictDoUpdate({ target: appMeta.key, set: { value } });
  });
}

/** Forgets `key`. */
export async function deleteMeta(key: string): Promise<void> {
  await asSystem(async () => {
    await orm.delete(appMeta).where(eq(appMeta.key, key));
  });
}
