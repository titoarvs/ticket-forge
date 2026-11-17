// How this TicketForge runs: self-hosted (one company, set up by its owner at /setup, people join by invite) or as
// a SaaS (anyone signs up and gets their own workspace). Self-hosted is the default and keeps today's behaviour.
//   TICKETFORGE_MODE   selfhost | saas
//   SIGNUP_MODE        closed (invite only) | waitlist (people ask for access) | open (anyone can create an account)
//   PLATFORM_ADMIN_EMAILS  comma-separated emails of the people who run the service (SaaS)
//   PLATFORM_NAME, LEGAL_CONTACT_EMAIL  shown on the public pages and in emails
export const isSaas = () => String(process.env.TICKETFORGE_MODE || '').toLowerCase() === 'saas';
/**
 * Trying the hosted mode on your own computer: TICKETFORGE_ALLOW_LOCAL=1 lets a request opened at localhost use this
 * computer (folders, Claude Code agents, git) even though TICKETFORGE_MODE=saas. Never set it on a server: it is only
 * honoured for a request whose address is localhost and that came through no proxy (no X-Forwarded-* header).
 */
export const allowLocalInSaas = () => /^(1|true|yes)$/i.test(String(process.env.TICKETFORGE_ALLOW_LOCAL || ''));
/** Whether a request opened at `host` counts as "on this computer": always off in SaaS unless allowLocalInSaas() and no proxy. */
const LOOPBACK = /^(::1|127(\.\d{1,3}){3}|::ffff:127(\.\d{1,3}){3}|localhost)$/i;
export function requestIsLocal(isLocalHost: (h: any) => boolean, headers: { get(n: string): string | null }) {
  if (!isSaas()) return isLocalHost(headers.get('x-forwarded-host') || headers.get('host'));
  if (!allowLocalInSaas()) return false;
  // The caller must be this computer itself: every address on the way is loopback (Next adds the socket's address to
  // X-Forwarded-For, so a remote visitor who only sends "Host: localhost" or a forged header still shows up with theirs).
  const hops = [...String(headers.get('x-forwarded-for') || '').split(','), headers.get('x-real-ip') || ''].map((x) => x.trim()).filter(Boolean);
  if (hops.some((h) => !LOOPBACK.test(h))) return false;
  const host = headers.get('host');
  const fwd = headers.get('x-forwarded-host');
  if (fwd && fwd !== host) return false;
  return isLocalHost(host);
}
export function signupMode() {
  const m = String(process.env.SIGNUP_MODE || '').toLowerCase();
  if (['closed', 'waitlist', 'open'].includes(m)) return m;
  return isSaas() ? 'open' : 'closed';
}
export const platformAdminEmails = () => String(process.env.PLATFORM_ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
export const platformName = () => process.env.PLATFORM_NAME || 'TicketForge';
export const requireEmailVerification = () => /^(1|true|yes)$/i.test(String(process.env.REQUIRE_EMAIL_VERIFICATION || ''));

/**
 * On the hosted service, server-wide repository tokens would let every company read the operator's repositories
 * (they are fallbacks when a project has no token of its own). They are removed at start-up in SaaS mode, so each
 * workspace connects its own GitHub or GitLab account.
 */
export function scrubSharedTokens() {
  if (!isSaas()) return;
  for (const k of ['GITHUB_TOKEN', 'GH_TOKEN', 'GITLAB_TOKEN']) {
    if (process.env[k]) { delete process.env[k]; console.warn(`SaaS mode: ignoring ${k} (each workspace connects its own account).`); }
  }
}
