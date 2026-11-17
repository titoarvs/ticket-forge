import { api, authed, body, HttpError, aiOpts, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store';
import { generateFbd } from '@/lib/fbd';

export const maxDuration = 300;

// Writes the Feature Brief for one epic from the team's template. Nothing is saved here: the app stores it on the epic.
export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  if (!store.has(user, 'ai.use') || !store.has(user, 'epic.manage')) throw new HttpError(403, 'Writing a Feature Brief needs the AI and epic permissions.');
  const b = await body(req);
  const project = await store.getProject(p.id);
  const epic = project.epics.find((e: any) => e.id === b.epicId);
  if (!epic) throw new HttpError(404, 'That epic isn’t in this project (save first if you just created it).');
  const meta = { version: epic.fbd?.version || 'v1.0', status: epic.fbd?.status || 'Draft', date: new Date().toISOString().slice(0, 10), preparedBy: user.name };
  return ndjson(req, async (send) => {
    send({ type: 'progress', message: 'Filling the Feature Brief template from the epic, its issues and its Problem Statement…' });
    const out = await generateFbd({ project, epicId: String(b.epicId), instructions: String(b.instructions || '').slice(0, 2000), ai: aiOpts(b), meta });
    send({ type: 'done', ...out, meta });
  });
});
