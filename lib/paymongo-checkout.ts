// PayMongo Checkout (SaaS, PHP): sends the owner to PayMongo's hosted checkout page to start a paid plan, and handles
// the way back (paid, cancelled or failed). Talks to PayMongo's REST API directly (no SDK). The plan only changes once
// PayMongo says the payment is paid: cancelling or failing at PayMongo never creates a subscription.
//   PAYMONGO_SECRET_KEY   sk_test_… / sk_live_… (server only)
//   PAYMONGO_API_BASE     only for tests against a local mock (default https://api.paymongo.com)
import { qs } from './db';
import { PLANS } from './plans';
import { checkoutQuote, paymentStep, CHECKOUT_CURRENCY } from './payment-methods';
import { err } from './errors';

export const paymongoConfigured = () => Boolean(process.env.PAYMONGO_SECRET_KEY);
const base = () => (process.env.PAYMONGO_API_BASE || 'https://api.paymongo.com').replace(/\/$/, '');
const KEEPS_PLAN = ['active', 'trialing', 'past_due'];

async function paymongo(method, path, attributes?) {
  if (!paymongoConfigured()) throw err('Payments aren’t set up on this server yet (PAYMONGO_SECRET_KEY).', 503);
  const res = await fetch(`${base()}/v1/${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: method === 'GET' ? undefined : JSON.stringify({ data: { attributes } }),
    signal: AbortSignal.timeout(20000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw err(`PayMongo: ${out?.errors?.[0]?.detail || res.statusText}`, res.status >= 500 ? 502 : 400);
  return out.data;
}

async function workspaceRow(ws) {
  const w = (await qs('select * from workspaces where id = $1', [ws])).rows[0];
  if (!w) throw err('Workspace not found', 404);
  return w;
}
const hasPaidPlan = (w) => w.plan && w.plan !== 'free' && KEEPS_PLAN.includes(w.subscription_status);

/**
 * Starts a PayMongo checkout for `plan` (pro | team), billed monthly or yearly, paid with `method` (card | gcash | paymaya).
 * Returns the PayMongo checkout address to send the owner to. Nothing is subscribed yet.
 */
export async function startCheckout({ ws, plan, interval, method, appUrl }: any) {
  const step = paymentStep({ plan, interval, method }); // checks the plan, period and method
  const q = checkoutQuote(plan, interval);
  const w = await workspaceRow(ws);
  if (hasPaidPlan(w)) throw err('This workspace already has a paid plan.', 409);
  const back = (result) => `${appUrl}/checkout/return?result=${result}&plan=${q.plan.id}&interval=${q.interval}`;
  const s = await paymongo('POST', 'checkout_sessions', {
    line_items: [
      {
        name: `${PLANS[q.plan.id].name} plan (${q.interval === 'year' ? 'yearly' : 'monthly'})`,
        amount: Math.round(q.amount * 100),
        currency: CHECKOUT_CURRENCY,
        quantity: 1,
      },
    ],
    payment_method_types: [step.method],
    description: `TicketForge ${PLANS[q.plan.id].name} plan`,
    reference_number: ws,
    send_email_receipt: false,
    show_description: true,
    success_url: back('success'),
    cancel_url: back('cancelled'),
    metadata: { workspace_id: ws, plan: q.plan.id, interval: q.interval },
  });
  const url = s?.attributes?.checkout_url;
  if (!s?.id || !url) throw err('PayMongo didn’t return a checkout page. Try again.', 502);
  await qs('update workspaces set paymongo_checkout_id = $2 where id = $1', [ws, s.id]);
  return { url };
}

const isPaid = (s) =>
  (s?.attributes?.payments || []).some((p) => p?.attributes?.status === 'paid') ||
  s?.attributes?.payment_intent?.attributes?.status === 'succeeded';

const planInfo = (id) => (PLANS[id] ? { id, name: PLANS[id].name } : null);

/**
 * What to show when the owner comes back from PayMongo. `result` is what PayMongo's redirect said (success | cancelled | failed).
 * A success is never taken on trust: the checkout session is read back from PayMongo and must be paid.
 * Returns { status: 'success' | 'cancelled' | 'failed', plan, interval, message }.
 */
export async function checkoutResult({ ws, result, plan, interval }: any) {
  const retry = { plan: PLANS[plan] && plan !== 'free' ? plan : null, interval: interval === 'year' ? 'year' : 'month' };
  const w = await workspaceRow(ws);
  if (result === 'cancelled') {
    await qs('update workspaces set paymongo_checkout_id = null where id = $1', [ws]);
    return {
      status: 'cancelled',
      ...retry,
      current: planInfo(hasPaidPlan(w) ? w.plan : 'free'),
      message: 'Checkout cancelled. No subscription was created and you haven’t been charged.',
    };
  }
  if (result !== 'success') return { status: 'failed', ...retry, message: 'The payment didn’t go through. You haven’t been charged.' };
  if (!w.paymongo_checkout_id) {
    // Opened again after it was already handled: show the plan in force.
    if (hasPaidPlan(w))
      return {
        status: 'success',
        plan: planInfo(w.plan),
        interval: w.billing_interval,
        message: `You’re on the ${PLANS[w.plan].name} plan.`,
      };
    return { status: 'failed', ...retry, message: 'We couldn’t find this checkout. You haven’t been charged.' };
  }
  let s;
  try {
    s = await paymongo('GET', `checkout_sessions/${encodeURIComponent(w.paymongo_checkout_id)}`);
  } catch (e) {
    return { status: 'failed', ...retry, message: `We couldn’t confirm the payment (${e.message}). If you were charged, contact support.` };
  }
  if (!isPaid(s)) return { status: 'failed', ...retry, message: 'The payment wasn’t completed. You haven’t been charged.' };
  const meta = s.attributes?.metadata || {};
  const id = meta.plan,
    per = meta.interval === 'year' ? 'year' : 'month';
  if (meta.workspace_id !== ws || !PLANS[id] || id === 'free')
    return { status: 'failed', ...retry, message: 'This payment doesn’t match your workspace. Contact support.' };
  const end = new Date();
  if (per === 'year') end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  await qs(
    `update workspaces set plan = $2, subscription_status = 'active', billing_interval = $3, current_period_end = $4,
      cancel_at_period_end = false, paymongo_checkout_id = null where id = $1`,
    [ws, id, per, end],
  );
  return { status: 'success', plan: planInfo(id), interval: per, message: `Payment received. You’re now on the ${PLANS[id].name} plan.` };
}
