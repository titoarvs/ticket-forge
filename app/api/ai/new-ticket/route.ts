import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import { newTicket } from '@/lib/generate';
import * as store from '@/lib/store';
import { requireApproved } from '@/lib/epic-issues';
import { isLocked } from '@/lib/features';

export const POST = api(async (req) => {
  const u = await perm('ai.use');
  const b = await body(req);
  // The project comes from the database (saved and cached per version), not from the browser: a big project no
  // longer travels with every AI request. Older browsers still send it.
  let project = b.project;
  if (b.projectId) { await store.requireProject(u, String(b.projectId)); project = await store.getProject(String(b.projectId)); }
  else if (b.project?.id) await store.requireProject(u, b.project.id);
  // An issue written by AI inside an epic comes from the epic's approved documents (when the epic documents feature is on).
  const epic = b.epicId ? (project?.epics || []).find((e: any) => e.id === b.epicId) : null;
  if (epic && !(await isLocked('docs'))) requireApproved(epic);
  return newTicket({ epicId: b.epicId, project, idea: b.idea, answers: b.answers, ai: aiOpts(b) });
});
