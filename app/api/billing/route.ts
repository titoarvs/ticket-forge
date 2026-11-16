import { api, authed, HttpError } from '@/lib/server/http';
import { effectivePlan, usage, billingOn, limitRows } from '@/lib/limits.js';
import { stripeConfigured } from '@/lib/stripe.js';
import { listPlans, TRIAL_DAYS, CURRENCY, priceIdFor } from '@/lib/plans.js';
import { qs } from '@/lib/db.js';

// The workspace's plan, what it uses, and the plans it can choose (Administration → Billing, owner only).
export const GET = api(async () => {
  const u: any = await authed();
  if (!u.is_owner) throw new HttpError(403, 'Only the workspace owner can see billing.');
  const ws = u.workspace_id;
  const w = (await qs('select plan, subscription_status, billing_interval, current_period_end, cancel_at_period_end, trial_ends_at, stripe_customer_id from workspaces where id = $1', [ws])).rows[0] || {};
  const plan = await effectivePlan(ws), used = await usage(ws);
  return {
    enabled: billingOn(), stripe: stripeConfigured(), currency: CURRENCY, trialDays: TRIAL_DAYS,
    plan, usage: used, limits: limitRows(plan, used),
    subscription: { status: w.subscription_status || null, interval: w.billing_interval || null, periodEnd: w.current_period_end || null, cancelAtPeriodEnd: Boolean(w.cancel_at_period_end), trialEndsAt: w.trial_ends_at || null, hasCustomer: Boolean(w.stripe_customer_id) },
    // Archived plans are left out: they can't be bought any more (a workspace already on one keeps it in `plan`).
    plans: listPlans({ forPurchase: true }).map((p: any) => ({ ...p, available: { month: Boolean(priceIdFor(p.id, 'month')), year: Boolean(priceIdFor(p.id, 'year')) } })),
  };
});
