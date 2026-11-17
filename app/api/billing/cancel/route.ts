import { api, authed, HttpError } from '@/lib/server/http';
import { billingOn } from '@/lib/limits';
import { cancelSubscription } from '@/lib/subscription';

// Cancel the paid subscription (owner only). Paid access stays until the current period ends, then the workspace is on Free.
export const POST = api(async () => {
  const u: any = await authed();
  if (!u.is_owner) throw new HttpError(403, 'Only the workspace owner can cancel the subscription.');
  if (!billingOn()) throw new HttpError(400, 'Plans are only used on the hosted service.');
  return cancelSubscription(u.workspace_id);
});
