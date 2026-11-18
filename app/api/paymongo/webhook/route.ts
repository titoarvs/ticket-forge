import { ready } from '@/lib/server/http';
import { asSystem } from '@/lib/db';
import { verifySignature, handleEvent } from '@/lib/paymongo';

// PayMongo → TicketForge: failed and successful payments. Not a normal API route: PayMongo signs the raw body, which
// must be read as-is (not parsed) to check the signature, and there's no signed-in user. A bad signature is rejected
// with 400 before anything is read or changed.
export async function POST(req: Request) {
  const raw = await req.text();
  try {
    verifySignature(raw, req.headers.get('paymongo-signature'));
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
    if (e.status === 400) return Response.json({ error: e.message }, { status: 400 });
    console.error('PayMongo webhook failed:', e.message);
    return Response.json({ error: 'Webhook handling failed' }, { status: 500 }); // PayMongo retries
  }
}
