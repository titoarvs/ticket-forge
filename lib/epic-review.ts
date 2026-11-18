// Document review before an epic's issues are written. The PSD, FBD and ARD are uploaded to the epic (PDF, DOCX or PNG,
// up to 10 MB), the epic's reviewers (`epic.reviewers`, a list of { id, name } kept with the epic) comment on them and
// approve or ask for changes, and the epic owner (epic.manage) gives the final sign-off. Only then can issues be added.
// Every upload is a new version and old versions stay, so a restore or diff is possible later. Approvals belong to a
// version: a new version has to be approved again, and that withdraws the sign-off.
import crypto from 'node:crypto';
import { q, tx } from './db';
import { HttpError } from './auth';
import { saveFile, deleteFile, epicDocType, EPIC_DOC_MAX, EPIC_DOC_MESSAGE } from './files';
import { destination, saveDocument } from './gdrive';
import { extractText } from './parse';
import { APPROVAL_DOCS } from './approval';
import { has, requirePerm } from './store';

const KINDS: string[] = APPROVAL_DOCS.map((d) => d.kind);
const LABEL: Record<string, string> = Object.fromEntries(APPROVAL_DOCS.map((d) => [d.kind, d.label]));
const SHORT: Record<string, string> = Object.fromEntries(APPROVAL_DOCS.map((d) => [d.kind, d.short]));
const NOT_APPROVED = 'All three documents (PSD, FBD and ARD) must be approved by every reviewer before the epic can be signed off.';
type Run = (sql: string, params?: any[]) => Promise<{ rows: any[] }>;

const kindOf = (k: any) => {
  const kind = String(k || '').toLowerCase();
  if (!KINDS.includes(kind)) throw new HttpError(400, 'The document must be a PSD, FBD or ARD.');
  return kind;
};

/** The epic and its reviewers, from the project's epics. Throws 404 when the epic isn't in the project. */
async function epicOf(projectId: string, epicId: string) {
  const r = (await q('select data from projects where id = $1 and archived_at is null', [projectId])).rows[0];
  if (!r) throw new HttpError(404, 'Project not found');
  const epic = (r.data?.epics || []).find((e: any) => e.id === String(epicId));
  if (!epic) throw new HttpError(404, 'That epic isn’t in this project (save first if you just created it).');
  const reviewers = (Array.isArray(epic.reviewers) ? epic.reviewers : []).filter((x: any) => x && x.id).map((x: any) => ({ id: String(x.id), name: String(x.name || '') }));
  return { id: epic.id as string, title: String(epic.title || ''), reviewers };
}

const versionOut = (r: any) => ({ number: r.number, name: r.name, mime: r.mime, bytes: r.bytes, fileId: r.file_id, author: r.author, at: r.created_at, hasText: Boolean(r.has_text) });

/**
 * Everything the review screen shows: per document its current version, version history, each reviewer's decision on
 * the current version (approved, changes or pending) and the comments; the sign-off; and whether issues can be added.
 * A document is approved when it has at least one listed reviewer and every one of them approved its current version.
 */
