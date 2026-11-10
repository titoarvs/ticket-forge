import { api, perm, body, aiOpts } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { classifyLayers } from '@/lib/layers.js';

export const maxDuration = 300;

// Marks issues as frontend, backend or both with the AI. Nothing is saved here: the app applies the result.
export const POST = api(async (req, p) => {
  const user = await perm('ai.use', 'issue.edit');
  store.requireAccess(user, p.id);
  const b = await body(req);
  return classifyLayers({ project: await store.getProject(p.id), onlyMissing: b.all !== true, ai: aiOpts(b) });
});
