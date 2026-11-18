// Original files of source documents (PDF, Word), kept in the database so the Source documents page can show
// them as they were written. Row-level security limits them to people with access to the project.
import crypto from 'node:crypto';
import path from 'node:path';
import mammoth from 'mammoth';
import { orm, files, eq } from './orm';
import { checkLimit } from './limits';
import { referenceType, typeMessage, sizeMessage, maxBytes } from './references';

const MAX_FILE = 20 * 1024 * 1024;
export const VIEWABLE = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

export function fileType(name) { return VIEWABLE[path.extname(String(name || '')).toLowerCase()] || null; }

// Comment attachments. Web pages and SVG images are refused: they could run scripts if opened.
const ATTACHMENT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.docx': VIEWABLE['.docx'], '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.csv': 'text/csv', '.txt': 'text/plain',
  '.md': 'text/markdown', '.json': 'application/json', '.log': 'text/plain', '.zip': 'application/zip', '.har': 'application/json',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
};
export function attachmentType(name) { return ATTACHMENT[path.extname(String(name || '')).toLowerCase()] || null; }
/** Types a browser may show in place; everything else is always downloaded. */
export const showsInline = (mime) => /^(image\/(png|jpeg|gif|webp)|application\/pdf|video\/(mp4|webm|quicktime))$/.test(mime);

// Epic documents (PSD, FBD, ARD) uploaded for review: PDF, Word or PNG, up to 10 MB (a file of exactly 10 MB is accepted).
export const EPIC_DOC_MAX = 10 * 1024 * 1024;
const EPIC_DOC = { '.pdf': 'application/pdf', '.docx': VIEWABLE['.docx'], '.png': 'image/png' };
export const EPIC_DOC_MESSAGE = 'Only PDF, DOCX and PNG files up to 10 MB can be uploaded as a PSD, FBD or ARD.';
export const epicDocType = (name) => EPIC_DOC[path.extname(String(name || '')).toLowerCase()] || null;

export async function saveFile({ projectId, name, data, user, purpose = 'original' }: any) {
  if (purpose === 'epic-doc') {
    if (!epicDocType(name)) throw Object.assign(new Error(EPIC_DOC_MESSAGE), { status: 415 });
    if (data?.length > EPIC_DOC_MAX) throw Object.assign(new Error(EPIC_DOC_MESSAGE), { status: 413 });
  }
  const mime = purpose === 'epic-doc' ? epicDocType(name) : purpose === 'reference' ? referenceType(name) : purpose === 'attachment' ? attachmentType(name) : fileType(name);
  if (!mime && purpose === 'reference') throw Object.assign(new Error(typeMessage()), { status: 415 });
  if (purpose === 'reference' && data?.length > maxBytes()) throw Object.assign(new Error(sizeMessage()), { status: 413 });
  if (!mime) throw Object.assign(new Error(purpose === 'attachment'
    ? 'This type of file can’t be attached. Images, PDF, Office documents, text, CSV, JSON, ZIP and video files can.'
    : 'Only PDF and Word (.docx) originals can be kept.'), { status: 415 });
  if (!data?.length) throw Object.assign(new Error('The file is empty.'), { status: 400 });
  if (data.length > MAX_FILE) throw Object.assign(new Error('The file is larger than 20 MB.'), { status: 413 });
  await checkLimit('storageMb', data.length); // the plan's storage (SaaS)
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  await orm.insert(files).values({ id, projectId, name: String(name).slice(0, 200), mime, bytes: data.length, data, createdBy: user?.name || null });
  return { id, name: String(name).slice(0, 200), mime, bytes: data.length };
}

export async function getFile(id): Promise<any> {
  const [row] = await orm.select({ id: files.id, projectId: files.projectId, name: files.name, mime: files.mime, bytes: files.bytes, data: files.data })
    .from(files).where(eq(files.id, id));
  return row || null;
}
export async function deleteFile(id) { await orm.delete(files).where(eq(files.id, id)); }
export async function deleteProjectFiles(projectId) { await orm.delete(files).where(eq(files.projectId, projectId)); }

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A Word document as a page of HTML: headings, lists, tables, emphasis and images, styled like paper. */
export async function docxPage(data, title) {
  const { value } = await mammoth.convertToHtml({ buffer: data });
  // Mammoth escapes text; links are limited to web and mail addresses, images to embedded data.
  const html = value
    .replace(/<a\s+href="(?!https?:|mailto:|#)[^"]*"/gi, '<a')
    .replace(/<img\s+src="(?!data:image\/)[^"]*"/gi, '<img');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PAPER_CSS}</style></head>
<body><article class="paper">${html || '<p><em>This document has no text.</em></p>'}</article></body></html>`;
}

// Looks like a printed A4 page; the app shows it inside a sandboxed frame.
const PAPER_CSS = `
:root { color-scheme: light; }
html, body { margin: 0; background: transparent; }
.paper { box-sizing: border-box; max-width: 794px; margin: 0 auto; padding: 72px 80px; background: #fff; color: #1f2328;
  font: 11pt/1.55 Calibri, Carlito, "Segoe UI", "Helvetica Neue", Arial, sans-serif; overflow-wrap: anywhere; }
h1, h2, h3, h4, h5, h6 { color: #1f3864; line-height: 1.25; margin: 1.2em 0 .45em; font-weight: 600; }
h1 { font-size: 20pt; } h2 { font-size: 15pt; } h3 { font-size: 13pt; } h4, h5, h6 { font-size: 11.5pt; }
.paper > :first-child { margin-top: 0; }
p { margin: 0 0 .7em; } ul, ol { margin: 0 0 .7em; padding-left: 1.6em; } li { margin: .15em 0; }
table { border-collapse: collapse; width: 100%; margin: .6em 0 1em; font-size: 10pt; }
td, th { border: 1px solid #c8ccd1; padding: 5px 8px; vertical-align: top; text-align: left; }
th, tr:first-child td { background: #f3f5f7; font-weight: 600; }
img { max-width: 100%; height: auto; }
a { color: #0b5cad; }
blockquote { margin: .6em 0; padding-left: 1em; border-left: 3px solid #d0d7de; color: #57606a; }
@media (max-width: 700px) { .paper { padding: 32px 22px; } }
@media print { .paper { padding: 0; max-width: none; } }
`;
