// API client for the project's AI helper: the only place the chat panel's requests are built.
import { api, type Any } from '../core';

const base = (pid: string) => `/api/projects/${encodeURIComponent(pid)}/helper`;

/** The person's helper settings, whether they can change settings, the open drafts and who can be assigned. */
export const helperState = (pid: string): Promise<Any> => api(base(pid));
/** Tickets of this project whose key, title or content contain the text. */
export const helperSearch = (pid: string, query: string): Promise<Any> => api(base(pid), { method: 'POST', body: { action: 'search', query } });
/** Writes a ticket for the idea with the AI and saves it as a draft (it is not an issue until approved). */
export const helperGenerate = (pid: string, idea: string): Promise<Any> => api(base(pid), { method: 'POST', body: { action: 'generate', idea } });
/** Assigns a ticket (by key) to a person of the project. */
export const helperAssign = (pid: string, ticket: string, assigneeId: string): Promise<Any> =>
  api(base(pid), { method: 'POST', body: { action: 'assign', ticket, assigneeId } });
/** Approves a draft (it becomes an issue) or discards it. */
export const decideDraft = (pid: string, draftId: string, action: 'approve' | 'discard'): Promise<Any> =>
  api(`${base(pid)}/drafts/${encodeURIComponent(draftId)}`, { method: 'POST', body: { action } });
/** Everyone in the project with their helper settings (for people who can edit the project settings). */
export const listHelperPerms = (pid: string): Promise<Any> => api(`${base(pid)}/permissions`);
export const saveHelperPerms = (pid: string, userId: string, permissions: Any): Promise<Any> =>
  api(`${base(pid)}/permissions`, { method: 'PUT', body: { userId, permissions } });
