import { api, perm, body, HttpError, aiOpts, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store';
import { brainstormFeature } from '@/lib/brainstorm';

// Add feature, step 1: brainstorming the feature before any epic or issue exists. Nothing is saved.
export const maxDuration = 300;
export const POST = api(async (req, p) => {
  const user = await perm('ai.use', 'issue.create');
  store.requireAccess(user, p.id);
  const b = await body(req);
  const text = String(b.text || '');
  if (text.trim().length < 15) throw new HttpError(400, 'Describe the feature in a sentence or two, or add a document.');
  const project = await store.getProject(p.id);
  return ndjson(req, async (send, signal) => {
    const result = await brainstormFeature({ project, text, sourceName: String(b.sourceName || ''), answers: String(b.answers || ''), instructions: String(b.instructions || ''), ai: { ...aiOpts(b), signal }, emit: (e: any) => send({ type: 'progress', ...e }) });
    send({ type: 'done', result });
  });
});
