import { api, authed } from '@/lib/server/http';
import { listBillingPlans } from '@/lib/billing-plans';

// The plans and their limits (each limit has a name, a numeric value and a unit; value null = no
// limit), with each plan's price, currency, cycle and trial days. `?purchasable=1` lists only the
// plans that can be bought now: archived plans are left out.
export const GET = api(async (req) => {
  await authed();
  const forPurchase = new URL(req.url).searchParams.get('purchasable') === '1';
  return { plans: await listBillingPlans({ forPurchase }) };
});
