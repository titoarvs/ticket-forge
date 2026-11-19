// Payment gateways (SaaS billing): the owner turns on PayMongo, Xendit and Stripe in Administration
// → Billing, as many at once as wanted, and the customer picks one of the active ones at checkout.
// Keys are checked against the gateway before it is saved as active, and stored encrypted (never
// sent back to the browser). Talks to each gateway's REST API directly (no SDK); the *_API_BASE
// variables only exist so tests can point at a local mock.
//   PAYMONGO_API_BASE default https://api.paymongo.com XENDIT_API_BASE default
//   https://api.xendit.co STRIPE_API_BASE default https://api.stripe.com
import { asSystem } from './db';
import { orm, paymentGateways, eq, sql } from './orm';
import { encrypt } from './settings';
import { PROVIDERS, gatewayRow, secretFor } from './gateway-keys';
import { stripe } from './stripe';
import { supportedMethods } from './payment-methods';
import { err } from './errors';

/**
 * What each gateway is, the currencies it takes, and what a valid secret key looks like (a quick
 * check before asking the gateway).
 */
export const GATEWAYS = {
  paymongo: {
    name: 'PayMongo',
    currencies: ['PHP'],
    keyHint: 'sk_test_… or sk_live_…',
    keyPattern: /^sk_(test|live)_\S{8,}$/,
  },
  xendit: {
    name: 'Xendit',
    currencies: ['PHP'],
    keyHint: 'xnd_development_… or xnd_production_…',
    keyPattern: /^xnd_(development|production)_\S{8,}$/,
  },
  stripe: {
    name: 'Stripe',
    currencies: ['PHP', 'USD'],
    keyHint: 'sk_test_… or sk_live_…',
    keyPattern: /^[sr]k_(test|live)_\S{8,}$/,
  },
};
const provider = (p) => {
  if (!PROVIDERS.includes(p)) throw err('Unknown payment gateway.', 404);
  return p;
};
const base = (p) =>
  ({
    paymongo: process.env.PAYMONGO_API_BASE || 'https://api.paymongo.com',
    xendit: process.env.XENDIT_API_BASE || 'https://api.xendit.co',
  })[p].replace(/\/$/, '');
const basic = (key) => `Basic ${Buffer.from(`${key}:`).toString('base64')}`;

/**
 * One JSON call to PayMongo or Xendit. Throws a 400 with the gateway's own message, or a 502 when
 * it can't be reached.
 */
