import { ready } from '@/lib/server/http';
import { asSystem } from '@/lib/db';
import { verifySignature, handleEvent } from '@/lib/stripe';

// Stripe → TicketForge: subscription changes. Not a normal API route: Stripe signs the raw body,
// which must be read as-is (not parsed) to check the signature, and there's no signed-in user.
export async function POST(req: Request) {
  const raw = await req.text();
  try {
    verifySignature(raw, req.headers.get('stripe-signature'));
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: e.status || 400 });
  }
  let ev: any;
  try {
    ev = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Bad JSON' }, { status: 400 });
  }
  try {
    await ready();
    const r = await asSystem(() => handleEvent(ev));
    return Response.json({ received: true, ...r });
  } catch (e: any) {
    console.error('Stripe webhook failed:', e.message);
    return Response.json({ error: 'Webhook handling failed' }, { status: 500 }); // Stripe retries
  }
}
