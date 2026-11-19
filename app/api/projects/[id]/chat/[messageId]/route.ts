import { api, authed, body, HttpError } from '@/lib/server/http';
import { createFromDraft, discardChatDraft } from '@/lib/chat';

// Acts on the draft preview of one chat message (body: action, "create" with the draft's fields, or
// "discard").
// Create is the only way a chat draft becomes an issue.
export const POST = api(async (req, p) => {
  const user = await authed();
  const b = await body(req);
  if (b.action === 'create') return createFromDraft(p.id, p.messageId, user, b.draft);
  if (b.action === 'discard') return discardChatDraft(p.id, p.messageId, user);
  throw new HttpError(400, 'The action must be create or discard.');
});
