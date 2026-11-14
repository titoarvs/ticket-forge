import { api, perm, body, HttpError, aiOpts, ndjson } from '@/lib/server/http';
import { testsForIssues } from '@/lib/generate.js';
import * as store from '@/lib/store.js';

// Test cases for many issues: up to 5 per AI request. Streams { type: 'batch', results, missing, done, total } and
// { type: 'done' }. The issues are read from the saved project.
export const POST = api(async (req) => {
  const u = await perm('ai.use');
  const b = await body(req);
  if (!b.projectId || !Array.isArray(b.ticketIds) || !b.ticketIds.length) throw new HttpError(400, 'Which issues?');
  await store.requireProject(u, String(b.projectId));
  const project = await store.getProject(String(b.projectId));
  const ai = aiOpts(b);
  return ndjson(req, async (send, signal) => {
    const out = await testsForIssues({ project, ticketIds: b.ticketIds.slice(0, 500), answers: b.answers, ai, signal, onBatch: (x: any) => send({ type: 'batch', ...x }) });
    send({ type: 'done', ...out });
  });
});
