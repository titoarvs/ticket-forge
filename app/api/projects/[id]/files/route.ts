import { api, authed, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { saveFile, fileType, attachmentType } from '@/lib/files';
import { q } from '@/lib/db';

// Keep the original PDF or Word file of a source document, so it can be shown as it was written.
// form: file, and optionally target=original to link it as the project's initial document right away
// (used right after a project is created, before the browser has the project open).
export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  const form = await req.formData();
  const purpose = form.get('purpose') === 'attachment' ? 'attachment' : 'original';
  const allowed = purpose === 'attachment' ? ['issue.comment', 'issue.edit'] : ['issue.create', 'project.settings', 'project.create'];
  if (!allowed.some((x) => store.has(user, x)))
    throw new HttpError(
      403,
      purpose === 'attachment'
        ? "You don't have permission to attach files."
        : "You don't have permission to add documents to this project.",
    );
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'No file uploaded');
  if (!(purpose === 'attachment' ? attachmentType(file.name) : fileType(file.name))) {
    throw new HttpError(
      415,
      purpose === 'attachment'
        ? 'This type of file can’t be attached. Images, PDF, Office documents, text, CSV, JSON, ZIP and video files can.'
        : 'Only PDF and Word (.docx) originals can be kept.',
    );
  }
  let meta;
  try {
    meta = await saveFile({ projectId: p.id, name: file.name, data: Buffer.from(await file.arrayBuffer()), user, purpose });
  } catch (e: any) {
    throw new HttpError(e.status || 500, e.message);
  }
  if (purpose === 'original' && form.get('target') === 'original') {
    await q(
      `update projects set data = jsonb_set(data, '{sourceFile}', $2::jsonb), version = version + 1, updated_at = now() where id = $1`,
      [p.id, JSON.stringify(meta)],
    );
  }
  return meta;
});
