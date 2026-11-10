import { api, perm, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { getPsdTemplate } from '@/lib/psd-template.js';
import { buildPsdDocx, buildPlainPsdDocx } from '@/lib/psd-docx.js';
import { normalizePsd } from '@/lib/psd.js';

export const maxDuration = 60;

// The saved Problem Statement of an epic as a .docx: built from the team's template when there is one.
export const POST = api(async (req, p) => {
  const user = await perm('export');
  store.requireAccess(user, p.id);
  const b = await body(req);
  const project = await store.getProject(p.id);
  const epic = project.epics.find((e: any) => e.id === b.epicId);
  if (!epic?.psd) throw new HttpError(404, 'This epic has no Problem Statement yet.');
  const psd = normalizePsd(epic.psd, { project, epic });
  const meta = {
    version: epic.psd.version || 'v1.0', status: epic.psd.status || 'Draft',
    date: new Date(epic.psd.generatedAt || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    preparedBy: epic.psd.generatedBy || user.name, description: `Written from the epic “${epic.title}” and its issues in TicketForge.`,
  };
  const tpl = await getPsdTemplate();
  let buf;
  try { buf = tpl ? await buildPsdDocx(tpl.data, psd, meta) : await buildPlainPsdDocx(psd, meta); }
  catch (e: any) { throw new HttpError(500, `Couldn’t build the document from the template: ${e.message}`); }
  const name = `Problem Statement - ${psd.title} - ${meta.version}.docx`.replace(/[\\/:*?"<>|]+/g, ' ');
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'Content-Length': String(buf.length), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
});
