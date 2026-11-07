import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import { extractText } from '@/lib/parse.js';

export const POST = api(async (req) => {
  await perm('project.create');
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'No file uploaded');
  if (file.size > 50 * 1024 * 1024) throw new HttpError(413, 'The file is larger than 50 MB.');
  const text = await extractText(Buffer.from(await file.arrayBuffer()), file.name);
  if (!text) throw new HttpError(422, 'No readable text found in this file (scanned PDFs need OCR first).');
  return { filename: file.name, text, chars: text.length, words: text.split(/\s+/).length };
});
