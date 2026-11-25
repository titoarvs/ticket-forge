// Runs once when the server starts. It notes the connection address of every request (lib/peer.ts),
// which decides what counts as "on this computer". And when DATABASE_URL (or SUPABASE_DB_URL) is
// set, it connects to PostgreSQL right away, so a wrong connection string stops the server with a
// clear message instead of every page failing later.
// Tables are still created on the first request (see ready() in lib/server/http.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  (await import('./lib/peer')).watchPeers();
  if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) return; // the built-in local database needs no connection
  const { db } = await import('./lib/db');
  try {
    await db();
  } catch (e) {
    console.error(`\nTicketForge could not connect to its database.\n${(e as Error).message}\n`);
    throw e;
  }
}
