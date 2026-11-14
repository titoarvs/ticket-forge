import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import { newTicket } from '@/lib/generate.js';
import * as store from '@/lib/store.js';

export const POST = api(async (req) => {
  const u = await perm('ai.use');
  const b = await body(req);
  // The project comes from the database (saved and cached per version), not from the browser: a big project no
  // longer travels with every AI request. Older browsers still send it.
  let project = b.project;
  if (b.projectId) { await store.requireProject(u, String(b.projectId)); project = await store.getProject(String(b.projectId)); }
  else if (b.project?.id) await store.requireProject(u, b.project.id);
  return newTicket({ epicId: b.epicId, project, idea: b.idea, answers: b.answers, ai: aiOpts(b) });
});
