import { api, perm, body, aiOpts } from '@/lib/server/http';
import * as store from '@/lib/store';
import { buildTestPlan } from '@/lib/testplan';

export const maxDuration = 300;

// Test management → Build plan with AI: proposes the tests for a plan. Nothing is saved here.
export const POST = api(async (req, p) => {
  const user = await perm('ai.use');
  store.requireAccess(user, p.id);
  const b = await body(req);
  return buildTestPlan({ project: await store.getProject(p.id), kind: String(b.kind || 'regression'), goal: String(b.goal || '').slice(0, 2000),
    epicIds: Array.isArray(b.epicIds) ? b.epicIds.map(String) : [], sprintId: String(b.sprintId || ''), maxTests: Math.min(150, Math.max(3, Number(b.maxTests) || 40)), ai: aiOpts(b) });
});
