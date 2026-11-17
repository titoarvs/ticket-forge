import { api, authed, body, HttpError, aiOpts } from '@/lib/server/http';
import * as store from '@/lib/store';
import { currentContext } from '@/lib/db';
import { selectTests } from '@/lib/testselect';
import { ensureAgent } from '@/lib/agents';

// Test automation → Smart selection (Test Selection Agent): which tests to run for the current change. Nothing runs here.
export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  if (!store.has(user, 'ai.use') || !store.has(user, 'test.run')) throw new HttpError(403, 'Smart selection needs the AI and Run tests permissions.');
  await ensureAgent('test-selection');
  const b = await body(req);
  const project = await store.getProject(p.id);
  const useCode = b.useCode !== false && Boolean((currentContext() as any).local);
  return selectTests({ project, budget: Math.max(1, Math.min(200, Number(b.budget) || 25)), goal: String(b.goal || '').slice(0, 500), useCode, includeManual: Boolean(b.includeManual), ai: aiOpts(b) });
});
