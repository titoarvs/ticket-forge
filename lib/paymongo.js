// PayMongo REST calls the subscription service needs (PHP only): customer, plan, subscription and payment intent.
// A thin wrapper until the full gateway client (TF-91) replaces it; keep the function names so callers don't change.
//   PAYMONGO_SECRET_KEY   sk_test_… / sk_live_… (server only, never logged)
//   PAYMONGO_API_BASE     only for tests against a local mock (default https://api.paymongo.com)
const err = (message, status = 400) => Object.assign(new Error(message), { status });
export const paymongoConfigured = () => Boolean(process.env.PAYMONGO_SECRET_KEY);
const base = () => (process.env.PAYMONGO_API_BASE || 'https://api.paymongo.com').replace(/\/$/, '');

async function call(method, path, attributes) {
  if (!paymongoConfigured()) throw err('Payments aren’t set up on this server yet (PAYMONGO_SECRET_KEY).', 503);
  const res = await fetch(`${base()}/v1/${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: method === 'GET' ? undefined : JSON.stringify({ data: { attributes } }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw err(`PayMongo: ${body?.errors?.[0]?.detail || res.statusText}`, res.status >= 500 || res.status === 401 ? 502 : 400);
  return body.data;
}

/** Only PHP amounts (in centavos) are ever created. */
function php(currency) {
  if (currency !== 'PHP') throw err('Only PHP payments are supported.');
}

/** A PayMongo customer; returns its id. */
export async function createCustomer({ email, name, metadata }) {
  const c = await call('POST', 'customers', { email, first_name: name, last_name: 'Workspace', default_device: 'email', metadata });
  return c.id;
}
/** A recurring plan (`amount` in PHP pesos, `interval` month | year); returns its id. */
export async function createPlan({ name, amount, currency, interval }) {
  php(currency);
  const p = await call('POST', 'subscriptions/plans', { name, amount: Math.round(amount * 100), currency, interval: interval === 'year' ? 'yearly' : 'monthly', interval_count: 1 });
  return p.id;
}
/** A subscription of a customer to a plan; returns its id. `trialEndsAt` is when the first charge is due. */
export async function createSubscription({ customerId, planId, trialEndsAt, metadata }) {
  const s = await call('POST', 'subscriptions', { customer_id: customerId, plan_id: planId, trial_ends_at: trialEndsAt ? new Date(trialEndsAt).toISOString() : undefined, metadata });
  return s.id;
}
/** A payment intent for one recurring charge (`amount` in PHP pesos); returns { id, status }. */
export async function createPaymentIntent({ amount, currency, description, metadata }) {
  php(currency);
  const i = await call('POST', 'payment_intents', { amount: Math.round(amount * 100), currency, description, payment_method_allowed: ['card', 'gcash', 'paymaya'], metadata });
  return { id: i.id, status: i.attributes?.status };
}
