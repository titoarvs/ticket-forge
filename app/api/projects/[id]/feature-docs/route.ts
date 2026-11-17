import { api, perm, body, HttpError, aiOpts, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store';
import { writeFeatureDoc } from '@/lib/feature-docs';
import { brainstormDigest } from '@/lib/brainstorm';

// Add feature, step 2: writes the Problem Statement, Feature Brief or Architecture Record Design of an epic that is
// still being planned (it isn't saved on the project yet), from the brainstorm and the feature's description.
export const maxDuration = 300;
export const POST = api(async (req, p) => {
  const user = await perm('ai.use', 'issue.create');
  store.requireAccess(user, p.id);
  const b = await body(req);
  const kind = String(b.kind || '');
  if (!['psd', 'fbd', 'ard'].includes(kind)) throw new HttpError(400, 'Unknown document.');
  const e = b.epic || {};
  if (!/^[\w-]{1,64}$/.test(String(e.id || '')) || !String(e.title || '').trim()) throw new HttpError(400, 'The epic needs an id and a title.');
  const epic = { id: String(e.id), title: String(e.title).slice(0, 200), description: String(e.description || '').slice(0, 2000), ...(e.psd ? { psd: e.psd } : {}), ...(e.fbd?.markdown ? { fbd: e.fbd } : {}) };
  const project = await store.getProject(p.id);
  return ndjson(req, async (send, signal) => {
    send({ type: 'progress', message: kind === 'psd' ? 'Writing the Problem Statement from the brainstorm…' : kind === 'fbd' ? 'Filling the Feature Brief from the brainstorm and the Problem Statement…' : 'Filling the Architecture Record from the brainstorm and the Feature Brief…' });
    const out = await writeFeatureDoc({ project, kind, epic, source: { name: String(b.sourceName || ''), text: String(b.sourceText || '').slice(0, 30000) },
      digest: brainstormDigest(b.brainstorm, String(b.notes || '').slice(0, 3000)), instructions: String(b.instructions || '').slice(0, 2000), author: user.name, ai: { ...aiOpts(b), signal } });
    send({ type: 'done', ...out });
  });
});
