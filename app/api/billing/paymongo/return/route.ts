import { api, authed, HttpError } from '@/lib/server/http';
import { billingOn } from '@/lib/limits.js';
import { checkoutResult } from '@/lib/paymongo-checkout.js';

// The way back from PayMongo: success (read back from PayMongo and activated), cancelled or failed.
export const GET = api(async (req) => {
  const u: any = await authed();
  if (!u.is_owner) throw new HttpError(403, 'Only the workspace owner can change the plan.');
  if (!billingOn()) throw new HttpError(400, 'Plans are only used on the hosted service.');
  const q = new URL(req.url).searchParams;
  return checkoutResult({ ws: u.workspace_id, result: q.get('result') || '', plan: q.get('plan') || '', interval: q.get('interval') || 'month' });
});
