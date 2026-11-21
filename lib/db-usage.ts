// Which kind of database the app uses and how full it is, for Administration → Email & database
// and `npm run db:switch -- status`. The Supabase free plan allows 500 MB of database space: near
// it, the card points to `npm run db:switch -- local` (a PostgreSQL database on this computer, moved
// back to Supabase later with `-- hosted`). Other hosts have no limit known here.
import { hostOf, isLocalHost } from './db-config';

export const SUPABASE_FREE_BYTES = 500 * 1024 * 1024;
/** From this share of the free plan on, the switch is suggested. */
export const NEAR_LIMIT_PERCENT = 80;

export type DbKind = 'supabase' | 'local' | 'other' | 'builtin';

/** builtin: no DATABASE_URL (the embedded database); local: PostgreSQL on this computer. */
export function kindOf(url: string): DbKind {
  if (!url) return 'builtin';
  const host = hostOf(url);
  if (/(^|\.)supabase\.(co|com)$/i.test(host)) return 'supabase';
  return isLocalHost(host) ? 'local' : 'other';
}

export function usageOf(kind: DbKind, sizeBytes: number | null) {
  const limitBytes = kind === 'supabase' ? SUPABASE_FREE_BYTES : null;
  const percent =
    limitBytes && sizeBytes != null ? Math.round((sizeBytes / limitBytes) * 100) : null;
  return {
    kind,
    sizeBytes,
    limitBytes,
    percent,
    nearLimit: percent != null && percent >= NEAR_LIMIT_PERCENT,
  };
}

export const mb = (bytes: number | null) =>
  bytes == null ? '—' : `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
