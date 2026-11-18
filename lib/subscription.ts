// Cancelling a paid subscription or a trial (workspace owner). The gateway stops charging at once; the workspace keeps its paid
// plan until the period it already paid for ends (`cancel_at_period_end` + `current_period_end`: lib/limits.ts turns
// that into the Free plan afterwards). Refunds are not part of this.
import { asSystem } from './db';
import { orm, workspaces, eq, sql } from './orm';
import { cancelPayMongoSubscription } from './paymongo';
import { cancelAtPeriodEnd } from './stripe';
import { err } from './errors';

/** Subscription states that can still be cancelled. */
const CANCELLABLE = ['active', 'trialing', 'past_due'];

/** Keeps access to the end of the paid period (now, when no period was recorded). */
const endAtPeriodEnd = (ws) => asSystem(async () => {
  await orm.update(workspaces)
    .set({ cancelAtPeriodEnd: true, currentPeriodEnd: sql`coalesce(${workspaces.currentPeriodEnd}, ${workspaces.trialEndsAt}, now())` })
    .where(eq(workspaces.id, ws));
});

/**
 * Cancels the workspace's subscription. Returns { status, cancelAtPeriodEnd, accessEndsAt }.
 * Throws 409 with a clear message when there is no active subscription (or it is already cancelled).
 */
export async function cancelSubscription(ws) {
  const [w] = await asSystem(async () => await orm.select({
    plan: workspaces.plan, status: workspaces.subscriptionStatus, periodEnd: workspaces.currentPeriodEnd, trialEnd: workspaces.trialEndsAt,
    cancelAtPeriodEnd: workspaces.cancelAtPeriodEnd, paymongoId: workspaces.paymongoSubscriptionId, stripeId: workspaces.stripeSubscriptionId,
  }).from(workspaces).where(eq(workspaces.id, ws)));
  if (!w) throw err('Workspace not found', 404);
  if (!w.plan || w.plan === 'free' || !CANCELLABLE.includes(w.status)) throw err('There is no active subscription to cancel.', 409);
  const ends = w.periodEnd || w.trialEnd;
  if (w.cancelAtPeriodEnd) throw err(`This subscription is already cancelled. Paid access ends on ${ends ? new Date(ends).toDateString() : 'the end of the current period'}.`, 409);

  if (w.paymongoId) {
    await cancelPayMongoSubscription(w.paymongoId, 'unspecified');
    await endAtPeriodEnd(ws);
  } else if (w.stripeId) {
    await cancelAtPeriodEnd(w.stripeId, ws);
  } else {
    // A trial, or a plan paid once through PayMongo or Xendit: there is nothing to stop at the gateway; the plan ends with the period.
    await endAtPeriodEnd(ws);
  }
  const [n] = await asSystem(async () => await orm.select({
    status: workspaces.subscriptionStatus, cancelAtPeriodEnd: workspaces.cancelAtPeriodEnd, periodEnd: workspaces.currentPeriodEnd,
  }).from(workspaces).where(eq(workspaces.id, ws)));
  return { status: n.status, cancelAtPeriodEnd: Boolean(n.cancelAtPeriodEnd), accessEndsAt: n.periodEnd || null };
}
