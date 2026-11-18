// API client for coding specs: the only place the Coding specs dialog's requests are built.
import { api, type Any } from '../core';

const base = (pid: string) => `/api/projects/${encodeURIComponent(pid)}/specs`;

/** An epic's specs with their linked changes, the overlaps between specs and the project's settings. */
export const listSpecs = (pid: Any, epicId: string): Promise<Any> => api(`${base(pid)}?epicId=${encodeURIComponent(epicId)}`);
/** Writes one coding spec per ticket of the epic (an earlier spec of the same ticket is replaced). */
export const generateSpecs = (pid: Any, epicId: string): Promise<Any> => api(base(pid), { method: 'POST', body: { epicId } });
/** Marks specs ready for coding: refused (409) on an overlap when the project blocks, else returns the overlaps as warnings. */
export const markSpecsReady = (pid: Any, ticketIds: string[]): Promise<Any> =>
  api(`${base(pid)}/ready`, { method: 'POST', body: { ticketIds } });
/** Links AI-produced changes (branch, pull request or commit) to a ready spec. */
export const linkSpecChange = (pid: Any, ticketId: string, ref: string, summary: string): Promise<Any> =>
  api(`${base(pid)}/changes`, { method: 'POST', body: { ticketId, ref, summary } });
/** A required reviewer approves the changes. */
export const approveSpecChange = (pid: Any, changeId: string): Promise<Any> =>
  api(`${base(pid)}/changes/${encodeURIComponent(changeId)}/approve`, { method: 'POST' });
/** Marks the changes accepted: refused (409) until a required reviewer has approved them. */
export const acceptSpecChange = (pid: Any, changeId: string): Promise<Any> =>
  api(`${base(pid)}/changes/${encodeURIComponent(changeId)}/accept`, { method: 'POST' });
/** The people who can be required reviewers: active users with access to the project. */
export const listPeople = (pid: Any): Promise<Any> => api(`/api/projects/${encodeURIComponent(pid)}/people`);
