// The secret key of a payment gateway: the one the owner saved in Administration → Billing (stored encrypted), or the
// environment variable the older setup used. Kept apart from gateways.js so stripe.js can read it without a loop.
import { qs } from './db';
import { decrypt } from './settings';

export const PROVIDERS = ['paymongo', 'xendit', 'stripe'];
const ENV = { paymongo: 'PAYMONGO_SECRET_KEY', xendit: 'XENDIT_SECRET_KEY', stripe: 'STRIPE_SECRET_KEY' };

/** The saved row of a gateway: { provider, active, credentials, updated_by, updated_at } or undefined. */
export async function gatewayRow(provider) {
  return (await qs('select * from payment_gateways where provider = $1', [provider])).rows[0];
}

/** The gateway's secret key (decrypted), or '' when none is saved and the environment has none. Server only. */
export async function secretFor(provider) {
  const saved = (await gatewayRow(provider))?.credentials?.secretKey;
  if (saved) { try { return decrypt(saved); } catch { /* saved with another key: fall back */ } }
  return process.env[ENV[provider]] || '';
}
