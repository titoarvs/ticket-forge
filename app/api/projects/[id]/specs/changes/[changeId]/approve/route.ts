import { api, authed } from '@/lib/server/http';
import * as store from '@/lib/store.js';

// A required reviewer (coding spec settings) approves AI-produced changes. Anyone else gets 403.
export const POST = api(async (_req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  return store.approveSpecChange(p.id, p.changeId, user);
});
