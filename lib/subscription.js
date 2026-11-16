// Cancelling a paid subscription (workspace owner). The gateway stops charging at once; the workspace keeps its paid
// plan until the period it already paid for ends (`cancel_at_period_end` + `current_period_end`: lib/limits.js turns
// that into the Free plan afterwards). Refunds are not part of this.
import { qs } from './db.js';
import { cancelPayMongoSubscription } from './paymongo.js';
import { cancelAtPeriodEnd } from './stripe.js';

const err = (message, status = 400) => Object.assign(new Error(message), { status });
/** Subscription states that can still be cancelled. */
const CANCELLABLE = ['active', 'trialing', 'past_due'];

/**
 * Cancels the workspace's subscription. Returns { status, cancelAtPeriodEnd, accessEndsAt }.
 * Throws 409 with a clear message when there is no active subscription (or it is already cancelled).
 */
export async function cancelSubscription(ws) {
  const w = (await qs('select plan, subscription_status, current_period_end, trial_ends_at, cancel_at_period_end, paymongo_subscription_id, stripe_subscription_id from workspaces where id = $1', [ws])).rows[0];
  if (!w) throw err('Workspace not found', 404);
  const sub = w.paymongo_subscription_id || w.stripe_subscription_id;
  if (!sub || !w.plan || w.plan === 'free' || !CANCELLABLE.includes(w.subscription_status)) throw err('There is no active subscription to cancel.', 409);
  const ends = w.current_period_end || w.trial_ends_at;
  if (w.cancel_at_period_end) throw err(`This subscription is already cancelled. Paid access ends on ${ends ? new Date(ends).toDateString() : 'the end of the current period'}.`, 409);

  if (w.paymongo_subscription_id) {
    await cancelPayMongoSubscription(w.paymongo_subscription_id, 'unspecified');
    // Access is kept to the end of the paid period (now, when no period was recorded).
    await qs('update workspaces set cancel_at_period_end = true, current_period_end = coalesce(current_period_end, trial_ends_at, now()) where id = $1', [ws]);
  } else {
    await cancelAtPeriodEnd(w.stripe_subscription_id, ws);
  }
  const n = (await qs('select subscription_status, cancel_at_period_end, current_period_end from workspaces where id = $1', [ws])).rows[0];
  return { status: n.subscription_status, cancelAtPeriodEnd: Boolean(n.cancel_at_period_end), accessEndsAt: n.current_period_end || null };
}
