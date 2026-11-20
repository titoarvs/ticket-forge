import { api, perm, body, aiOpts } from '@/lib/server/http';
import { ticketAction } from '@/lib/generate';
import * as store from '@/lib/store';

export const POST = api(async (req) => {
  const u = await perm('ai.use');
  const b = await body(req);
  // The project comes from the database (saved and cached per version), not from the browser: a big
  // project no longer travels with every AI request. Older browsers still send it.
  let project = b.project;
  if (b.projectId) {
    await store.requireProject(u, String(b.projectId));
    project = await store.getProject(String(b.projectId));
  } else if (b.project?.id) await store.requireProject(u, b.project.id);
  return ticketAction({
    action: b.action,
    ticket: b.ticket,
    project,
    instruction: b.instruction,
    answers: b.answers,
    ai: aiOpts(b),
  });
});
