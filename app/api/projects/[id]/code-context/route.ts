import { api, authed } from '@/lib/server/http';
import * as store from '@/lib/store';

// The ticket's context for the Code jobs page (opened in a new tab by "Write code", TF-124): the
// ticket ID, the coding prompt and the linked repository or spec. Everyone who can open the project
// (and so the ticket) can read it.
export const GET = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  return store.codeContext(p.id, new URL(req.url).searchParams.get('ticketId') || '');
});
