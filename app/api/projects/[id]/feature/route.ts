import { api, perm, body, HttpError, aiOpts, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { extendProject } from '@/lib/generate.js';

// Add feature: plans new epics and issues (with test cases) for an existing project from a description or a
// document. Nothing is saved; the person reviews the result and adds what they choose.
export const POST = api(async (req, p) => {
  const user = await perm('ai.use', 'issue.create');
  store.requireAccess(user, p.id);
  const { text, sourceName, options = {} } = await body(req);
  if (!text || String(text).trim().length < 15) throw new HttpError(400, 'Describe the feature in a sentence or two, or add a document.');
  const project = await store.getProject(p.id);
  return ndjson(req, async (send, signal) => {
    const result = await extendProject({ project, text: String(text), sourceName, signal, options: { ...options, ...aiOpts(options) }, emit: (e: any) => send({ type: 'progress', ...e }) } as any);
    send({ type: 'done', result });
  });
});
