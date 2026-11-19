// Subscriptions (SaaS): the owner picks a plan, with a trial when the plan has trial days, and
// later pays, changes plan or cancels (cancelling is in subscription.js).
//   - Starting a plan that has trial days needs no card: the workspace is `trialing` with full
//     access until the trial ends.
//   - A trial that ends without a payment locks the workspace (limits.js lockStatus) until the
//     owner pays at checkout.
//   - Paying: the owner picks one of the active gateways (gateways.js), pays on its hosted page
//     and, on the way back, the payment is read back from the gateway and the plan becomes
//     `active`.
//   - Changing plan while paid is a new payment on the new plan: it starts a full period, with no
//     proration (not decided yet), and a previous Stripe subscription is cancelled once the new one
//     is paid.
// A workspace keeps the plan version it subscribed to (billing-plans.js); new subscriptions use the
// latest version.
import { qs } from './db';
import { getPlanVersion, listBillingPlans } from './billing-plans';
import { activeGateways, createCheckout, readCheckout } from './gateways';
import { stripe } from './stripe';
import { err } from './errors';

const addPeriod = (from, interval) => {
  const d = new Date(from);
  if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
};
const brief = (p) => ({ id: p.id, name: p.name, version: p.version });

async function workspaceRow(ws) {
  const w = (await qs('select * from workspaces where id = $1', [ws])).rows[0];
  if (!w) throw err('Workspace not found', 404);
  return w;
}
/** Paid for now (or failing and being retried): choosing another plan means paying again. */
const paidNow = (w) =>
  w.plan && w.plan !== 'free' && ['active', 'past_due'].includes(w.subscription_status);
const trialRunning = (w) =>
  w.subscription_status === 'trialing' && w.trial_ends_at && new Date(w.trial_ends_at) > new Date();

/**
 * The owner chooses a plan (the latest version of it). Returns { status, plan, trialEndsAt?,
 * requiresPayment? }:
 *   - a free plan: the workspace moves to it (cancel a paid subscription first);
 *   - during a trial: the trial carries on with the new plan, no payment;
 *   - a paid plan with trial days the workspace hasn't used: the trial starts, no card (claimed in
 *     one statement, so two requests at once can't both start it);
 *   - otherwise `requiresPayment: true`: go to checkout.
 */
export async function startPlan({ ws, planId }: any) {
  const plan = await getPlanVersion(String(planId || ''));
  if (!plan || plan.archived) throw err('Choose a plan from the list.', 404);
  const w = await workspaceRow(ws);

  if (plan.isFree) {
    if (paidNow(w) && !w.cancel_at_period_end)
      throw err(
        'Cancel your subscription first. You keep the paid plan until the period you paid for ends.',
        409,
      );
    await qs(
      `update workspaces set plan = $2, plan_version = $3, subscription_status = $4, billing_interval = null, current_period_end = null,
      cancel_at_period_end = false, gateway = null where id = $1`,
      [ws, plan.id, plan.version, plan.id === 'free' ? null : 'active'],
    );
    return { status: plan.id === 'free' ? 'free' : 'active', plan: brief(plan) };
  }
  if (w.plan === plan.id && ((paidNow(w) && !w.cancel_at_period_end) || trialRunning(w)))
    throw err('You’re already on this plan.', 409);

  if (trialRunning(w)) {
    // switching plan during the trial: same trial, new plan
    await qs(
      `update workspaces set plan = $2, plan_version = $3, billing_interval = $4 where id = $1`,
      [ws, plan.id, plan.version, plan.interval],
    );
    return { status: 'trialing', plan: brief(plan), trialEndsAt: w.trial_ends_at };
  }
  if (paidNow(w))
    return { status: w.subscription_status, plan: brief(plan), requiresPayment: true }; // upgrade, change or re-subscribe: pay at checkout

  if (plan.trialDays > 0 && !w.trial_ends_at) {
    const trialEndsAt = new Date(Date.now() + plan.trialDays * 86400000);
    const claimed = (
      await qs(
        `update workspaces set plan = $2, plan_version = $3, subscription_status = 'trialing', billing_interval = $4,
        trial_ends_at = $5, current_period_end = $5, cancel_at_period_end = false, gateway = null, checkout_ref = null
      where id = $1 and trial_ends_at is null and not (plan <> 'free' and coalesce(subscription_status, '') in ('active', 'trialing', 'past_due')) returning id`,
        [ws, plan.id, plan.version, plan.interval, trialEndsAt],
      )
    ).rows[0];
    if (claimed) return { status: 'trialing', plan: brief(plan), trialEndsAt };
  }
  return { status: w.subscription_status || 'free', plan: brief(plan), requiresPayment: true };
}

/**
 * What checkout shows: the plans that can be bought, the active gateways (each with the plans it
 * can take) and the current plan.
 */
export async function checkoutOptions({ ws, planId }: any) {
  const w = await workspaceRow(ws);
  const plans = (await listBillingPlans({ forPurchase: true })).filter((p) => !p.isFree);
  const gateways = await activeGateways();
  return {
    plans,
    gateways,
    plan:
      plans.find((p) => p.id === planId)?.id ||
      plans.find((p) => p.id === w.plan)?.id ||
      plans[0]?.id ||
      null,
    current: { plan: w.plan, version: w.plan_version || 1, status: w.subscription_status || null },
  };
}

