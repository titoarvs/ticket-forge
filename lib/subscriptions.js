// Paid plan with a trial (PayMongo, PHP). The owner starts a plan: a PayMongo subscription is created, its id is saved
// on the workspace and the workspace is `trialing` for TRIAL_DAYS. When the trial ends the first recurring charge is
// attempted in PHP (and recorded in subscription_charges): paid → `active`, not paid → `past_due`.
// Failed-payment grace and cancelling are separate (TF-96, TF-97).
import crypto from 'node:crypto';
import { qs } from './db.js';
import { TRIAL_DAYS } from './plans.js';
import { checkoutQuote, supportedMethods, CHECKOUT_CURRENCY } from './payment-methods.js';
import * as paymongo from './paymongo.js';

const err = (message, status = 400) => Object.assign(new Error(message), { status });

/** Subscription states that count as "has a paid plan" (the same ones limits.js keeps the plan for). */
export const PAID_STATES = ['active', 'trialing', 'past_due'];

const addPeriod = (from, interval) => {
  const d = new Date(from);
  if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
};

/**
 * Starts a paid plan with a trial for a free workspace. The workspace is claimed first, in one statement, so two
 * requests at once can't both start a plan; if PayMongo then fails the workspace is put back as it was.
 * Throws 409 when the workspace already has a paid plan. Returns the billing summary of the new subscription.
 */
export async function startTrial({ ws, user, plan, interval, method }) {
  const quote = checkoutQuote(plan, interval);
  if (method && !supportedMethods().some((m) => m.id === String(method))) throw err('That payment method isn’t available.');
  if (!paymongo.paymongoConfigured()) throw err('Payments aren’t set up on this server yet (PAYMONGO_SECRET_KEY).', 503);
  const before = (await qs('select * from workspaces where id = $1', [ws])).rows[0];
  if (!before) throw err('Workspace not found', 404);

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86400000);
  const claimed = (await qs(`update workspaces set plan = $2, subscription_status = 'trialing', billing_interval = $3, trial_ends_at = $4,
      current_period_end = $4, cancel_at_period_end = false
    where id = $1 and not (plan <> 'free' and coalesce(subscription_status, '') = any($5)) returning id`, [ws, quote.plan.id, quote.interval, trialEndsAt, PAID_STATES])).rows[0];
  if (!claimed) throw err('This workspace already has an active paid plan.', 409);

  try {
    const customerId = before.paymongo_customer_id
      || await paymongo.createCustomer({ email: user.email, name: before.name, metadata: { workspace_id: ws } });
    const planId = await paymongo.createPlan({ name: `${quote.plan.name} (${quote.interval}ly)`, amount: quote.amount, currency: quote.currency, interval: quote.interval });
    const subscriptionId = await paymongo.createSubscription({ customerId, planId, trialEndsAt, metadata: { workspace_id: ws, plan: quote.plan.id, interval: quote.interval } });
    await qs('update workspaces set paymongo_customer_id = $2, paymongo_subscription_id = $3 where id = $1', [ws, customerId, subscriptionId]);
    return { status: 'trialing', plan: quote.plan.id, interval: quote.interval, currency: quote.currency, amount: quote.amount, trialEndsAt, subscriptionId };
  } catch (e) {
    await qs(`update workspaces set plan = $2, subscription_status = $3, billing_interval = $4, trial_ends_at = $5, current_period_end = $6,
      cancel_at_period_end = $7 where id = $1`, [ws, before.plan, before.subscription_status, before.billing_interval, before.trial_ends_at, before.current_period_end, before.cancel_at_period_end]);
    throw e;
  }
}

/** Attempts the first recurring charge of one workspace whose trial has ended, once, and moves it to active or past_due. */
async function chargeFirst(w) {
  const quote = checkoutQuote(w.plan, w.billing_interval);
  const claim = (await qs(`insert into subscription_charges (id, workspace_id, subscription_id, cycle, amount, currency)
    values ($1, $2, $3, 1, $4, $5) on conflict (subscription_id, cycle) do nothing returning id`,
  [crypto.randomUUID(), w.id, w.paymongo_subscription_id, quote.amount, CHECKOUT_CURRENCY])).rows[0];
  if (!claim) return false; // someone else is already charging it
  let paid = false, intent = null, error = null;
  try {
    intent = await paymongo.createPaymentIntent({ amount: quote.amount, currency: CHECKOUT_CURRENCY, description: `${quote.plan.name} plan, first ${quote.interval}`, metadata: { workspace_id: w.id, subscription_id: w.paymongo_subscription_id } });
    paid = intent.status === 'succeeded';
    if (!paid) error = 'The payment was not completed.';
  } catch (e) { error = e.message; }
  await qs('update subscription_charges set status = $2, payment_intent_id = $3, error = $4 where id = $1', [claim.id, paid ? 'succeeded' : 'failed', intent?.id || null, error]);
  await qs(`update workspaces set subscription_status = $2, current_period_end = $3 where id = $1 and subscription_status = 'trialing'`,
    [w.id, paid ? 'active' : 'past_due', paid ? addPeriod(w.trial_ends_at, quote.interval) : w.trial_ends_at]);
  return true;
}

/**
 * Settles the trials that have ended (one workspace, or all): the first charge is attempted in PHP and the status becomes
 * active (paid) or past_due (not paid). Safe to call often and from several places; each trial is charged once.
 * Returns how many charges were attempted.
 */
export async function settleTrials(ws = null) {
  const due = (await qs(`select * from workspaces where subscription_status = 'trialing' and paymongo_subscription_id is not null
    and trial_ends_at <= now() and ($1::text is null or id = $1)`, [ws])).rows;
  let n = 0;
  for (const w of due) if (await chargeFirst(w)) n++;
  return n;
}

/** The workspace's recurring charge attempts, newest first. */
export async function listCharges(ws) {
  return (await qs('select cycle, amount, currency, status, error, attempted_at from subscription_charges where workspace_id = $1 order by attempted_at desc limit 12', [ws])).rows
    .map((r) => ({ cycle: r.cycle, amount: r.amount, currency: r.currency, status: r.status, error: r.error, attemptedAt: r.attempted_at }));
}
