// The secret key of a payment gateway: the one the owner saved in Administration → Billing (stored
// encrypted), or the environment variable the older setup used. Kept apart from gateways.js so
// stripe.js can read it without a loop.
import { asSystem } from './db';
import { orm, paymentGateways, eq } from './orm';
import { decrypt } from './settings';

export const PROVIDERS = ['paymongo', 'xendit', 'stripe'];
const ENV = {
  paymongo: 'PAYMONGO_SECRET_KEY',
  xendit: 'XENDIT_SECRET_KEY',
  stripe: 'STRIPE_SECRET_KEY',
};

/**
 * The saved row of a gateway: { provider, active, credentials, updatedBy, updatedAt } or undefined.
 */
export async function gatewayRow(provider): Promise<any> {
  return asSystem(
    async () =>
      (await orm.select().from(paymentGateways).where(eq(paymentGateways.provider, provider)))[0],
  );
}

/**
 * The gateway's secret key (decrypted), or '' when none is saved and the environment has none.
 * Server only.
 */
export async function secretFor(provider) {
  const saved = (await gatewayRow(provider))?.credentials?.secretKey;
  if (saved) {
    try {
      return decrypt(saved);
    } catch {
      /* saved with another key: fall back */
    }
  }
  return process.env[ENV[provider]] || '';
}
