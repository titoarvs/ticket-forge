import { api, authed, body, HttpError } from '@/lib/server/http';
import { publicMyAi, saveMyAi, myAi } from '@/lib/user-ai';
import { askViaSubscription, cliInfo } from '@/lib/claude';
import { SERVERLESS } from '@/lib/db';

// My AI (everyone, for themselves): their own Claude subscription token, stored encrypted and readable only by them.
export const GET = api(async () => {
  await authed();
  const cli = await cliInfo().catch(() => ({ available: false }));
  return { ...(await publicMyAi()), claudeCode: Boolean(cli.available), serverless: SERVERLESS };
});
export const PUT = api(async (req) => {
  await authed();
  const b = await body(req);
  return saveMyAi({ token: b.token, model: b.model, enabled: b.enabled, teamFallback: b.teamFallback, codeJobs: b.codeJobs, clear: Boolean(b.clear) });
});
// { token? } tests a new token, or the saved one: a tiny prompt through Claude Code.
export const POST = api(async (req) => {
  await authed();
  const b = await body(req);
  const saved = await myAi();
  const token = String(b.token || '').trim() || saved?.token || '';
  if (!token) throw new HttpError(400, 'Paste your token first.');
  if (!/^sk-ant-oat/i.test(token)) throw new HttpError(400, 'That isn’t a Claude subscription token (it starts with sk-ant-oat01-).');
  const started = Date.now();
  try {
    const reply = await askViaSubscription({ system: 'You are a connection test. Follow the instruction exactly.', prompt: 'Reply with exactly: OK', model: String(b.model || saved?.model || 'haiku'), cfg: { key: token } });
    return { ok: true, ms: Date.now() - started, reply: String(reply).trim().slice(0, 40) };
  } catch (e: any) { return { ok: false, ms: Date.now() - started, error: e.message }; }
});
