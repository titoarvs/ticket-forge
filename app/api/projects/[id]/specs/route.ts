import { api, authed, perm, body, HttpError, aiOpts } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { generateSpecs } from '@/lib/specgen.js';

export const maxDuration = 300;

// Coding specs of a project (or of one epic with ?epicId=): the prompts, the files they touch, the overlaps between
// them and the project's overlap and reviewer settings. Everyone with access sees them.
export const GET = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  const epicId = new URL(req.url).searchParams.get('epicId') || '';
  return { ...(await store.listSpecs(p.id, epicId)), canEdit: store.has(user, 'issue.edit'), canGenerate: store.has(user, 'ai.use') && store.has(user, 'issue.edit') };
});

// Generate coding specs: one prompt per ticket of the epic, saved as drafts (an earlier spec of the same ticket is replaced).
export const POST = api(async (req, p) => {
  const user = await perm('ai.use', 'issue.edit');
  store.requireAccess(user, p.id);
  const b = await body(req);
  const project = await store.getProject(p.id);
  const epic = (project.epics || []).find((e: any) => e.id === String(b.epicId || ''));
  if (!epic) throw new HttpError(404, 'Epic not found');
  const generated = await generateSpecs({ project, epic, ai: aiOpts(b) });
  return store.saveSpecs(p.id, epic.id, generated, user);
});