async function load(run: Run, projectId: string, epicId: string, user: any = null) {
  const epic = await epicOf(projectId, epicId);
  const [versions, reviews, comments, sign] = await Promise.all([
    run(`select number, kind, file_id, name, mime, bytes, author, created_at, text <> '' as has_text from epic_doc_versions where project_id = $1 and epic_id = $2 order by number desc`, [projectId, epicId]),
    run('select kind, number, user_id, name, decision, at from epic_doc_reviews where project_id = $1 and epic_id = $2', [projectId, epicId]),
    run('select id, kind, number, user_id, author, body, created_at from epic_doc_comments where project_id = $1 and epic_id = $2 order by created_at', [projectId, epicId]),
    run('select signed_by, signed_at from epic_signoffs where project_id = $1 and epic_id = $2', [projectId, epicId]),
  ]);
  const docs = KINDS.map((kind) => {
    // A version counts as approved when every reviewer listed now approved it, so an approved version stays marked in the history.
    const history = versions.rows.filter((v) => v.kind === kind).map((v) => ({ ...versionOut(v),
      approved: epic.reviewers.length > 0 && epic.reviewers.every((rv) => reviews.rows.some((r) => r.kind === kind && r.number === v.number && r.user_id === rv.id && r.decision === 'approved')) }));
    const current = history[0] || null;
    const marks = current ? reviews.rows.filter((r) => r.kind === kind && r.number === current.number) : [];
    const byReviewer = epic.reviewers.map((rv) => {
      const m = marks.find((x) => x.user_id === rv.id);
      return { userId: rv.id, name: rv.name || m?.name || 'Reviewer', decision: m ? m.decision : 'pending', at: m ? m.at : null };
    });
    const status = !current ? 'missing' : byReviewer.some((r) => r.decision === 'changes') ? 'changes'
      : byReviewer.length && byReviewer.every((r) => r.decision === 'approved') ? 'approved' : 'review';
    return {
      kind, label: LABEL[kind], short: SHORT[kind], status, current, versions: history, reviews: byReviewer,
      comments: comments.rows.filter((c) => c.kind === kind).map((c) => ({ id: c.id, version: c.number, userId: c.user_id, author: c.author, body: c.body, at: c.created_at })),
    };
  });
  const allApproved = docs.every((d) => d.status === 'approved');
  const signedOff = Boolean(sign.rows[0]) && allApproved;
  const isReviewer = Boolean(user && epic.reviewers.some((r) => r.id === user.id));
  return {
    epic: { id: epic.id, title: epic.title }, reviewers: epic.reviewers, docs, allApproved,
    signoff: signedOff ? { by: sign.rows[0].signed_by, at: sign.rows[0].signed_at } : null,
    canAddIssues: signedOff,
    me: { isReviewer, canUpload: has(user, 'epic.manage'), canSignOff: has(user, 'epic.manage'), canComment: isReviewer || has(user, 'epic.manage') },
  };
}
export const reviewState = (projectId: string, epicId: string, user: any) => load(q, projectId, epicId, user);

/** The sign-off no longer holds once a document stops being approved: drop it. */
async function settle(t: any, projectId: string, epicId: string, user: any) {
  const run: Run = (sql, params) => t.query(sql, params);
  const state = await load(run, projectId, epicId, user);
  if (!state.allApproved) await run('delete from epic_signoffs where project_id = $1 and epic_id = $2', [projectId, epicId]);
  return state;
}

/**
 * Uploads a document of the epic as a PSD, FBD or ARD. The file is checked (PDF, DOCX or PNG, 10 MB) and kept; its text
 * is read when it is a Word file. A document that exists already gets a new version, approved or not: the earlier
 * versions stay. The new version needs the reviewers' approval again, and the epic's sign-off is withdrawn.
 */
