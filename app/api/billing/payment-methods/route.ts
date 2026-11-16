import { api, authed, body, HttpError } from '@/lib/server/http';
import { billingOn } from '@/lib/limits.js';
import { supportedMethods, checkoutQuote, paymentStep } from '@/lib/payment-methods.js';

function ownerCheckout(u: any) {
  if (!u.is_owner) throw new HttpError(403, 'Only the workspace owner can change the plan.');
  if (!billingOn()) throw new HttpError(400, 'Plans are only used on the hosted service.');
}

// Checkout page data: the payment methods the gateway supports and the PHP total for the chosen plan.
export const GET = api(async (req) => {
  const u: any = await authed();
  ownerCheckout(u);
  const q = new URL(req.url).searchParams;
  return { ...checkoutQuote(q.get('plan'), q.get('interval')), methods: supportedMethods() };
});

// Continue: checks the chosen method and returns the address of its payment step.
export const POST = api(async (req) => {
  const u: any = await authed();
  ownerCheckout(u);
  const b = await body(req);
  return paymentStep({ plan: b.plan, interval: b.interval, method: b.method });
});
