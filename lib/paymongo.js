// PayMongo (PHP payments): the one call the app makes to cancel a subscription. Talks to PayMongo's REST API directly
// (no SDK), with the secret key as the Basic-auth user name.
//   PAYMONGO_SECRET_KEY   sk_test_… / sk_live_… (server only)
//   PAYMONGO_API_BASE     only for tests against a local mock (default https://api.paymongo.com)
const err = (message, status = 400) => Object.assign(new Error(message), { status });
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
