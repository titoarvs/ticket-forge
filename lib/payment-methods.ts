// Subscription checkout: the payment methods a customer can choose (card, GCash, Maya) and the
// amount to pay, in PHP.
// A method the gateway doesn't support is left out, so it is never offered.
//   PAYMONGO_PAYMENT_METHODS comma list of the methods the gateway account supports (default:
//   card,gcash,paymaya)
import { PLANS, purchasable } from './plans';
import { err } from './errors';

export const CHECKOUT_CURRENCY = 'PHP';
/** `id` is PayMongo's name for the method. */
export const PAYMENT_METHODS = [
  { id: 'card', label: 'Card', hint: 'Visa or Mastercard' },
  { id: 'gcash', label: 'GCash', hint: 'Pay in the GCash app' },
  { id: 'paymaya', label: 'Maya', hint: 'Pay in the Maya app' },
];
/**
 * Prices in PHP per paid plan (placeholder numbers, like the plans in plans.js: change them here).
 */
const PHP_PRICES = {
  pro: { month: 999, year: 9990 },
  team: { month: 2499, year: 24990 },
};

/** The methods the gateway supports, in display order. */
export function supportedMethods() {
  const raw = process.env.PAYMONGO_PAYMENT_METHODS;
  if (!raw || !raw.trim()) return PAYMENT_METHODS;
  const on = new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return PAYMENT_METHODS.filter((m) => on.has(m.id));
}

/** What the customer is about to pay: the plan, billing period and the PHP total. */
export function checkoutQuote(plan, interval) {
  const id = String(plan || '');
  if (!PLANS[id] || id === 'free' || !PHP_PRICES[id] || !purchasable(id))
    throw err('Choose a paid plan.');
  const per = interval === 'year' ? 'year' : 'month';
  return {
    plan: { id, name: PLANS[id].name },
    interval: per,
    currency: CHECKOUT_CURRENCY,
    amount: PHP_PRICES[id][per],
  };
}

/** Checks the chosen method and returns the page of its payment step. */
export function paymentStep({ plan, interval, method }: any) {
  const q = checkoutQuote(plan, interval);
  if (!method) throw err('Choose a payment method.');
  const m = supportedMethods().find((x) => x.id === String(method));
  if (!m) throw err('That payment method isn’t available.');
  return { method: m.id, url: `/checkout/${m.id}?plan=${q.plan.id}&interval=${q.interval}` };
}