export async function uploadDoc(projectId: string, epicId: string, kindIn: any, file: { name: string; data: Buffer }, user: any) {
  requirePerm(user, 'epic.manage');
  const kind = kindOf(kindIn);
  await epicOf(projectId, epicId);
  let meta;
  const toDrive = Boolean(await destination()); // Google Drive is the document storage: the file goes there, not into files
  if (toDrive) {
    // Same checks as the existing storage (type and size), then the Drive folder; a failed save is queued and retried.
    if (!epicDocType(file.name)) throw new HttpError(415, EPIC_DOC_MESSAGE);
    if (!file.data?.length) throw new HttpError(400, 'The file is empty.');
    if (file.data.length > EPIC_DOC_MAX) throw new HttpError(413, EPIC_DOC_MESSAGE);
    meta = { id: '', name: String(file.name).slice(0, 200), mime: epicDocType(file.name) as string, bytes: file.data.length };
    await saveDocument({ projectId, epicId, kind, docKey: 'upload', name: meta.name, mime: meta.mime, data: file.data, user });
  } else {
    try { meta = await saveFile({ projectId, name: file.name, data: file.data, user, purpose: 'epic-doc' }); }
    catch (e: any) { throw new HttpError(e.status || 500, e.message); }
  }
  let text = '';
  if (/\.docx$/i.test(meta.name)) { try { text = await extractText(file.data, meta.name); } catch { /* kept without text */ } }
  try {
    return await tx(async (t) => {
      const next = (await t.query('select coalesce(max(number), 0)::int + 1 as n from epic_doc_versions where project_id = $1 and epic_id = $2 and kind = $3', [projectId, epicId, kind])).rows[0].n;
      await t.query(`insert into epic_doc_versions (project_id, epic_id, kind, number, file_id, name, mime, bytes, text, author, author_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [projectId, epicId, kind, next, meta.id, meta.name, meta.mime, meta.bytes, text.slice(0, 200000), user?.name || '', user?.id || null]);
      return settle(t, projectId, epicId, user);
    });
  } catch (e) { if (meta.id) await deleteFile(meta.id); throw e; }
}

/** A listed reviewer approves the current version of a document, or asks for changes. */
export async function decide(projectId: string, epicId: string, kindIn: any, decisionIn: any, user: any) {
  const kind = kindOf(kindIn);
  const decision = decisionIn === 'approved' || decisionIn === 'changes' ? decisionIn : null;
  if (!decision) throw new HttpError(400, 'Choose approve or request changes.');
  const epic = await epicOf(projectId, epicId);
  if (!user || !epic.reviewers.some((r) => r.id === user.id)) throw new HttpError(403, 'Only a reviewer listed on this epic can approve a document or request changes.');
  return tx(async (t) => {
    const cur = (await t.query('select max(number)::int as n from epic_doc_versions where project_id = $1 and epic_id = $2 and kind = $3', [projectId, epicId, kind])).rows[0].n;
    if (!cur) throw new HttpError(409, `Upload the ${SHORT[kind]} before it is reviewed.`);
    await t.query(`insert into epic_doc_reviews (project_id, epic_id, kind, number, user_id, name, decision) values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (project_id, epic_id, kind, number, user_id) do update set decision = excluded.decision, name = excluded.name, at = now()`,
    [projectId, epicId, kind, cur, user.id, user.name || '', decision]);
    return settle(t, projectId, epicId, user);
  });
}

/** Adds a comment to the current version of a document. Listed reviewers and the epic owner (epic.manage) can comment. */
export async function addComment(projectId: string, epicId: string, kindIn: any, bodyIn: any, user: any) {
  const kind = kindOf(kindIn);
  const body = String(bodyIn ?? '').trim();
  if (!body) throw new HttpError(400, 'Write a comment first.');
  if (body.length > 4000) throw new HttpError(400, 'A comment can be up to 4000 characters.');
  const epic = await epicOf(projectId, epicId);
  if (!user || !(epic.reviewers.some((r) => r.id === user.id) || has(user, 'epic.manage'))) throw new HttpError(403, 'Only a reviewer listed on this epic can comment on its documents.');
  const cur = (await q('select max(number)::int as n from epic_doc_versions where project_id = $1 and epic_id = $2 and kind = $3', [projectId, epicId, kind])).rows[0].n;
  if (!cur) throw new HttpError(409, `Upload the ${SHORT[kind]} before commenting on it.`);
  await q('insert into epic_doc_comments (id, project_id, epic_id, kind, number, user_id, author, body) values ($1,$2,$3,$4,$5,$6,$7,$8)',
    [crypto.randomUUID().replace(/-/g, '').slice(0, 12), projectId, epicId, kind, cur, user.id, user.name || '', body]);
  return reviewState(projectId, epicId, user);
}

/** The epic owner (epic.manage) records the final sign-off. Refused (409) until every document is approved by every reviewer. */
export async function signOff(projectId: string, epicId: string, user: any) {
  requirePerm(user, 'epic.manage');
  return tx(async (t) => {
    const state = await load((sql, params) => t.query(sql, params), projectId, epicId, user);
    if (!state.reviewers.length) throw new HttpError(409, 'List at least one reviewer on the epic first. ' + NOT_APPROVED);
    if (!state.allApproved) throw new HttpError(409, NOT_APPROVED);
    await t.query(`insert into epic_signoffs (project_id, epic_id, user_id, signed_by) values ($1,$2,$3,$4)
      on conflict (project_id, epic_id) do update set user_id = excluded.user_id, signed_by = excluded.signed_by, signed_at = now()`,
    [projectId, epicId, user?.id || null, user?.name || '']);
    return load((sql, params) => t.query(sql, params), projectId, epicId, user);
  });
}

/**
 * The approved documents of a signed-off epic, for writing draft issues: [{ kind, label, version, text }].
 * Refused (409) before the sign-off, or when no document has text to read (PDF and PNG files are kept but not read).
 */
export async function signedOffDocs(projectId: string, epicId: string) {
  const state = await reviewState(projectId, epicId, null);
  if (!state.canAddIssues) throw Object.assign(new HttpError(409, `Issues are added after the epic is signed off. ${NOT_APPROVED}`), { extra: { code: 'epic-not-signed-off' } });
  const rows = (await q(`select distinct on (kind) kind, number, text from epic_doc_versions where project_id = $1 and epic_id = $2 order by kind, number desc`, [projectId, epicId])).rows;
  const docs = rows.map((r) => ({ kind: r.kind, label: LABEL[r.kind], version: `v${r.number}`, text: r.text as string }));
  if (!docs.some((d) => d.text)) throw new HttpError(409, 'No text could be read from the approved documents (text is read from DOCX files only). Upload the documents as DOCX, or add the issues by hand.');
  return docs;
}
