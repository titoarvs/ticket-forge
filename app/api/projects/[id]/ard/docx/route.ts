import { api, perm, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { markdownToDocx } from '@/lib/md-docx.js';

export const maxDuration = 60;

// The saved Architecture Record Design of an epic as a Word document.
export const POST = api(async (req, p) => {
  const user = await perm('export');
  store.requireAccess(user, p.id);
  const b = await body(req);
  const project = await store.getProject(p.id);
  const epic = project.epics.find((e: any) => e.id === b.epicId);
  if (!epic?.ard?.markdown) throw new HttpError(404, 'This epic has no Architecture Record Design yet.');
  const buf = await markdownToDocx(epic.ard.markdown, { title: `Architecture Record Design for ${epic.title}` });
  const name = `Architecture Record Design - ${epic.title} - ${epic.ard.version || 'v1.0'}.docx`.replace(/[\\/:*?"<>|]+/g, ' ');
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'Content-Length': String(buf.length), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
});
