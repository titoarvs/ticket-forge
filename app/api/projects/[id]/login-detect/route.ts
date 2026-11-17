import { api, perm, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { detectLogin, engineStatus, noBrowser } from '@/lib/automation';
import { savedSetup } from '@/lib/server/app-setup';

// Driving a browser takes a while: let this run up to 2 minutes on serverless hosting (Vercel).
export const maxDuration = 120;

// Finds the app's login form on the saved application URL (no signing in: nothing is typed or submitted).
export const POST = api(async (_req, p) => {
  const user = await perm('test.run');
  store.requireAccess(user, p.id);
  const saved = await savedSetup(p.id);
  if (!/^https?:\/\//i.test(saved.baseUrl)) throw new HttpError(400, 'Set the application URL first.');
  if (!(await engineStatus()).browser) throw new HttpError(400, noBrowser());
  try { return await detectLogin({ baseUrl: saved.baseUrl, app: saved.app }); }
  catch (e: any) { throw new HttpError(422, String(e.message || e).split('\n')[0]); }
});