/**
 * Opens the hosted checkout of the chosen gateway for the chosen plan. Returns { url }. Nothing
 * changes until it is paid.
 */
export async function startPlanCheckout({ ws, user, planId, gateway, appUrl }: any) {
  const plan = await getPlanVersion(String(planId || ''));
  if (!plan || plan.archived || plan.isFree) throw err('Choose a paid plan.');
  const gw = (await activeGateways(plan.currency)).find((g) => g.provider === gateway);
  if (!gw)
    throw err(
      gateway
        ? `That payment gateway can’t take ${plan.currency} payments or isn’t active. Choose another.`
        : 'Choose a payment gateway.',
    );
  const w = await workspaceRow(ws);
  if (w.plan === plan.id && w.subscription_status === 'active' && !w.cancel_at_period_end)
    throw err('You’re already on this plan.', 409);
  const back = (result) => `${appUrl}/checkout/return?gateway=${gw.provider}&result=${result}`;
  const { url, ref } = await createCheckout(gw.provider, {
    ws,
    email: user?.email,
    plan,
    successUrl: back('success'),
    cancelUrl: back('cancelled'),
  });
  await qs('update workspaces set checkout_ref = $2 where id = $1', [ws, `${gw.provider}:${ref}`]);
  return { url };
}

const planInfo = async (id, version?) => {
  const p = id ? await getPlanVersion(id, version) : null;
  return p ? { id: p.id, name: p.name } : { id: 'free', name: 'Free' };
};

/**
 * What to show when the owner comes back from a gateway: { status: 'success' | 'cancelled' |
 * 'failed', plan, interval, message }. A success is never taken on trust: the checkout is read back
 * from the gateway and must be paid, and it must be this workspace's. Only then does the plan
 * become active (and a lock from an ended trial is lifted).
 */
export async function checkoutResult({ ws, result }: any) {
  const w = await workspaceRow(ws);
  const live = paidNow(w) || trialRunning(w);
  const retry = { plan: null, interval: 'month' };
  if (result === 'cancelled') {
    await qs('update workspaces set checkout_ref = null where id = $1', [ws]);
    return {
      status: 'cancelled',
      ...retry,
      current: live ? await planInfo(w.plan, w.plan_version || 1) : await planInfo('free'),
      message: 'Checkout cancelled. No payment was taken and nothing changed.',
    };
  }
  if (result !== 'success')
    return {
      status: 'failed',
      ...retry,
      message: 'The payment didn’t go through. You haven’t been charged.',
    };
  if (!w.checkout_ref) {
    if (paidNow(w)) {
      const p = await planInfo(w.plan, w.plan_version || 1);
      return {
        status: 'success',
        plan: p,
        interval: w.billing_interval,
        message: `You’re on the ${p.name} plan.`,
      };
    }
    return {
      status: 'failed',
      ...retry,
      message: 'We couldn’t find this checkout. You haven’t been charged.',
    };
  }
  const [gateway, ...rest] = String(w.checkout_ref).split(':');
  const ref = rest.join(':');
  let paid;
  try {
    paid = await readCheckout(gateway, ref);
  } catch (e) {
    return {
      status: 'failed',
      ...retry,
      message: `We couldn’t confirm the payment (${e.message}). If you were charged, contact support.`,
    };
  }
  const plan =
    paid.paid && paid.meta.workspace_id === ws
      ? await getPlanVersion(String(paid.meta.plan || ''), Number(paid.meta.plan_version) || null)
      : null;
  if (!paid.paid)
    return {
      status: 'failed',
      ...retry,
      message: 'The payment wasn’t completed. You haven’t been charged.',
    };
  if (!plan || plan.isFree)
    return {
      status: 'failed',
      ...retry,
      message: 'This payment doesn’t match your workspace. Contact support.',
    };

  // Claim the checkout and activate in one statement: opening the return page twice can't pay
  // twice.
  const claimed = (
    await qs(
      `update workspaces set plan = $2, plan_version = $3, subscription_status = 'active', billing_interval = $4, current_period_end = $5,
      cancel_at_period_end = false, gateway = $6, checkout_ref = null, stripe_subscription_id = $7, stripe_customer_id = coalesce($8, stripe_customer_id)
    where id = $1 and checkout_ref = $9 returning id`,
      [
        ws,
        plan.id,
        plan.version,
        plan.interval,
        addPeriod(new Date(), plan.interval),
        gateway,
        paid.subscriptionId,
        paid.customerId,
        w.checkout_ref,
      ],
    )
  ).rows[0];
  if (claimed && w.stripe_subscription_id && w.stripe_subscription_id !== paid.subscriptionId) {
    // Changed plan: the old Stripe subscription must not be charged again.
    await stripe('DELETE', `subscriptions/${encodeURIComponent(w.stripe_subscription_id)}`).catch(
      (e) => console.error('Could not cancel the previous Stripe subscription:', e.message),
    );
  }
  return {
    status: 'success',
    plan: { id: plan.id, name: plan.name },
    interval: plan.interval,
    message: `Payment received. You’re now on the ${plan.name} plan.`,
  };
}
