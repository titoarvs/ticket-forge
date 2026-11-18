// An epic's generated agent documents (Agent doc) as Word files. The download route (…/agent/docx) and the Google Drive
// save use the same builder, so the file in Drive is the one a person would download.
import { HttpError } from './auth';
import { markdownToDocx } from './md-docx';
import { destination, saveDocument, markFailed } from './gdrive';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ');

/** The Word file of one agent document of an epic. `doc` is what the epic keeps: `{ markdown, name }`. */
export async function epicDocx({ kind, epic, doc, agentId = '' }: { kind: string; project?: any; epic: any; doc: any; agentId?: string; user?: any }): Promise<{ name: string; buf: Buffer }> {
  if (kind === 'agent') return { name: safe(`${doc.name || agentId} - ${epic.title}.docx`), buf: await markdownToDocx(doc.markdown, { title: `${doc.name || agentId} – ${epic.title}` }) };
  throw new HttpError(404, 'Unknown document type.');
}

export const docxResponse = (name: string, buf: Buffer) => new Response(new Uint8Array(buf), { headers: { 'Content-Type': DOCX_MIME, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'Content-Length': String(buf.length), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });

/**
 * A document was just generated: when Google Drive is the document storage (feature on, folder selected), builds its Word
 * file and saves it to the Drive folder (queued for a background retry if Drive fails). Returns { state } for the app to
 * show, or null when the existing storage is used. Never throws: the generated document itself is not lost.
 */
export async function saveGeneratedToDrive({ kind, project, epic, doc, agentId = '', user }: { kind: string; project: any; epic: any; doc: any; agentId?: string; user?: any }) {
  const at = { projectId: project.id, epicId: epic.id, kind, docKey: agentId };
  try {
    if (!(await destination())) return null;
    let file;
    try { file = await epicDocx({ kind, project, epic, doc, agentId, user }); }
    catch (e: any) { await markFailed({ ...at, name: `${kind} - ${epic.title}`, error: e.message, user }); return { state: 'failed' }; }
    return { state: await saveDocument({ ...at, name: file.name, mime: DOCX_MIME, data: Buffer.from(file.buf), user }) };
  } catch (e: any) { console.error('Google Drive save:', e.message); return null; }
}
