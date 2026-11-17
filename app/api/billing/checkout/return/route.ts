import { api, authed, HttpError } from '@/lib/server/http';
import { billingOn } from '@/lib/limits';
import { checkoutResult } from '@/lib/subscriptions';

// The way back from a payment gateway: success (read back from the gateway and activated), cancelled or failed.
export const GET = api(async (req) => {
  const u: any = await authed();
  if (!u.is_owner) throw new HttpError(403, 'Only the workspace owner can change the plan.');
  if (!billingOn()) throw new HttpError(400, 'Plans are only used on the hosted service.');
  return checkoutResult({ ws: u.workspace_id, result: new URL(req.url).searchParams.get('result') || '' });
});
