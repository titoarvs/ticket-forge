import { api, perm, ndjson } from '@/lib/server/http';
import { installBrowser } from '@/lib/automation';

export const POST = api(async (req) => {
  await perm('users.manage');
  return ndjson(req, async (send) => {
    await installBrowser((line: string) => send({ type: 'log', line }));
    send({ type: 'done' });
  });
});
