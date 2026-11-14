import { api, authed, HttpError, appUrl } from '@/lib/server/http';
import { portalUrl } from '@/lib/stripe.js';

// Manage billing: returns the Stripe Customer Portal address (card, plan changes, invoices, cancel).
export const POST = api(async (req) => {
  const u: any = await authed();
  if (!u.is_owner) throw new HttpError(403, 'Only the workspace owner can manage billing.');
  return { url: await portalUrl({ ws: u.workspace_id, appUrl: appUrl(req) }) };
});
