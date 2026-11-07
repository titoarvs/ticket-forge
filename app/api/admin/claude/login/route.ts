import { api, perm, body, HttpError } from '@/lib/server/http';
import { startLogin, finishLogin, cancelLogin, providerStatus } from '@/lib/claude.js';

// Signs Claude Code on the server in to a Claude account: start → (person signs in, copies the code) → finish.
export const POST = api(async (req) => {
  await perm('users.manage');
  const b = await body(req);
  if (b.action === 'start') return startLogin({ console: b.method === 'console' });
  if (b.action === 'finish') { await finishLogin(String(b.id || ''), b.code); return providerStatus({ details: true }); }
  if (b.action === 'cancel') { cancelLogin(String(b.id || '')); return { ok: true }; }
  throw new HttpError(400, 'Unknown action');
});
