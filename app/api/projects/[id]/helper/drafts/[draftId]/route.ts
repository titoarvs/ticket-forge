import { api, authed, body, HttpError } from '@/lib/server/http';
import { approveDraft, discardDraft } from '@/lib/helper';

// Approves (turns the draft into an issue) or discards one of the helper's ticket drafts (body:
// action, "approve" or "discard").
export const POST = api(async (req, p) => {
  const user = await authed();
  const { action } = await body(req);
  if (action === 'approve') return approveDraft(p.id, p.draftId, user);
  if (action === 'discard') return discardDraft(p.id, p.draftId, user);
  throw new HttpError(400, 'The action must be approve or discard.');
});
