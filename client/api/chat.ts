// API client for the project's AI chatbot: the only place the chat panel's requests are built.
import { api, type Any } from '../core';

const base = (pid: string) => `/api/projects/${encodeURIComponent(pid)}/chat`;

/** This person's saved messages in the project, oldest first. */
export const chatHistory = (pid: string): Promise<Any> => api(base(pid));
/** Sends a request; the answer is the saved request and the assistant's reply with its draft preview. */
export const chatSend = (pid: string, message: string): Promise<Any> => api(base(pid), { method: 'POST', body: { message } });
/** Creates the issue from the (edited) draft of a chat message. */
export const chatCreate = (pid: string, messageId: string, draft: Any): Promise<Any> =>
  api(`${base(pid)}/${encodeURIComponent(messageId)}`, { method: 'POST', body: { action: 'create', draft } });
/** Closes a draft preview without creating an issue. */
export const chatDiscard = (pid: string, messageId: string): Promise<Any> =>
  api(`${base(pid)}/${encodeURIComponent(messageId)}`, { method: 'POST', body: { action: 'discard' } });
