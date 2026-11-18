// Drizzle ORM client. It sends every statement through lib/db.ts, so it behaves exactly like q() and qs():
//   • the same database (Supabase / PostgreSQL, or the built-in local one), the same connection pool,
//   • the same row-level security: queries run as the signed-in user's role and workspace (see asUser, asSystem),
//   • no second connection to configure.
// Use it like any Drizzle database:
//     import { orm, projects, eq } from '@/lib/orm';
//     const rows = await orm.select().from(projects).where(eq(projects.workspaceId, ws));
// For work outside a signed-in request (startup, webhooks, background jobs) wrap it like qs():
//     const rows = await asSystem(async () => await orm.select().from(workspaces));
// (Write `async () => await …`: a Drizzle query only runs when it is awaited, and that must happen inside asSystem.)
// Transactions: Drizzle's own `orm.transaction` isn't available through a proxy driver; use `tx()` from lib/db.ts.
// Tables are created by lib/db.ts; each one has its own typed file in lib/schema/. After changing a table in lib/db.ts,
// run `npm run db:schema` to refresh those files.
import { drizzle } from 'drizzle-orm/pg-proxy';
import * as schema from './schema/index';
import * as relations from './relations';
import { qrows } from './db';

export const orm = drizzle(async (sql, params) => {
  const r: any = await qrows(sql, params as any[]);
  return { rows: r.rows };
}, { schema: { ...schema, ...relations } });

export * from './schema/index';
export { sql, eq, ne, and, or, not, inArray, notInArray, isNull, isNotNull, gt, gte, lt, lte, like, ilike, desc, asc } from 'drizzle-orm';
