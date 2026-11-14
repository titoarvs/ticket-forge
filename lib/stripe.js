// Stripe billing (SaaS): Checkout to subscribe, the Customer Portal to change card, plan or cancel, and the webhook
// that keeps each workspace's plan in step with its subscription. Talks to Stripe's REST API directly (no SDK).
//   STRIPE_SECRET_KEY        sk_test_… / sk_live_… (server only)
//   STRIPE_WEBHOOK_SECRET    whsec_… for /api/stripe/webhook
//   STRIPE_PRICE_PRO_MONTH, STRIPE_PRICE_PRO_YEAR, STRIPE_PRICE_TEAM_MONTH, STRIPE_PRICE_TEAM_YEAR   price ids
//   STRIPE_API_BASE          only for tests against a local mock (default https://api.stripe.com)
import crypto from 'node:crypto';
import { qs } from './db.js';
import { PLANS, priceIdFor, planForPrice } from './plans.js';

const err = (message, status = 400) => Object.assign(new Error(message), { status });
export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);
const base = () => (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '');

/** Stripe's form encoding, including nested objects and arrays (line_items[0][price]=…). */
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}
async function stripe(method, path, params, { idempotencyKey } = {}) {
  if (!stripeConfigured()) throw err('Billing isn’t set up on this server yet (STRIPE_SECRET_KEY).', 503);
  const res = await fetch(`${base()}/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: method === 'GET' ? undefined : form(params).toString(),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw err(`Stripe: ${body?.error?.message || res.statusText}`, res.status >= 500 ? 502 : 400);
  return body;
}

async function workspaceRow(ws) {
  const w = (await qs('select * from workspaces where id = $1', [ws])).rows[0];
  if (!w) throw err('Workspace not found', 404);
  return w;
}
/** The workspace's Stripe customer, created on first use (one per workspace, so invoices carry its name). */
async function ensureCustomer(ws, user) {
  const w = await workspaceRow(ws);
  if (w.stripe_customer_id) return w.stripe_customer_id;
  const c = await stripe('POST', 'customers', { email: user.email, name: w.name, metadata: { workspace_id: ws } }, { idempotencyKey: `customer-${ws}` });
  await qs('update workspaces set stripe_customer_id = $2 where id = $1 and stripe_customer_id is null', [ws, c.id]);
  return (await workspaceRow(ws)).stripe_customer_id || c.id;
}

/** A Stripe Checkout page to subscribe the workspace to `plan` (pro | team), billed monthly or yearly. */
export async function checkoutUrl({ ws, user, plan, interval, appUrl }) {
  if (!PLANS[plan] || plan === 'free') throw err('Choose a paid plan.');
  const price = priceIdFor(plan, interval === 'year' ? 'year' : 'month');
  if (!price) throw err(`The ${PLANS[plan].name} plan isn’t available ${interval === 'year' ? 'yearly' : 'monthly'} yet.`, 503);
  const w = await workspaceRow(ws);
  if (w.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(w.subscription_status)) {
    throw err('This workspace already has a subscription. Change the plan in Manage billing.', 409);
  }
  const customer = await ensureCustomer(ws, user);
  const s = await stripe('POST', 'checkout/sessions', {
    mode: 'subscription', customer, client_reference_id: ws,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { workspace_id: ws } },
    metadata: { workspace_id: ws },
    allow_promotion_codes: 'true',
    success_url: `${appUrl}/admin/billing?checkout=done`,
    cancel_url: `${appUrl}/admin/billing?checkout=cancelled`,
  });
  return s.url;
}

/** The Stripe Customer Portal: change card or plan, see invoices, cancel. */
export async function portalUrl({ ws, appUrl }) {
  const w = await workspaceRow(ws);
  if (!w.stripe_customer_id) throw err('This workspace has no billing account yet. Choose a plan first.', 409);
  const s = await stripe('POST', 'billing_portal/sessions', { customer: w.stripe_customer_id, return_url: `${appUrl}/admin/billing` });
  return s.url;
}

// ---------------------------------------------------------------- webhook
/** Checks the Stripe-Signature header (HMAC-SHA256 of "<timestamp>.<body>", within 5 minutes). */
export function verifySignature(rawBody, header, secret = process.env.STRIPE_WEBHOOK_SECRET, toleranceSec = 300) {
  if (!secret) throw err('The Stripe webhook isn’t set up (STRIPE_WEBHOOK_SECRET).', 503);
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const sigs = String(header || '').split(',').map((p) => p.trim()).filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length) throw err('Bad signature', 400);
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) throw err('Signature too old', 400);
  const want = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const ok = sigs.some((s) => { const got = Buffer.from(s, 'hex'); return got.length === want.length && crypto.timingSafeEqual(got, want); });
  if (!ok) throw err('Bad signature', 400);
}

/** Writes a subscription's state to its workspace. The subscription is read back from Stripe, so the event's copy (possibly old) never decides. */
async function syncSubscription(subId, hintWs = null) {
  const sub = await stripe('GET', `subscriptions/${encodeURIComponent(subId)}`);
  const ws = sub.metadata?.workspace_id || hintWs
    || (await qs('select id from workspaces where stripe_customer_id = $1', [sub.customer])).rows[0]?.id;
  if (!ws) return null;
  const item = sub.items?.data?.[0] || {};
  const plan = planForPrice(item.price?.id) || 'free';
  const end = item.current_period_end || sub.current_period_end; // newer API versions keep it on the item
  const ended = ['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status);
  await qs(`update workspaces set plan = $2, stripe_customer_id = coalesce(stripe_customer_id, $3), stripe_subscription_id = $4,
      subscription_status = $5, billing_interval = $6, current_period_end = $7, cancel_at_period_end = $8 where id = $1`,
    [ws, ended ? 'free' : plan, sub.customer, sub.id, sub.status, item.price?.recurring?.interval || null,
      end ? new Date(end * 1000) : null, Boolean(sub.cancel_at_period_end)]);
  return ws;
}

/** Handles one verified event, once (Stripe may send it again). Returns what happened, for the log. */
export async function handleEvent(ev) {
  const fresh = (await qs('insert into billing_events (id, type) values ($1, $2) on conflict (id) do nothing returning id', [ev.id, ev.type])).rows[0];
  if (!fresh) return { duplicate: true };
  const o = ev.data?.object || {};
  let ws = null;
  try {
    if (ev.type === 'checkout.session.completed' && o.mode === 'subscription' && o.subscription) ws = await syncSubscription(o.subscription, o.client_reference_id || o.metadata?.workspace_id);
    else if (/^customer\.subscription\.(created|updated|deleted|paused|resumed)$/.test(ev.type)) ws = await syncSubscription(o.id);
    else if (/^invoice\.(payment_failed|paid|payment_succeeded)$/.test(ev.type) && (o.subscription || o.parent?.subscription_details?.subscription)) ws = await syncSubscription(o.subscription || o.parent.subscription_details.subscription);
    else return { ignored: ev.type };
  } catch (e) {
    await qs('delete from billing_events where id = $1', [ev.id]); // let Stripe's retry try again
    throw e;
  }
  if (ws) await qs('update billing_events set workspace_id = $2 where id = $1', [ev.id, ws]);
  return { workspace: ws, type: ev.type };
}
