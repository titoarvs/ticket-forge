import { api, perm, body } from '@/lib/server/http';
import { getGuide, saveGuide, clearGuide, GUIDE_MAX } from '@/lib/genrules';

// Administration → Generation → Generation guide: a Markdown document the AI uses as reference context.
export const GET = api(async () => {
  await perm('users.manage');
  return { guide: await getGuide({ fresh: true }), max: GUIDE_MAX };
});
export const PUT = api(async (req) => {
  const user = await perm('users.manage');
  const b = await body(req);
  return { guide: await saveGuide(user, { text: b.text, name: b.name, applyTo: b.applyTo }), max: GUIDE_MAX };
});
export const DELETE = api(async () => {
  await perm('users.manage');
  await clearGuide();
  return { guide: null, max: GUIDE_MAX };
});
