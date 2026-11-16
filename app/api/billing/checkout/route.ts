import { api, authed, body, HttpError, appUrl } from '@/lib/server/http';
import { billingOn } from '@/lib/limits.js';
import { checkoutOptions, startPlanCheckout } from '@/lib/subscriptions.js';

function ownerCheckout(u: any) {
  if (!u.is_owner) throw new HttpError(403, 'Only the workspace owner can change the plan.');
  if (!billingOn()) throw new HttpError(400, 'Plans are only used on the hosted service.');
}

// Checkout page data: the plans that can be bought and the active payment gateways to pay with.
export const GET = api(async (req) => {
  const u: any = await authed();
  ownerCheckout(u);
  return checkoutOptions({ ws: u.workspace_id, planId: new URL(req.url).searchParams.get('plan') || '' });
});

// Pay: returns the hosted checkout address of the chosen gateway for the chosen plan (nothing changes until it is paid).
export const POST = api(async (req) => {
  const u: any = await authed();
  ownerCheckout(u);
  const b = await body(req);
  return startPlanCheckout({ ws: u.workspace_id, user: u, planId: String(b.plan || ''), gateway: String(b.gateway || ''), appUrl: appUrl(req) });
});
