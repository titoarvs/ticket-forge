import { api, perm, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { epicDocx, docxResponse } from '@/lib/epic-docx';

export const maxDuration = 60;

// The saved Problem Statement of an epic as a .docx: built from the team's template when there is one.
export const POST = api(async (req, p) => {
  const user = await perm('export');
  store.requireAccess(user, p.id);
  const b = await body(req);
  const project = await store.getProject(p.id);
  const epic = project.epics.find((e: any) => e.id === b.epicId);
  if (!epic?.psd) throw new HttpError(404, 'This epic has no Problem Statement yet.');
  const { name, buf } = await epicDocx({ kind: 'psd', project, epic, doc: epic.psd, user });
  return docxResponse(name, buf);
});
