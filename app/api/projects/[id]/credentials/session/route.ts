import { api, perm, body, HttpError, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store';
import { SERVERLESS, currentContext } from '@/lib/db';
import { setRoleSecret, credentialStatus } from '@/lib/secrets';
import { onLoginish } from '@/lib/app-helpers.mjs';
import { systemBrowser } from '@/lib/browser.mjs';

export const maxDuration = 300;
const WAIT_MS = 5 * 60 * 1000;

// "Sign in in a browser": opens a visible browser window on this computer at the app's sign-in page. The person signs
// in by hand (SSO, Google, passkey, push MFA — anything); once the app is reached, the signed-in session (cookies and
// local storage) is saved encrypted for the role. Test runs then start signed in. Local only.
export const POST = api(async (req, p) => {
  const user = await perm('project.settings');
  store.requireAccess(user, p.id);
  if (SERVERLESS || !(currentContext() as any).local)
    throw new HttpError(
      400,
      'Saving a session opens a browser window, so it works only when TicketForge runs on your computer (opened at localhost).',
    );
  const b = await body(req);
  const project = await store.getProject(p.id);
  const baseUrl = String(project.automation?.baseUrl || '').trim();
  if (!/^https?:\/\//i.test(baseUrl)) throw new HttpError(400, 'Set the application URL first (Test automation → Settings).');
  const app = project.automation?.app || {};
  const role = (app.roles || []).find((r: any) => r.id === b.roleId);
  if (!role) throw new HttpError(404, 'That role isn’t in the App setup (save first if you just added it).');
  const loginPath = String(app.login?.path || '').trim();
  const success = String(app.login?.success || '').trim();
  return ndjson(req, async (send, signal) => {
    const { chromium } = await import('@playwright/test');
    // Real Chrome or Edge when installed: identity providers (Google especially) trust it more than a test browser.
    const sys = systemBrowser();
    const browser = await chromium.launch({
      headless: false,
      ...(sys ? { channel: sys.channel } : {}),
      args: ['--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    const stop = () => browser.close().catch(() => {});
    signal?.addEventListener('abort', stop);
    try {
      const context = await browser.newContext({ baseURL: baseUrl, viewport: null });
      const page = await context.newPage();
      const origin = new URL(baseUrl).origin;
      await page.goto(loginPath || '/', { waitUntil: 'domcontentloaded' }).catch(() => {});
      send({
        type: 'progress',
        message: `A ${sys?.label || 'Chromium'} window opened at ${new URL(page.url()).host}. Sign in as ${role.name}${role.username ? ` (${role.username})` : ''} there — any way the app allows. It closes by itself once you’re in.`,
      });
      // Signed in = on the app's own site, past every login / MFA step, for 3 checks in a row.
      const end = Date.now() + WAIT_MS;
      let streak = 0,
        seenLogin = false;
      while (Date.now() < end) {
        if (signal?.aborted) throw new Error('Stopped.');
        if (!browser.isConnected() || page.isClosed()) throw new Error('The browser window was closed before signing in finished.');
        await page.waitForTimeout(1000);
        let here: URL;
        try {
          here = new URL(page.url());
        } catch {
          continue;
        }
        const onApp = here.origin === origin;
        if (!onApp || onLoginish(page, loginPath)) {
          seenLogin = true;
          streak = 0;
          continue;
        }
        // Without a login page set, the start page may itself be signed-out: wait until the person went through a sign-in.
        let ok = seenLogin || Boolean(loginPath);
        if (success)
          ok = success.startsWith('/')
            ? here.pathname.startsWith(success)
            : await page
                .getByText(success)
                .first()
                .isVisible()
                .catch(() => false);
        streak = ok ? streak + 1 : 0;
        if (streak >= 3) break;
      }
      if (streak < 3) throw new Error('Timed out after 5 minutes without reaching the app signed in.');
      const state = await context.storageState();
      const appCookies = state.cookies.filter((c: any) => origin.includes(c.domain.replace(/^\./, '')));
      const expiring = appCookies.map((c: any) => c.expires).filter((x: number) => x > 0);
      const expires = expiring.length ? new Date(Math.min(...expiring) * 1000).toISOString() : null;
      const landing = new URL(page.url()).pathname;
      await setRoleSecret(p.id, role.id, 'session', JSON.stringify({ ...state, landing }), user, {
        sessionAt: new Date().toISOString(),
        sessionBy: user.name,
        sessionExpires: expires,
      });
      send({ type: 'done', landing, cookies: state.cookies.length, expires, status: await credentialStatus(p.id) });
    } finally {
      signal?.removeEventListener('abort', stop);
      await stop();
    }
  });
});
