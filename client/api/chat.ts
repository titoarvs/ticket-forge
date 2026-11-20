// API client for Ticket Forge AI, the one chat of the app: the only place its requests are built.
import { api, readNdjson, type Any } from '../core';

const base = (pid: string) => `/api/projects/${encodeURIComponent(pid)}/chat`;

/** This person's saved messages in the project, oldest first. */
export const chatHistory = (pid: string): Promise<Any> => api(base(pid));
/** Starts the project's conversation over (this person's messages there are deleted). */
export const chatClear = (pid: string): Promise<Any> => api(base(pid), { method: 'DELETE' });

type TurnBody = { message: string; projectId?: string | null; history?: Any[] };
type TurnEvents = { delta: (text: string) => void; status: (status: string) => void };

/**
 * Sends one message; the reply streams in through `on` and the result is the turn ({ messages }).
 * A failed turn throws (status 402 for the plan's AI limit).
 */
export async function chatTurn(body: TurnBody, signal: AbortSignal, on: TurnEvents) {
  const res = await api('/api/chatbot', { method: 'POST', body, raw: true, signal });
  let done: Any = null;
  await readNdjson(res, (ev) => {
    if (ev.type === 'delta') on.delta(ev.text);
    else if (ev.type === 'status') on.status(ev.status);
    else if (ev.type === 'done') done = ev;
    else if (ev.type === 'error') {
      const status = ev.code === 'limit' ? 402 : 500;
      throw Object.assign(new Error(ev.error || ev.message), { status, body: ev });
    }
  });
  if (!done) throw new Error('The reply was cut off. Please try again.');
  return done as { messages: Any[] };
}

/** Creates the issue from the (edited) draft of a chat message. */
export const chatCreate = (pid: string, messageId: string, draft: Any): Promise<Any> =>
  api(`${base(pid)}/${encodeURIComponent(messageId)}`, {
    method: 'POST',
    body: { action: 'create', draft },
  });
/** Closes a draft preview without creating an issue. */
export const chatDiscard = (pid: string, messageId: string): Promise<Any> =>
  api(`${base(pid)}/${encodeURIComponent(messageId)}`, {
    method: 'POST',
    body: { action: 'discard' },
  });
