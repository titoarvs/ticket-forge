import { api, authed, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import * as review from '@/lib/epic-review';
import { epicDocType, EPIC_DOC_MAX, EPIC_DOC_MESSAGE } from '@/lib/files';

const limits = { types: ['PDF', 'DOCX', 'PNG'], maxBytes: EPIC_DOC_MAX, maxLabel: '10 MB' };

// An epic's document review: the PSD, FBD and ARD with each reviewer's decision, the comments, the version history and
// the sign-off (?epicId=). Everyone with access to the project sees it.
export const GET = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  const epicId = new URL(req.url).searchParams.get('epicId') || '';
  return { ...(await review.reviewState(p.id, epicId, user)), limits };
});

// Upload a PSD, FBD or ARD of the epic (form: epicId, kind, file). Sending one that exists already saves a new version.
// Rejected with the allowed types and the size limit when the file is not PDF, DOCX or PNG, or is above 10 MB.
export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  store.requirePerm(user, 'epic.manage');
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'No file uploaded');
  if (!epicDocType(file.name)) throw new HttpError(415, EPIC_DOC_MESSAGE);
  if (file.size > EPIC_DOC_MAX) throw new HttpError(413, EPIC_DOC_MESSAGE);
  const data = Buffer.from(await file.arrayBuffer());
  const state = await review.uploadDoc(p.id, String(form.get('epicId') || ''), form.get('kind'), { name: file.name, data }, user);
  return { ...state, limits };
});
