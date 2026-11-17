// Drizzle Kit, for browsing data (npm run db:studio). Tables, row-level security and migrations are defined in lib/db.js,
// so there is deliberately no `push` or `migrate` script: drizzle-kit would not know about the policies, roles and
// triggers there. To refresh the typed schema after changing lib/db.js, run `npm run db:schema`.
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/schema.ts',
  out: './drizzle',
  ...(url ? { dbCredentials: { url } } : { driver: 'pglite', dbCredentials: { url: `${process.env.TICKETFORGE_DATA || './data'}/db` } }),
});
