// The App setup (pages, roles, login) used by test runs, page discovery and login tests. It always comes from the
// SAVED project, and role passwords are only filled in for the project's saved application URL, so nobody can
// point a run at another site to capture them.
import * as store from '@/lib/store.js';
import { appWithSecrets } from '@/lib/secrets.js';

const originOf = (u: string) => { try { return new URL(u).origin; } catch { return ''; } };

export async function savedSetup(projectId: string) {
  const p = await store.getProject(projectId);
  return { baseUrl: String(p?.automation?.baseUrl || '').trim(), app: p?.automation?.app || {} };
}

/** For a run against `baseUrl`: the app map, with passwords only when it's the project's saved application URL. */
export async function runAppSetup(projectId: string | undefined, baseUrl: string) {
  if (!projectId) return { app: { pages: [], roles: [], login: {}, notes: '' }, warning: null };
  const saved = await savedSetup(projectId);
  const app = await appWithSecrets(projectId, saved.app);
  const hasPasswords = app.roles.some((r: any) => r.password || r.totp || r.session);
  if (hasPasswords && originOf(baseUrl) !== originOf(saved.baseUrl)) {
    // Passwords, MFA secrets and saved sessions never go to another site.
    for (const r of app.roles as any[]) { if (r.password || r.totp || r.session) r.blocked = true; r.password = ''; r.totp = ''; r.session = null; }
    return { app, warning: `Saved role passwords are only used with the project’s saved application URL (${saved.baseUrl || 'not set'}), so tests that sign in will fail on ${baseUrl}.` };
  }
  return { app, warning: null };
}
