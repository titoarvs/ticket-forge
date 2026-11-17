import { api, authed, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { saveFile } from '@/lib/files';
import { referenceType, typeMessage, sizeMessage, maxBytes, maxLabel, allowedExtensions, extractReference } from '@/lib/references';

// What can be attached to a ticket as a UI reference: the allowed types and the size limit (both configurable).
export const GET = api(async (_req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  return { types: allowedExtensions(), maxBytes: maxBytes(), maxLabel: maxLabel() };
});

// Attach a UI reference to a ticket: checks the type and size, keeps the file and reads its text, form fields and
// components. The browser stores the returned object on the ticket (`references`) with the rest of the ticket.
export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  if (!store.has(user, 'issue.edit')) throw new HttpError(403, "You don't have permission to attach files to tickets.");
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'No file uploaded');
  if (!referenceType(file.name)) throw new HttpError(415, typeMessage());
  if (file.size > maxBytes()) throw new HttpError(413, sizeMessage());
  const data = Buffer.from(await file.arrayBuffer());
  let meta;
  try { meta = await saveFile({ projectId: p.id, name: file.name, data, user, purpose: 'reference' }); }
  catch (e: any) { throw new HttpError(e.status || 500, e.message); }
  const found = await extractReference(data, meta.name);
  return { ...meta, ...found, at: new Date().toISOString() };
});
