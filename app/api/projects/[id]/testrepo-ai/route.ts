import { api, perm, body, HttpError, aiOpts, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { writeRepoTests, improveRepoTest } from '@/lib/testwriter.js';

export const maxDuration = 300;

// AI for the test repository: { action: 'write', issueIds, instruction } (streams) · { action: 'improve', test, instruction }.
export const POST = api(async (req, p) => {
  const user = await perm('ai.use');
  store.requireAccess(user, p.id);
  const b = await body(req);
  const project = await store.getProject(p.id);
  if (b.action === 'improve') {
    if (!b.test?.title) throw new HttpError(400, 'Which test?');
    return improveRepoTest({ project, test: b.test, instruction: String(b.instruction || '').slice(0, 1500), ai: aiOpts(b) });
  }
  const ids = (Array.isArray(b.issueIds) ? b.issueIds : []).map(String).slice(0, 40);
  if (!ids.length) throw new HttpError(400, 'Pick the issues to write tests for.');
  return ndjson(req, async (send, signal) => {
    const out = await writeRepoTests({ project, issueIds: ids, instruction: String(b.instruction || '').slice(0, 1500), ai: { ...aiOpts(b), signal }, emit: send });
    send({ type: 'done', ...out });
  });
});
