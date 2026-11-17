// API client for an epic's document review: the only place the Document review section's requests are built.
import { api, type Any } from '../core';

const base = (pid: string) => `/api/projects/${encodeURIComponent(pid)}/epic-review`;

/** The epic's PSD, FBD and ARD with each reviewer's decision, comments, version history, sign-off and upload limits. */
export const getReview = (pid: Any, epicId: string): Promise<Any> => api(`${base(pid)}?epicId=${encodeURIComponent(epicId)}`);
/** Uploads a PSD, FBD or ARD (PDF, DOCX or PNG, up to 10 MB). A document that exists already gets a new version. */
export const uploadReviewDoc = (pid: Any, epicId: string, kind: string, file: File): Promise<Any> => {
  const fd = new FormData();
  fd.append('epicId', epicId); fd.append('kind', kind); fd.append('file', file);
  return api(base(pid), { method: 'POST', body: fd });
};
/** A listed reviewer approves the current version of a document, or requests changes. */
export const decideReviewDoc = (pid: Any, epicId: string, kind: string, decision: 'approved' | 'changes'): Promise<Any> => api(`${base(pid)}/decision`, { method: 'POST', body: { epicId, kind, decision } });
/** Adds a comment to a document. */
export const commentReviewDoc = (pid: Any, epicId: string, kind: string, body: string): Promise<Any> => api(`${base(pid)}/comments`, { method: 'POST', body: { epicId, kind, body } });
/** The epic owner's final sign-off: refused (409) until all three documents are approved. */
export const signOffEpic = (pid: Any, epicId: string): Promise<Any> => api(`${base(pid)}/signoff`, { method: 'POST', body: { epicId } });
