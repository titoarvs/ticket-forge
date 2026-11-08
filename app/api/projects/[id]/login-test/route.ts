import { api, perm, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { testLogin, engineStatus, noBrowser } from '@/lib/automation.js';
import { appWithSecrets } from '@/lib/secrets.js';
import { savedSetup } from '@/lib/server/app-setup';

// Signs in as one role on the saved application URL and reports the result with a screenshot.
export const POST = api(async (req, p) => {
  const user = await perm('test.run');
  store.requireAccess(user, p.id);
  const b = await body(req);
  const saved = await savedSetup(p.id);
  if (!/^https?:\/\//i.test(saved.baseUrl)) throw new HttpError(400, 'Set the application URL first.');
  if (!(await engineStatus()).browser) throw new HttpError(400, noBrowser());
  return testLogin({ baseUrl: saved.baseUrl, app: await appWithSecrets(p.id, saved.app), role: String(b.roleId || '') });
});
