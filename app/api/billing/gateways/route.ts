import { api, platformOwner, body, HttpError } from '@/lib/server/http';
import { billingOn } from '@/lib/limits.js';
import { listGateways, saveGateway } from '@/lib/gateways.js';

function hosted() {
  if (!billingOn()) throw new HttpError(400, 'Payment gateways are only used on the hosted service.');
}

// Payment gateways (PayMongo, Xendit, Stripe) and whether each is active; several can be active at once. Never returns a key.
export const GET = api(async () => {
  await platformOwner();
  hosted();
  return { gateways: await listGateways() };
});

// Turns one gateway on (with its secret key, checked with the gateway first) or off.
export const PUT = api(async (req) => {
  const u = await platformOwner();
  hosted();
  const b = await body(req);
  return { gateway: await saveGateway(String(b.provider || ''), { active: b.active === true, secretKey: b.secretKey }, u), gateways: await listGateways() };
});
