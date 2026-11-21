import { api, ownerOnly } from '@/lib/server/http';
import { q } from '@/lib/db';
import { databaseUrl, hostOf } from '@/lib/db-config';
import { kindOf, usageOf } from '@/lib/db-usage';

// Administration → Email & database → Database: which database the app uses (Supabase, PostgreSQL
// on this computer, another host or the built-in one), its size and, on Supabase, how much of the
// free plan's 500 MB it fills. Owner only. Whether `npm run db:switch` has a saved address to move
// back to (HOSTED_DATABASE_URL) is shown, never the address itself.
export const GET = api(async () => {
  await ownerOnly();
  const url = databaseUrl();
  let size: number | null = null;
  try {
    size = Number((await q('select pg_database_size(current_database()) as n')).rows[0]?.n);
  } catch {
    size = null; // the built-in database can't tell its size
  }
  return {
    ...usageOf(kindOf(url), Number.isFinite(size) ? size : null),
    host: hostOf(url),
    hostedSaved: Boolean((process.env.HOSTED_DATABASE_URL || '').trim()),
  };
});
