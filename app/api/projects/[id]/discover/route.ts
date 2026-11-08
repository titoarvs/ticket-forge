import { api, perm, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { discoverPages, engineStatus } from '@/lib/automation.js';
import { maskSecrets } from '@/lib/app-helpers.mjs';
import { appWithSecrets } from '@/lib/secrets.js';
import { savedSetup } from '@/lib/server/app-setup';

// Finds the app's pages by following links from the saved application URL, optionally signed in as a role.
export const POST = api(async (req, p) => {
  const user = await perm('project.settings');
  store.requireAccess(user, p.id);
  const b = await body(req);
  const saved = await savedSetup(p.id);
  if (!/^https?:\/\//i.test(saved.baseUrl)) throw new HttpError(400, 'Set the application URL first.');
  if (!(await engineStatus()).browser) throw new HttpError(400, 'The test browser is not installed yet.');
  const app = await appWithSecrets(p.id, saved.app);
  try {
    return { pages: await discoverPages({ baseUrl: saved.baseUrl, app, role: b.role ? String(b.role) : undefined }) };
  } catch (e: any) {
    throw new HttpError(400, `Couldn’t explore the app: ${maskSecrets(String(e.message || e).split('\n')[0], app)}`);
  }
});
