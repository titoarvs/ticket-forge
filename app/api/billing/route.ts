import { api, authed, HttpError } from '@/lib/server/http';
import { effectivePlan, usage, billingOn, limitRows } from '@/lib/limits';
import { listBillingPlans } from '@/lib/billing-plans';
import { activeGateways } from '@/lib/gateways';
import { qs } from '@/lib/db';

// The workspace's plan, what it uses, and the plans it can choose (Administration → Billing, owner
// only).
export const GET = api(async () => {
  const u: any = await authed();
  if (!u.is_owner) throw new HttpError(403, 'Only the workspace owner can see billing.');
  const ws = u.workspace_id;
  const w =
    (
      await qs(
        'select plan, subscription_status, billing_interval, current_period_end, cancel_at_period_end, trial_ends_at, gateway, stripe_customer_id from workspaces where id = $1',
        [ws],
      )
    ).rows[0] || {};
  const plan = await effectivePlan(ws),
    used = await usage(ws);
  return {
    enabled: billingOn(),
    gateways: await activeGateways(),
    plan,
    usage: used,
    limits: limitRows(plan, used),
    subscription: {
      status: w.subscription_status || null,
      interval: w.billing_interval || null,
      periodEnd: w.current_period_end || null,
      cancelAtPeriodEnd: Boolean(w.cancel_at_period_end),
      trialEndsAt: w.trial_ends_at || null,
      gateway: w.gateway || null,
      hasCustomer: Boolean(w.stripe_customer_id),
      // A trial or a paid plan can be cancelled. It keeps access until `accessEndsAt`, then the
      // workspace is on Free.
      cancellable:
        ['subscription', 'locked'].includes(plan.source) &&
        !w.cancel_at_period_end &&
        w.plan !== 'free',
      accessEndsAt:
        plan.source === 'subscription' && w.cancel_at_period_end
          ? w.current_period_end || w.trial_ends_at || null
          : null,
    },
    // Archived plans are left out: they can't be bought any more (a workspace already on one keeps
    // it in `plan`).
    plans: await listBillingPlans({ forPurchase: true }),
  };
});
