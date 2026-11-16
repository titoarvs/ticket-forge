import { api, authed, body, HttpError } from '@/lib/server/http';
import { billingOn } from '@/lib/limits.js';
import { startTrial } from '@/lib/subscriptions.js';

// Start a paid plan with a trial (PayMongo, PHP): the subscription is created as trialing and its id saved on the workspace.
export const POST = api(async (req) => {
  const u: any = await authed();
  if (!u.is_owner) throw new HttpError(403, 'Only the workspace owner can change the plan.');
  if (!billingOn()) throw new HttpError(400, 'Plans are only used on the hosted service.');
  const b = await body(req);
  return startTrial({ ws: u.workspace_id, user: u, plan: String(b.plan || ''), interval: String(b.interval || 'month'), method: b.method ? String(b.method) : '' });
});
