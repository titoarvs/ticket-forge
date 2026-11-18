import { api, perm, body, HttpError, aiOpts, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store';
import { splitIssues } from '@/lib/split';

export const maxDuration = 300;

// Proposes smaller issues for many issues at once (Epics page / epic panel). Streams progress. Nothing is saved here.
export const POST = api(async (req, p) => {
  const user = await perm('ai.use', 'issue.create');
  store.requireAccess(user, p.id);
  const b = await body(req);
  const ids = (Array.isArray(b.ticketIds) ? b.ticketIds : []).map(String).slice(0, 60);
  if (!ids.length) throw new HttpError(400, 'Pick the issues to split.');
  const project = await store.getProject(p.id);
  return ndjson(req, async (send, signal) => {
    const out = await splitIssues({
      project,
      ticketIds: ids,
      instruction: String(b.instruction || '').slice(0, 2000),
      ai: { ...aiOpts(b), signal },
      emit: send,
    });
    send({ type: 'done', ...out });
  });
});
