import { api, platformOwner, body, HttpError } from '@/lib/server/http';
import { billingOn } from '@/lib/limits';
import { listBillingPlans, createPlan, CURRENCIES, INTERVALS } from '@/lib/billing-plans';

function hosted() {
  if (!billingOn()) throw new HttpError(400, 'Plans are only used on the hosted service.');
}

// The plans the owner manages: the latest version of each, with how many workspaces are subscribed.
export const GET = api(async () => {
  await platformOwner();
  hosted();
  return { currencies: CURRENCIES, intervals: INTERVALS, plans: await listBillingPlans() };
});

// Creates a plan: name, price, currency (PHP or USD), recurring cycle, free-plan option and trial
// days.
export const POST = api(async (req) => {
  const u = await platformOwner();
  hosted();
  return { plan: await createPlan(await body(req), u) };
});
