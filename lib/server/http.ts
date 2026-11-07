// Helpers shared by the Next.js route handlers.
import { cookies, headers } from 'next/headers';
import * as auth from '@/lib/auth.js';
import { migrate, asSystem, asUser, currentContext } from '@/lib/db.js';
import * as store from '@/lib/store.js';

const G = globalThis as any;

/** Creates tables, seeds roles and imports legacy JSON projects — once per server process. */
export function ready(): Promise<void> {
  G.__tfReady ??= (async () => {
    await migrate();
    await auth.seedRoles();
    const n = await asSystem(() => store.importJsonProjects());
    if (n) console.log(`Imported ${n} project(s) from data/projects`);
  })().catch((e: Error) => { G.__tfReady = null; throw e; });
  return G.__tfReady;
}

export const HttpError = auth.HttpError;

export async function currentUser() {
  const c: any = currentContext();
  if ('user' in c) return c.user; // resolved once per request by api()
  await ready();
  const jar = await cookies();
  return auth.sessionUser(jar.get(auth.SESSION_COOKIE)?.value);
}
export async function authed() {
  const u = await currentUser();
  if (!u) throw new HttpError(401, 'Sign in to continue.');
  return u;
}
export async function perm(...perms: string[]) {
  const u = await authed();
  for (const p of perms) store.requirePerm(u, p);
  return u;
}

export async function startSession(userId: string) {
  const h = await headers();
  const s = await auth.createSession(userId, h.get('user-agent') || '');
  const jar = await cookies();
  jar.set(auth.SESSION_COOKIE, s.token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: s.maxAge, secure: /^https:/.test(process.env.APP_URL || '') });
}
export async function endSession() {
  const jar = await cookies();
  await auth.destroySession(jar.get(auth.SESSION_COOKIE)?.value);
  jar.delete(auth.SESSION_COOKIE);
}

export async function clientIp() {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || 'local';
}
export const appUrl = (req: Request) => (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '');
export const aiOpts = (b: any) => ({ provider: b?.provider || undefined, model: b?.model || undefined });

type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: Request, params: Record<string, string>) => Promise<any>;
const resolve = async (fn: Handler, req: Request, p: Promise<Record<string, string>>) => fn(req, (await p) || {});

/** Wraps a handler: setup, cross-site check, JSON responses and error mapping. */
export function api(fn: Handler) {
  return async (req: Request, ctx: Ctx) => {
    try {
      await ready();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.headers.get('origin');
        if (origin && new URL(origin).host !== req.headers.get('host')) throw new HttpError(403, 'Cross-site request blocked');
      }
      // Every query in this request runs as the signed-in user, so database row-level security applies.
      const user = await currentUser();
      const out = await asUser(user?.id, () => resolve(fn, req, ctx?.params ? ctx.params : Promise.resolve({})), user);
      return out instanceof Response ? out : Response.json(out ?? { ok: true });
    } catch (e: any) {
      if (!e.status || e.status >= 500) console.error(e);
      return Response.json({ error: e.message || String(e) }, { status: e.status || 500 });
    }
  };
}

/** Streams newline-delimited JSON events. The run is aborted if the client disconnects. */
export function ndjson(req: Request, run: (send: (o: any) => void, signal: AbortSignal) => Promise<void>) {
  const enc = new TextEncoder();
  const ctrl = new AbortController();
  req.signal.addEventListener('abort', () => ctrl.abort());
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (o: any) => { if (open) { try { controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`)); } catch { open = false; } } };
      const ping = setInterval(() => send({ type: 'ping' }), 15000);
      try { await run(send, ctrl.signal); }
      catch (e: any) { if (!ctrl.signal.aborted) send({ type: 'error', error: e.message, message: e.message }); }
      finally { clearInterval(ping); open = false; try { controller.close(); } catch { /* closed */ } }
    },
    cancel() { ctrl.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
}

export async function body(req: Request) { try { return await req.json(); } catch { return {}; } }
