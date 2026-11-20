import { api, perm, body, aiOpts } from '@/lib/server/http';
import { regroupEpics } from '@/lib/generate';
import * as store from '@/lib/store';

export const POST = api(async (req) => {
  const u = await perm('ai.use');
  const b = await body(req);
  if (b.project?.id) await store.requireProject(u, b.project.id);
  return regroupEpics({ project: b.project, instruction: b.instruction, ai: aiOpts(b) });
});
