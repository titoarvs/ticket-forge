import { api, perm, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { epicDocx, docxResponse } from '@/lib/epic-docx';

export const maxDuration = 60;

// The saved Architecture Record Design of an epic as a Word document.
export const POST = api(async (req, p) => {
  const user = await perm('export');
  store.requireAccess(user, p.id);
  const b = await body(req);
  const project = await store.getProject(p.id);
  const epic = project.epics.find((e: any) => e.id === b.epicId);
  if (!epic?.ard?.markdown)
    throw new HttpError(404, 'This epic has no Architecture Record Design yet.');
  const { name, buf } = await epicDocx({ kind: 'ard', project, epic, doc: epic.ard, user });
  return docxResponse(name, buf);
});
