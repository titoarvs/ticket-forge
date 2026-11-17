import { api, platformOwner, body, HttpError } from '@/lib/server/http';
import { billingOn } from '@/lib/limits';
import { updatePlan } from '@/lib/billing-plans';

// Edits a plan. A change to its price, currency, cycle, free option or trial days while it has subscribers adds a new
// version (`newVersion: true`): subscribers keep theirs and new subscriptions use the new one.
export const PUT = api(async (req, p) => {
  const u = await platformOwner();
  if (!billingOn()) throw new HttpError(400, 'Plans are only used on the hosted service.');
  return updatePlan(p.id, await body(req), u);
});
