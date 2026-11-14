import { api, authed, body, HttpError, appUrl } from '@/lib/server/http';
import { checkoutUrl } from '@/lib/stripe.js';
import { billingOn } from '@/lib/limits.js';

// Start a subscription: returns the Stripe Checkout address to send the owner to.
export const POST = api(async (req) => {
  const u: any = await authed();
  if (!u.is_owner) throw new HttpError(403, 'Only the workspace owner can change the plan.');
  if (!billingOn()) throw new HttpError(400, 'Plans are only used on the hosted service.');
  const b = await body(req);
  return { url: await checkoutUrl({ ws: u.workspace_id, user: u, plan: String(b.plan || ''), interval: String(b.interval || 'month'), appUrl: appUrl(req) }) };
});
