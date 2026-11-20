import { api, authed, body, HttpError } from '@/lib/server/http';
import { billingOn } from '@/lib/limits';
import { startPlan } from '@/lib/subscriptions';

// Choose a plan: starts the trial (no card) when the plan has trial days, switches plan during a
// trial or to a free plan, and otherwise answers `requiresPayment: true` so the app sends the owner
// to checkout.
export const POST = api(async (req) => {
  const u: any = await authed();
  if (!u.is_owner) throw new HttpError(403, 'Only the workspace owner can change the plan.');
  if (!billingOn()) throw new HttpError(400, 'Plans are only used on the hosted service.');
  const b = await body(req);
  return startPlan({ ws: u.workspace_id, planId: String(b.plan || '') });
});
