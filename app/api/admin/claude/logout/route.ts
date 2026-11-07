import { api, perm } from '@/lib/server/http';
import { logout, providerStatus } from '@/lib/claude.js';

export const POST = api(async () => {
  await perm('users.manage');
  await logout();
  return providerStatus({ details: true });
});
