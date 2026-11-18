import { api, authed, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { getFile, deleteFile, docxPage, showsInline } from '@/lib/files';

const ID = /^[a-f0-9]{8,32}$/;
async function load(id: string) {
  const user = await authed();
  if (!ID.test(id)) throw new HttpError(404, 'Not found');
  const f = await getFile(id);
  if (!f) throw new HttpError(404, 'File not found');
  await store.requireProject(user, f.projectId);
  return { user, f };
}
const disposition = (kind: string, name: string) => `${kind}; filename*=UTF-8''${encodeURIComponent(name)}`;

// The original file. ?view=html shows a Word document as a page; ?download=1 saves it.
export const GET = api(async (req, p) => {
  const { f } = await load(p.id);
  const sp = new URL(req.url).searchParams;
  if (sp.get('view') === 'html' && /wordprocessingml/.test(f.mime)) {
    const html = await docxPage(f.data, f.name);
    return new Response(html, { headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, max-age=3600',
      // No scripts, no outside requests: only inline styles and embedded images.
      'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox allow-same-origin allow-popups allow-modals",
      'X-Content-Type-Options': 'nosniff',
    } });
  }
  // Images, PDFs and videos may show in the browser; anything else always downloads. Non-PDF files also get a
  // sandbox policy, so nothing in them can run as part of the app.
  const inline = !sp.get('download') && showsInline(f.mime);
  return new Response(f.data, { headers: {
    'Content-Type': f.mime, 'Content-Length': String(f.bytes), 'Cache-Control': 'private, max-age=3600',
    'Content-Disposition': disposition(inline ? 'inline' : 'attachment', f.name), 'X-Content-Type-Options': 'nosniff',
    ...(f.mime !== 'application/pdf' && { 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'" }),
  } });
});

export const DELETE = api(async (_req, p) => {
  const { user, f } = await load(p.id);
  if (!['issue.create', 'project.settings', 'issue.comment', 'issue.edit'].some((x) => store.has(user, x))) throw new HttpError(403, "You don't have permission to remove files.");
  await deleteFile(f.id);
  return { ok: true };
});
