import { api, perm, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { detectLogin, engineStatus } from '@/lib/automation.js';
import { savedSetup } from '@/lib/server/app-setup';

// Finds the app's login form on the saved application URL (no signing in: nothing is typed or submitted).
export const POST = api(async (_req, p) => {
  const user = await perm('test.run');
  store.requireAccess(user, p.id);
  const saved = await savedSetup(p.id);
  if (!/^https?:\/\//i.test(saved.baseUrl)) throw new HttpError(400, 'Set the application URL first.');
  if (!(await engineStatus()).browser) throw new HttpError(400, 'The test browser is not installed yet.');
  try { return await detectLogin({ baseUrl: saved.baseUrl, app: saved.app }); }
  catch (e: any) { throw new HttpError(422, String(e.message || e).split('\n')[0]); }
});
