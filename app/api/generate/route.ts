import { api, perm, body, HttpError, aiOpts, ndjson } from '@/lib/server/http';
import { generateProject } from '@/lib/generate';
import * as store from '@/lib/store';

export const POST = api(async (req) => {
  const user = await perm('project.create', 'ai.use');
  const { text, sourceName, options = {} } = await body(req);
  if (!text || text.trim().length < 20)
    throw new HttpError(400, 'The document is empty or too short.');
  return ndjson(req, async (send, signal) => {
    const project = await generateProject({
      text,
      sourceName,
      signal,
      options: { ...options, ...aiOpts(options) },
      emit: (e: any) => send({ type: 'progress', ...e }),
    } as any);
    send({ type: 'done', project: await store.createProject(project, user) });
  });
});
