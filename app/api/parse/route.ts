import { api, perm, HttpError } from '@/lib/server/http';
import { extractText } from '@/lib/parse';

export const POST = api(async (req) => {
  await perm('project.create');
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'No file uploaded');
  if (file.size > 50 * 1024 * 1024) throw new HttpError(413, 'The file is larger than 50 MB.');
  let text: string;
  try {
    text = await extractText(Buffer.from(await file.arrayBuffer()), file.name);
  } catch (e: any) {
    // Failures are already logged (file, type, error, retry count) in extractText.
    if (e?.code === 'PDF_UNSUPPORTED' || e?.code === 'DOC_UNSUPPORTED') throw new HttpError(415, e.message);
    throw new HttpError(
      422,
      `“${file.name}” could not be read after several tries (${e?.message || 'unknown error'}). Try again, or paste the text instead.`,
    );
  }
  if (!text) throw new HttpError(422, 'No readable text found in this file (scanned PDFs need OCR first).');
  return { filename: file.name, text, chars: text.length, words: text.split(/\s+/).length };
});
