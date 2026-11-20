import { api, ownerOnly } from '@/lib/server/http';
import * as auth from '@/lib/auth';

export const GET = api(async () => {
  await ownerOnly();
  return auth.listUsers();
});
