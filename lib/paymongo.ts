// PayMongo webhook (SaaS, PHP): a failed payment puts the workspace's subscription "past due" with a grace period (it
// keeps its paid plan until then, see limits.js), and a payment that then succeeds makes it "active" again.
//   PAYMONGO_WEBHOOK_SECRET   the webhook's secret key (whsk_…) for /api/paymongo/webhook
//   PAYMENT_GRACE_DAYS        days of paid access after a failed payment (default 7, see plans.js)
import crypto from 'node:crypto';
import { qs } from './db';
import { GRACE_DAYS } from './plans';
import { err } from './errors';

/** Checks the Paymongo-Signature header: "t=<timestamp>,te=<test signature>,li=<live signature>", an HMAC-SHA256 of "<timestamp>.<body>". */
export function verifySignature(rawBody, header, secret = process.env.PAYMONGO_WEBHOOK_SECRET) {
  if (!secret) throw err('The PayMongo webhook isn’t set up (PAYMONGO_WEBHOOK_SECRET).', 503);
  const parts = Object.fromEntries(
    String(header || '')
      .split(',')
      .map((p) => p.split('='))
      .filter((p) => p.length === 2)
      .map(([k, v]) => [k.trim(), v.trim()]),
  );
  const sigs = [parts.te, parts.li].filter(Boolean);
  if (!parts.t || !sigs.length) throw err('Bad signature', 400);
  const want = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest();
  const ok = sigs.some((s) => {
    const got = Buffer.from(s, 'hex');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  });
  if (!ok) throw err('Bad signature', 400);
}

const FAILED = ['payment.failed', 'subscription.past_due'];
const PAID = ['payment.paid'];

/** The workspace an event is about: named in the payment's metadata, or found by its PayMongo subscription or customer. */
async function workspaceOf(res) {
  const a = res?.attributes || {};
  if (a.metadata?.workspace_id) return String(a.metadata.workspace_id);
  const subs = [a.subscription_id, res?.type === 'subscription' ? res.id : null].filter(Boolean);
  const customers = [a.customer_id, a.customer?.id].filter(Boolean);
  for (const s of subs) {
    const r = (await qs('select id from workspaces where paymongo_subscription_id = $1', [s])).rows[0];
    if (r) return r.id;
  }
  for (const c of customers) {
    const r = (await qs('select id from workspaces where paymongo_customer_id = $1', [c])).rows[0];
    if (r) return r.id;
  }
  return null;
}

/**
 * Handles one verified event, once (PayMongo may send it again, so its id is recorded first). Returns what happened.
 * - payment failed: an active (or trialing) subscription becomes past due, with the grace period ending GRACE_DAYS from now.
 *   One that is already past due keeps its first grace end date (a failed retry doesn't extend it).
 * - payment paid: a past due subscription becomes active again and its grace period is cleared.
 */
export async function handleEvent(ev) {
  const id = ev?.data?.id,
    type = ev?.data?.attributes?.type;
  if (!id || !type) throw err('Bad event', 400);
  const fresh = (await qs('insert into billing_events (id, type) values ($1, $2) on conflict (id) do nothing returning id', [id, type]))
    .rows[0];
  if (!fresh) return { duplicate: true };
  const failed = FAILED.includes(type),
    paid = PAID.includes(type);
  if (!failed && !paid) return { ignored: type };
  let ws = null;
  try {
    ws = await workspaceOf(ev.data.attributes.data);
    if (ws && failed) {
      const end = new Date(Date.now() + GRACE_DAYS * 86400000);
      await qs(
        "update workspaces set subscription_status = 'past_due', grace_ends_at = $2 where id = $1 and subscription_status in ('active', 'trialing')",
        [ws, end],
      );
    } else if (ws && paid) {
      await qs(
        "update workspaces set subscription_status = 'active', grace_ends_at = null where id = $1 and subscription_status = 'past_due'",
        [ws],
      );
    }
  } catch (e) {
    await qs('delete from billing_events where id = $1', [id]); // let PayMongo's retry try again
    throw e;
  }
  if (ws) await qs('update billing_events set workspace_id = $2 where id = $1', [id, ws]);
  return { workspace: ws, type };
}

// Calling PayMongo's API (cancelling a subscription).
//   PAYMONGO_SECRET_KEY   sk_test_… / sk_live_… (server only)
//   PAYMONGO_API_BASE     only for tests against a local mock (default https://api.paymongo.com)
export const paymongoConfigured = () => Boolean(process.env.PAYMONGO_SECRET_KEY);
const base = () => (process.env.PAYMONGO_API_BASE || 'https://api.paymongo.com').replace(/\/$/, '');

/** Cancels a PayMongo subscription, so it is never charged again. Returns PayMongo's subscription. */
export async function cancelPayMongoSubscription(id, reason = 'unspecified') {
  if (!paymongoConfigured()) throw err('Payments aren’t set up on this server yet (PAYMONGO_SECRET_KEY).', 503);
  const res = await fetch(base() + '/v1/subscriptions/' + encodeURIComponent(id) + '/cancel', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(process.env.PAYMONGO_SECRET_KEY + ':').toString('base64'),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ data: { attributes: { cancellation_reason: reason } } }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw err('PayMongo: ' + (body?.errors?.[0]?.detail || res.statusText), res.status >= 500 || res.status === 401 ? 502 : 400);
  return body?.data || {};
}
