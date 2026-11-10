import { api, perm, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { markdownToDocx } from '@/lib/md-docx.js';

export const maxDuration = 60;

// The saved Feature Brief of an epic as a Word document.
export const POST = api(async (req, p) => {
  const user = await perm('export');
  store.requireAccess(user, p.id);
  const b = await body(req);
  const project = await store.getProject(p.id);
  const epic = project.epics.find((e: any) => e.id === b.epicId);
  if (!epic?.fbd?.markdown) throw new HttpError(404, 'This epic has no Feature Brief yet.');
  const buf = await markdownToDocx(epic.fbd.markdown, { title: `Feature Brief for ${epic.title}` });
  const name = `Feature Brief - ${epic.title} - ${epic.fbd.version || 'v1.0'}.docx`.replace(/[\\/:*?"<>|]+/g, ' ');
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'Content-Length': String(buf.length), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
});
