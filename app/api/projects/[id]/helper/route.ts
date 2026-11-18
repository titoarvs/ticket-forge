import { api, authed, body, HttpError, aiOpts } from '@/lib/server/http';
import * as store from '@/lib/store';
import { helperState, requireHelper, searchTickets, generateDraft, assignTicket } from '@/lib/helper';

// The project's AI helper (the chat panel). GET: the person's helper settings, the open drafts and who can be assigned.
// POST { action: 'search' | 'generate' | 'assign', … }. Every call checks project access and the person's helper
// setting for the action on the server; a generated ticket is only saved as a draft.
export const GET = api(async (_req, p) => {
  const user = await authed();
  return helperState(p.id, user);
});

export const POST = api(async (req, p) => {
  const user = await authed();
  const b = await body(req);
  switch (b.action) {
    case 'search':
      return searchTickets(p.id, user, String(b.query || ''));
    case 'generate':
      // Project access and the helper setting are checked first (so a refused person is told why); then AI use.
      await requireHelper(user, p.id, 'generate');
      store.requirePerm(user, 'ai.use');
      return generateDraft(p.id, user, { idea: b.idea, epicId: b.epicId, ai: aiOpts(b) });
    case 'assign':
      return assignTicket(p.id, user, { ticket: b.ticket, assigneeId: b.assigneeId });
    default:
      throw new HttpError(400, 'The action must be search, generate or assign.');
  }
});
