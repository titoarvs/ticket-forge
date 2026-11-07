import { api, perm, ndjson } from '@/lib/server/http';
import { installCli } from '@/lib/claude.js';

// Installs Claude Code into TicketForge's data folder and streams npm's output.
export const POST = api(async (req) => {
  await perm('users.manage');
  return ndjson(req, async (send) => {
    const info = await installCli((line: string) => send({ type: 'log', line }));
    send({ type: 'done', cli: info });
  });
});
