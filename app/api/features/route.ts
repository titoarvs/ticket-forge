import { api, authed, body, HttpError } from '@/lib/server/http';
import { publicFlags, setFlags } from '@/lib/features';

// Feature flags (Administration → Features). Everyone signed in can read which features are locked (the app hides
// them); only the owner can lock or unlock: PUT { changes: { [featureId]: { locked: boolean, note?: string } } }.
export const GET = api(async () => { await authed(); return publicFlags(); });

export const PUT = api(async (req) => {
  const user: any = await authed();
  if (!user.is_owner) throw new HttpError(403, 'Only the owner can lock or unlock features.');
  const b = await body(req);
  if (!b.changes || typeof b.changes !== 'object') throw new HttpError(400, 'Nothing to change.');
  await setFlags(user, b.changes);
  return publicFlags();
});
