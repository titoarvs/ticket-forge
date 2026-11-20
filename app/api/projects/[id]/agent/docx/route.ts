import { api, perm, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { epicDocx, docxResponse } from '@/lib/epic-docx';

export const maxDuration = 60;

// A document an agent wrote for an epic (Kick Off, Demo, UX Design Spec…) as a Word document.
export const POST = api(async (req, p) => {
  const user = await perm('export');
  store.requireAccess(user, p.id);
  const b = await body(req);
  const project = await store.getProject(p.id);
  const epic = project.epics.find((e: any) => e.id === b.epicId);
  const doc = epic?.agentDocs?.[String(b.agentId || '')];
  if (!doc?.markdown)
    throw new HttpError(
      404,
      'That document isn’t saved on this epic yet. Wait a moment for it to save, then try again.',
    );
  const { name, buf } = await epicDocx({
    kind: 'agent',
    project,
    epic,
    doc,
    agentId: String(b.agentId),
    user,
  });
  return docxResponse(name, buf);
});
