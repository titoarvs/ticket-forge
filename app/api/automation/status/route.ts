import { api, authed } from '@/lib/server/http';
import { engineStatus } from '@/lib/automation';

export const GET = api(async () => {
  await authed();
  return engineStatus();
});
