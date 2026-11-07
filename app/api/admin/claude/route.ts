import { api, perm } from '@/lib/server/http';
import { providerStatus, accountStatus } from '@/lib/claude.js';

// Claude connection details for administrators (includes the signed-in account's email and organization).
export const GET = api(async (req) => {
  await perm('users.manage');
  if (new URL(req.url).searchParams.get('fresh')) await accountStatus({ fresh: true });
  return providerStatus({ details: true });
});
