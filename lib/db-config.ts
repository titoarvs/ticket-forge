// Database connection settings, read from environment variables only. Nothing here depends on which company hosts
// PostgreSQL: moving to another host (Supabase, Neon, RDS, your own server...) means changing these variables.
//   DATABASE_URL (or SUPABASE_DB_URL)  postgresql://user:password@host:5432/database
//   PGSSL                              empty = encrypted, certificate not checked; "verify" = also check the certificate;
//                                      "disable" = no SSL. Empty falls back to ?sslmode= in the URL.
//   PG_POOL_MAX                        connections each server keeps open (default 5)
//   PG_CONNECT_TIMEOUT_MS              how long start-up waits for the first connection (default 10000)

export type DbEnv = Record<string, string | undefined>;

export const DEFAULT_POOL_MAX = 5;
export const DEFAULT_CONNECT_TIMEOUT_MS = 10000;

/** The configured connection string, or '' when the built-in local database is used. */
export const databaseUrl = (env: DbEnv = process.env) => (env.DATABASE_URL || env.SUPABASE_DB_URL || '').trim();

/** The connection string must be a postgres:// or postgresql:// address; anything else stops the app with a clear message. */
export function checkConnectionString(url: string, name = 'DATABASE_URL') {
  let u: URL | null;
  try {
    u = new URL(url);
  } catch {
    u = null;
  }
  if (!u || !/^postgres(ql)?:$/.test(u.protocol) || !u.hostname) {
    throw new Error(
      `${name} is not a valid PostgreSQL connection string. Use the form postgresql://user:password@host:5432/database ` +
        '(URL-encode special characters in the password, such as @ # / as %40 %23 %2F)' +
        (name === 'DATABASE_URL' ? ', or remove DATABASE_URL to use the built-in local database.' : '.'),
    );
  }
}

/** The host name of a connection string (never the user or password), for messages and logs. */
export function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
const portOf = (url: string) => {
  try {
    return new URL(url).port;
  } catch {
    return '';
  }
};
/** "host:port" for messages. */
export const endpointOf = (url: string) => {
  const h = hostOf(url);
  const p = portOf(url);
  return h ? (p ? `${h}:${p}` : h) : '';
};

/** Whether this host is the computer the app runs on (SSL is not used there). */
export const isLocalHost = (host: string) => /^(localhost|127\.0\.0\.1|::1|\[::1\])$/.test(host);

export type PgSsl = false | { rejectUnauthorized: boolean };

/** PGSSL wins; without it the ?sslmode= of the URL decides; without either the connection is encrypted but not verified. */
export function sslFor(url: string, env: DbEnv = process.env): PgSsl {
  const mode = (env.PGSSL || '').trim().toLowerCase();
  if (mode === 'disable') return false;
  if (mode === 'verify') return { rejectUnauthorized: true };
  if (mode) return { rejectUnauthorized: false }; // "require" or anything else asks for plain encryption
  if (isLocalHost(hostOf(url))) return false;
  let sslmode = '';
  try {
    sslmode = (new URL(url).searchParams.get('sslmode') || '').toLowerCase();
  } catch {
    /* checked elsewhere */
  }
  if (sslmode === 'disable') return false;
  if (sslmode === 'verify-full' || sslmode === 'verify-ca') return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

/** The URL handed to node-postgres without SSL parameters: node-postgres would let them override `ssl` (see sslFor). */
export function withoutSslParams(url: string) {
  try {
    const u = new URL(url);
    for (const k of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

const positive = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/** Everything node-postgres needs to connect, from a connection string and the environment. */
export function pgConfig(url: string, env: DbEnv = process.env) {
  return {
    connectionString: withoutSslParams(url),
    ssl: sslFor(url, env),
    max: positive(env.PG_POOL_MAX, DEFAULT_POOL_MAX),
  };
}
export const connectTimeoutMs = (env: DbEnv = process.env) => positive(env.PG_CONNECT_TIMEOUT_MS, DEFAULT_CONNECT_TIMEOUT_MS);
