import { api, authed, body, HttpError, appUrl } from '@/lib/server/http';
import { billingOn } from '@/lib/limits';
import { startCheckout } from '@/lib/paymongo-checkout';

// Start a paid plan: returns the PayMongo checkout address to send the owner to (nothing is subscribed until it is paid).
export const POST = api(async (req) => {
  const u: any = await authed();
  if (!u.is_owner) throw new HttpError(403, 'Only the workspace owner can change the plan.');
  if (!billingOn()) throw new HttpError(400, 'Plans are only used on the hosted service.');
  const b = await body(req);
  return startCheckout({
    ws: u.workspace_id,
    plan: String(b.plan || ''),
    interval: String(b.interval || 'month'),
    method: String(b.method || ''),
    appUrl: appUrl(req),
  });
});
