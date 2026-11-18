import { api, endSession } from '@/lib/server/http';
export const POST = api(async () => {
  await endSession();
  return { ok: true };
});
