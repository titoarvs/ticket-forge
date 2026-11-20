// My AI: each person's own Claude subscription. The token from `claude setup-token` is stored
// encrypted in user_ai, whose row-level security lets only that person (and the server's own system
// work) read it, so nobody else's AI requests or code jobs ever use it. When it's set and on, that
// person's AI requests run on their own subscription first (Claude Code with their token), and
// their code jobs on GitHub Actions run with it too.
import { currentContext } from './db';
import { orm, userAi, eq, sql } from './orm';
import { encrypt, decrypt } from './settings';
import { err } from './errors';

const MODELS = ['opus', 'sonnet', 'haiku'];
const uid = () => currentContext().user?.id || null;

/** The signed-in person's settings, with the token decrypted (server use only), or null. */
export async function myAi(userId = uid()) {
  if (!userId) return null;
  let row;
  try {
    [row] = await orm
      .select({ data: userAi.data, updatedAt: userAi.updatedAt })
      .from(userAi)
      .where(eq(userAi.userId, userId));
  } catch {
    return null;
  }
  if (!row) return null;
  const d: any = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  let token = '';
  try {
    token = d.tokenEnc ? decrypt(d.tokenEnc) : '';
  } catch {
    token = '';
  }
  return {
    enabled: d.enabled !== false,
    model: MODELS.includes(d.model) ? d.model : 'sonnet',
    teamFallback: d.teamFallback !== false,
    codeJobs: d.codeJobs !== false,
    token,
    hint: d.hint || '',
    updatedAt: row.updatedAt,
  };
}
/** What the browser sees: never the token. */
export async function publicMyAi() {
  const m = await myAi();
  return m
    ? {
        hasToken: Boolean(m.token),
        hint: m.hint,
        enabled: m.enabled,
        model: m.model,
        teamFallback: m.teamFallback,
        codeJobs: m.codeJobs,
        updatedAt: m.updatedAt,
      }
    : {
        hasToken: false,
        hint: '',
        enabled: true,
        model: 'sonnet',
        teamFallback: true,
        codeJobs: true,
        updatedAt: null,
      };
}
export async function saveMyAi({
  token,
  model,
  enabled,
  teamFallback,
  codeJobs,
  clear = false,
}: any) {
  const userId = uid();
  if (!userId) throw err('Sign in first.', 401);
  const cur = await myAi(userId);
  const t = String(token || '').trim();
  if (t && !/^sk-ant-oat/i.test(t))
    throw err(
      'That isn’t a Claude subscription token. Run claude setup-token and paste the sk-ant-oat01-… token it prints (an API key, sk-ant-api…, doesn’t work here).',
    );
  const data = {
    tokenEnc: clear ? null : t ? encrypt(t) : cur?.token ? encrypt(cur.token) : null,
    hint: clear ? '' : t ? t.slice(-4) : cur?.hint || '',
    enabled: enabled ?? cur?.enabled ?? true,
    model: MODELS.includes(model) ? model : cur?.model || 'sonnet',
    teamFallback: teamFallback ?? cur?.teamFallback ?? true,
    codeJobs: codeJobs ?? cur?.codeJobs ?? true,
  };
  await orm
    .insert(userAi)
    .values({ userId, data, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: userAi.userId, set: { data, updatedAt: sql`now()` } });
  return publicMyAi();
}
/** The token to use for this person's AI requests now, or null (none, or turned off). */
export async function myActiveToken() {
  const m = await myAi();
  return m?.token && m.enabled ? m : null;
}
