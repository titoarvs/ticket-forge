import { api, perm, body } from '@/lib/server/http';
import { jevStatus, saveJev, removeJevKey, testJev } from '@/lib/jev';

// Jev (TypeSafe AI) for decisions, for administrators: the API key (stored encrypted, never sent back) and whether it is on.
export const GET = api(async () => {
  await perm('users.manage');
  return jevStatus();
});
export const PUT = api(async (req) => {
  const u = await perm('users.manage');
  return saveJev(await body(req), u);
});
export const DELETE = api(async () => {
  await perm('users.manage');
  return removeJevKey();
});
/** Tests the saved key with a small real call. */
export const POST = api(async () => {
  await perm('users.manage');
  return testJev();
});
