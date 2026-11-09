import { api, perm, HttpError } from '@/lib/server/http';
import { savePsdTemplate, publicPsdTemplate, clearPsdTemplate, getPsdTemplate } from '@/lib/psd-template.js';

// Administration → Generation → Problem Statement template: the .docx every generated PSD is built from.

export const GET = api(async (req) => {
  const download = new URL(req.url).searchParams.get('download');
  if (!download) { await perm('project.create'); return { template: await publicPsdTemplate() }; }
  await perm('users.manage');
  const t = await getPsdTemplate();
  if (!t) throw new HttpError(404, 'No template has been uploaded.');
  return new Response(t.data, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(t.name)}`, 'X-Content-Type-Options': 'nosniff' } });
});

export const PUT = api(async (req) => {
  const user = await perm('users.manage');
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'No file uploaded');
  if (!/\.docx$/i.test(file.name)) throw new HttpError(415, 'Upload a Word document (.docx).');
  try { return { template: await savePsdTemplate(user, Buffer.from(await file.arrayBuffer()), file.name) }; }
  catch (e: any) { throw new HttpError(e.status || 500, e.message); }
});

export const DELETE = api(async () => {
  await perm('users.manage');
  await clearPsdTemplate();
  return { template: null };
});
