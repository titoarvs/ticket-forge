import { api, authed, body } from '@/lib/server/http';
import { listHelperPerms, setHelperPerms } from '@/lib/helper';

// Who may search, generate and assign tickets with the helper in this project (per person). For
// people who can edit the project's settings. PUT body: userId and permissions { search, generate,
// assign }.
export const GET = api(async (_req, p) => {
  const user = await authed();
  return listHelperPerms(p.id, user);
});

export const PUT = api(async (req, p) => {
  const user = await authed();
  const b = await body(req);
  return setHelperPerms(p.id, user, String(b.userId || ''), b.permissions);
});
