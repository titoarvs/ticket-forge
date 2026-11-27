// An epic's generated documents (PSD, FBD, ARD and agent documents) as Word files. The download
// routes (…/psd/docx and the others) and the Google Drive save use the same builders, so the file
// in Drive is the one a person would download.
import { HttpError } from './auth';
import { getPsdTemplate } from './psd-template';
import { buildPsdDocx, buildPlainPsdDocx } from './psd-docx';
import { normalizePsd } from './psd';
import { markdownToDocx } from './md-docx';
import { destination, saveDocument, markFailed } from './gdrive';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ');

/**
 * The Word file of one document of an epic. `doc` is what the epic keeps: for a PSD its fields
 * (+ version, status, generatedAt, generatedBy), for the FBD and ARD `{ markdown, version }`, for
 * an agent document `{ markdown, name }`.
 */
export async function epicDocx({
  kind,
  project,
  epic,
  doc,
  agentId = '',
  user,
}: {
  kind: string;
  project?: any;
  epic: any;
  doc: any;
  agentId?: string;
  user?: any;
}): Promise<{ name: string; buf: Buffer }> {
  if (kind === 'psd') {
    const psd = normalizePsd(doc, { project, epic });
    const meta = {
      version: doc.version || 'v1.0',
      status: doc.status || 'Draft',
      date: new Date(doc.generatedAt || Date.now()).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      preparedBy: doc.generatedBy || user?.name,
      description: `Written from the epic “${epic.title}” and its issues in TicketForge.`,
    };
    const tpl = await getPsdTemplate(project.id);
    let buf;
    try {
      buf = tpl ? await buildPsdDocx(tpl.data, psd, meta) : await buildPlainPsdDocx(psd, meta);
    } catch (e: any) {
      throw new HttpError(500, `Couldn’t build the document from the template: ${e.message}`);
    }
    return { name: safe(`Problem Statement - ${psd.title} - ${meta.version}.docx`), buf };
  }
  if (kind === 'fbd')
    return {
      name: safe(`Feature Brief - ${epic.title} - ${doc.version || 'v1.0'}.docx`),
      buf: await markdownToDocx(doc.markdown, { title: `Feature Brief for ${epic.title}` }),
    };
  if (kind === 'ard')
    return {
      name: safe(`Architecture Record Design - ${epic.title} - ${doc.version || 'v1.0'}.docx`),
      buf: await markdownToDocx(doc.markdown, {
        title: `Architecture Record Design for ${epic.title}`,
      }),
    };
  if (kind === 'agent')
    return {
      name: safe(`${doc.name || agentId} - ${epic.title}.docx`),
      buf: await markdownToDocx(doc.markdown, { title: `${doc.name || agentId} – ${epic.title}` }),
    };
  throw new HttpError(404, 'Unknown document type.');
}

export const docxResponse = (name: string, buf: Buffer) =>
  new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': DOCX_MIME,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Content-Length': String(buf.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });

/**
 * A document was just generated: when Google Drive is the document storage (feature on, folder
 * selected), builds its Word file and saves it to the Drive folder (queued for a background retry
 * if Drive fails). Returns { state } for the app to show, or null when the existing storage is
 * used. Never throws: the generated document itself is not lost.
 */
export async function saveGeneratedToDrive({
  kind,
  project,
  epic,
  doc,
  agentId = '',
  user,
}: {
  kind: string;
  project: any;
  epic: any;
  doc: any;
  agentId?: string;
  user?: any;
}) {
  const at = { projectId: project.id, epicId: epic.id, kind, docKey: agentId };
  try {
    if (!(await destination())) return null;
    let file;
    try {
      file = await epicDocx({ kind, project, epic, doc, agentId, user });
    } catch (e: any) {
      await markFailed({ ...at, name: `${kind} - ${epic.title}`, error: e.message, user });
      return { state: 'failed' };
    }
    return {
      state: await saveDocument({
        ...at,
        name: file.name,
        mime: DOCX_MIME,
        data: Buffer.from(file.buf),
        user,
      }),
    };
  } catch (e: any) {
    console.error('Google Drive save:', e.message);
    return null;
  }
}