async function call(p, method, path, key, payload?) {
  let res;
  try {
    res = await fetch(`${base(p)}${path}`, {
      method,
      headers: {
        Authorization: basic(key),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw err(`Couldn’t reach ${GATEWAYS[p].name}. Try again.`, 502);
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = out?.errors?.[0]?.detail || out?.message || res.statusText;
    throw err(
      `${GATEWAYS[p].name}: ${msg}`,
      res.status >= 500 ? 502 : res.status === 401 || res.status === 403 ? 401 : 400,
    );
  }
  return out;
}

/**
 * Asks the gateway whether the key works (a read-only call). Throws a 400 "rejected" error when it
 * doesn't.
 */
async function verify(p, key) {
  const rejected = () =>
    err(`${GATEWAYS[p].name} rejected these credentials. Check the secret key and try again.`);
  try {
    if (p === 'stripe') await stripe('GET', 'balance', undefined, { key });
    else if (p === 'paymongo') await call(p, 'GET', '/v1/payments?limit=1', key);
    else await call(p, 'GET', '/balance', key);
  } catch (e) {
    if (e.status === 401 || /Invalid API Key|api key|authenticat|unauthori/i.test(e.message))
      throw rejected();
    throw e;
  }
}

const hint = (key) => (key ? `…${key.slice(-4)}` : '');

/**
 * Every gateway with whether it is active and has a key saved (never the key itself): [{ provider,
 * name, active, configured, keyHint, … }].
 */
export async function listGateways() {
  const saved: any[] = await asSystem(async () => await orm.select().from(paymentGateways));
  const rows = Object.fromEntries(saved.map((r) => [r.provider, r]));
  return PROVIDERS.map((p) => ({
    provider: p,
    name: GATEWAYS[p].name,
    currencies: GATEWAYS[p].currencies,
    keyFormat: GATEWAYS[p].keyHint,
    active: Boolean(rows[p]?.active),
    configured: Boolean(rows[p]?.credentials?.secretKey),
    keyEnd: rows[p]?.credentials?.hint || '',
    updatedAt: rows[p]?.updatedAt || null,
    updatedBy: rows[p]?.updatedBy || null,
  }));
}

/** The active gateways, optionally only those that take `currency`. */
export async function activeGateways(currency = null) {
  return (await listGateways()).filter(
    (g) => g.active && (!currency || g.currencies.includes(currency)),
  );
}

/**
 * Turns a gateway on or off. Turning it on needs a secret key (typed now, or saved before); the key
 * is checked with the gateway first, so a gateway with bad credentials is never saved as active.
 * Several gateways can be active at once.
 */
export async function saveGateway(p, { active, secretKey }: any = {}, actor) {
  provider(p);
  const typed = String(secretKey || '').trim();
  const row = await gatewayRow(p);
  if (!active) {
    if (!row) return (await listGateways()).find((g) => g.provider === p);
    await asSystem(async () => {
      await orm
        .update(paymentGateways)
        .set({ active: false, updatedBy: actor?.name || null, updatedAt: sql`now()` })
        .where(eq(paymentGateways.provider, p));
    });
    return (await listGateways()).find((g) => g.provider === p);
  }
  const key = typed || (row?.credentials?.secretKey ? await secretFor(p) : '');
  if (!key) throw err(`Enter the ${GATEWAYS[p].name} secret key (${GATEWAYS[p].keyHint}).`);
  if (!GATEWAYS[p].keyPattern.test(key))
    throw err(
      `That doesn’t look like a ${GATEWAYS[p].name} secret key. It should start like ${GATEWAYS[p].keyHint}.`,
    );
  await verify(p, key); // throws when the gateway rejects it: nothing is saved and the gateway stays as it was
  const credentials = typed ? { secretKey: encrypt(typed), hint: hint(typed) } : row.credentials;
  const by = actor?.name || null;
  await asSystem(async () => {
    await orm
      .insert(paymentGateways)
      .values({ provider: p, active: true, credentials, updatedBy: by, updatedAt: sql`now()` })
      .onConflictDoUpdate({
        target: paymentGateways.provider,
        set: { active: true, credentials, updatedBy: by, updatedAt: sql`now()` },
      });
  });
  return (await listGateways()).find((g) => g.provider === p);
}

// ---------------------------------------------------------------- checkout
const minor = (n) => Math.round(Number(n) * 100); // PHP and USD both have 2 decimals

/**
 * Opens a hosted checkout page at `p` for `plan` (a plan version from billing-plans.js) and returns
 * { url, ref }. The workspace, plan and version travel in the session's metadata, so the way back
 * can check what was paid for.
 */
export async function createCheckout(p, { ws, email, plan, successUrl, cancelUrl }: any) {
  provider(p);
  const key = await secretFor(p);
  if (!key) throw err(`${GATEWAYS[p].name} isn’t set up.`, 503);
  const meta = { workspace_id: ws, plan: plan.id, plan_version: String(plan.version) };
  const label = `${plan.name} plan (${plan.interval === 'year' ? 'yearly' : 'monthly'})`;
  if (p === 'stripe') {
    const s = await stripe(
      'POST',
      'checkout/sessions',
      {
        mode: 'subscription',
        client_reference_id: ws,
        customer_email: email || undefined,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: plan.currency.toLowerCase(),
              unit_amount: minor(plan.price),
              recurring: { interval: plan.interval },
              product_data: { name: label },
            },
          },
        ],
        subscription_data: { metadata: meta },
        metadata: meta,
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
      { key },
    );
    if (!s?.id || !s.url) throw err('Stripe didn’t return a checkout page. Try again.', 502);
    return { url: s.url, ref: s.id };
  }
  if (p === 'paymongo') {
    const s = (
      await call(p, 'POST', '/v1/checkout_sessions', key, {
        data: {
          attributes: {
            line_items: [
              { name: label, amount: minor(plan.price), currency: plan.currency, quantity: 1 },
            ],
            payment_method_types: supportedMethods().map((m) => m.id),
            description: `TicketForge ${plan.name} plan`,
            reference_number: ws,
            send_email_receipt: false,
            show_description: true,
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: meta,
          },
        },
      })
    ).data;
    const url = s?.attributes?.checkout_url;
    if (!s?.id || !url) throw err('PayMongo didn’t return a checkout page. Try again.', 502);
    return { url, ref: s.id };
  }
  const inv = await call(p, 'POST', '/v2/invoices', key, {
    external_id: `tf-${ws}-${Date.now()}`,
    amount: Number(plan.price),
    currency: plan.currency,
    description: label,
    payer_email: email || undefined,
    success_redirect_url: successUrl,
    failure_redirect_url: cancelUrl,
    metadata: meta,
  });
  if (!inv?.id || !inv.invoice_url)
    throw err('Xendit didn’t return a checkout page. Try again.', 502);
  return { url: inv.invoice_url, ref: inv.id };
}

/**
 * Reads a checkout back from the gateway: { paid, meta, subscriptionId, customerId }. A return is
 * never taken on trust: only what the gateway says counts.
 */
export async function readCheckout(p, ref) {
  provider(p);
  const key = await secretFor(p);
  if (!key) throw err(`${GATEWAYS[p].name} isn’t set up.`, 503);
  if (p === 'stripe') {
    const s = await stripe('GET', `checkout/sessions/${encodeURIComponent(ref)}`, undefined, {
      key,
    });
    return {
      paid: s.status === 'complete' && ['paid', 'no_payment_required'].includes(s.payment_status),
      meta: s.metadata || {},
      subscriptionId: s.subscription || null,
      customerId: s.customer || null,
    };
  }
  if (p === 'paymongo') {
    const s = (await call(p, 'GET', `/v1/checkout_sessions/${encodeURIComponent(ref)}`, key)).data;
    const paid =
      (s?.attributes?.payments || []).some((x) => x?.attributes?.status === 'paid') ||
      s?.attributes?.payment_intent?.attributes?.status === 'succeeded';
    return { paid, meta: s?.attributes?.metadata || {}, subscriptionId: null, customerId: null };
  }
  const inv = await call(p, 'GET', `/v2/invoices/${encodeURIComponent(ref)}`, key);
  return {
    paid: ['PAID', 'SETTLED'].includes(inv.status),
    meta: inv.metadata || {},
    subscriptionId: null,
    customerId: null,
  };
}
