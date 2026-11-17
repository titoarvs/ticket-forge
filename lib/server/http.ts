// Helpers shared by the Next.js route handlers.
import { lockedFeatureFor, lockedMessage } from '../features';
import { cookies, headers } from 'next/headers';
import * as auth from '@/lib/auth';
import { migrate, asSystem, asUser, currentContext, SCHEMA_VERSION, DEFAULT_WS } from '@/lib/db';
import * as store from '@/lib/store';
import { isLocalHost } from '@/lib/claude';
import { isSaas, scrubSharedTokens, platformAdminEmails } from '@/lib/platform';
import { lockStatus } from '@/lib/limits';

const G = globalThis as any;

/** Creates tables, seeds roles and imports legacy JSON projects — once per server process, and again when the schema changes. */
export function ready(): Promise<void> {
  if (G.__tfReadyFor !== SCHEMA_VERSION) { G.__tfReady = null; G.__tfReadyFor = SCHEMA_VERSION; }
  G.__tfReady ??= (async () => {
    scrubSharedTokens();
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
/** Only the owner (the first account, created at setup): managing users and invites. */
export async function ownerOnly() {
  const u: any = await authed();
  if (!u.is_owner) throw new HttpError(403, 'Only the owner can manage users and invites.');
  return u;
}
/** Whether this user may set up payment gateways and plans: the owner of the default workspace, or a platform admin (PLATFORM_ADMIN_EMAILS). */
export const runsThePlatform = (u: any) => Boolean(u?.is_owner && (u.workspace_id === DEFAULT_WS || platformAdminEmails().includes(String(u.email).toLowerCase())));
/** Only the owner who runs this TicketForge: payment gateways and plans (Administration → Billing). */
export async function platformOwner() {
  const u: any = await authed();
  if (!runsThePlatform(u)) throw new HttpError(403, 'Only the owner who runs this TicketForge can set up payment gateways and plans.');
  return u;
}
export async function perm(...perms: string[]) {
  const u = await authed();
  for (const p of perms) store.requirePerm(u, p);
  return u;
}

export async function startSession(userId: string, ws: string | null = null) {
  const h = await headers();
  const s = await auth.createSession(userId, h.get('user-agent') || '', ws);
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
export const aiOpts = (b: any) => {
  const c: any = currentContext();
  const pid = b?.projectId || b?.project?.id;
  if (!c.projectId && typeof pid === 'string' && /^[\w-]{1,64}$/.test(pid)) c.projectId = pid;
  return aiOptsOf(b);
};
const aiOptsOf = (b: any) => ({ provider: b?.provider || undefined, model: b?.model || undefined, run: typeof b?.run === 'string' && /^(auto|high|standard|light|cfg:[\w-]{1,40})$/.test(b.run) ? b.run : undefined, fresh: b?.fresh === true || b?.regenerate === true || undefined });

/** API routes that still work while the workspace is locked, so the owner can sign in, see the plans and pay. */
const LOCK_EXEMPT = /^\/api\/(auth|billing|plans|features|status)(\/|$)/;

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
      // Opened on this computer (localhost)? Then AI uses your Claude account, otherwise the configured AI API.
      // On the hosted service (SaaS) never: the server's own Claude sign-in must not answer for other companies.
      const local = !isSaas() && isLocalHost(req.headers.get('x-forwarded-host') || req.headers.get('host'));
      // The project this request is about (for AI usage per project): from the address, or set by aiOpts from the body.
      const projectId = decodeURIComponent(new URL(req.url).pathname.match(/^\/api\/projects\/([^/]+)/)?.[1] || '') || null;
      // Workspaces: a project of another workspace doesn't exist as far as this request is concerned.
      if (projectId && user) {
        const w = await store.projectWorkspace(projectId);
        if (w && w !== user.workspace_id) throw new HttpError(404, 'Project not found');
      }
      const out = await asUser(user?.id, async () => {
        // A trial that ended without a payment locks the workspace: everything but sign-in and billing refuses until it is paid.
        if (user && !LOCK_EXEMPT.test(new URL(req.url).pathname)) {
          const lock = await lockStatus(user.workspace_id);
          if (lock.locked) throw Object.assign(new HttpError(402, `Your ${lock.plan.name} trial has ended. Pay to keep using this workspace.`), { extra: { code: 'locked', plan: lock.plan.id } });
        }
        // Feature flags: a feature the workspace owner locked refuses its API routes for everyone in that workspace.
        const locked = await lockedFeatureFor(new URL(req.url).pathname);
        if (locked) throw new HttpError(423, lockedMessage(locked));
        return resolve(fn, req, ctx?.params ? ctx.params : Promise.resolve({}));
      }, user, { local, projectId, runOn: req.headers.get('x-tf-run-on') === 'github' ? 'github' : 'local' });
      return out instanceof Response ? out : Response.json(out ?? { ok: true });
    } catch (e) {
      if (!e.status || e.status >= 500) console.error(e);
      return Response.json({ error: e.message || String(e), ...(e.extra || {}) }, { status: e.status || 500 });
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
      catch (e) { if (!ctrl.signal.aborted) send({ type: 'error', error: e.message, message: e.message, ...(e.extra || {}) }); }
      finally { clearInterval(ping); open = false; try { controller.close(); } catch { /* closed */ } }
    },
    cancel() { ctrl.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
}

export async function body(req: Request) { try { return await req.json(); } catch { return {}; } }
