// Drizzle Kit, for browsing data (npm run db:studio) and for generating the baseline migration (npm
// run db:generate).
// Tables, row-level security and migrations are defined in lib/db.ts, so there is deliberately no
// `push` or `migrate` script: drizzle-kit would not know about the policies, roles and triggers
// there. To refresh the typed schema (one file per table in lib/schema/) after changing lib/db.ts,
// run `npm run db:schema`.
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/schema',
  out: './drizzle',
  ...(url
    ? { dbCredentials: { url } }
    : {
        driver: 'pglite',
        dbCredentials: { url: `${process.env.TICKETFORGE_DATA || './data'}/db` },
      }),
});
