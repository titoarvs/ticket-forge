import { api, perm, authed, body, HttpError } from '@/lib/server/http';
import { publicArdTemplate, saveArdTemplate, resetArdTemplate } from '@/lib/ard';

// Administration → Generation → Architecture Record Design template (Markdown). The team's file is the default.
export const GET = api(async () => { await authed(); return { template: await publicArdTemplate() }; });
export const PUT = api(async (req) => {
  const user = await perm('users.manage');
  const b = await body(req);
  try { return { template: await saveArdTemplate(user, b.text, b.name) }; } catch (e: any) { throw new HttpError(e.status || 500, e.message); }
});
export const DELETE = api(async () => { await perm('users.manage'); return { template: await resetArdTemplate() }; });
