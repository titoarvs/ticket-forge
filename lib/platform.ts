// How this TicketForge runs: self-hosted (one company, set up by its owner at /setup, people join by invite) or as
// a SaaS (anyone signs up and gets their own workspace). Self-hosted is the default and keeps today's behaviour.
//   TICKETFORGE_MODE   selfhost | saas
//   SIGNUP_MODE        closed (invite only) | waitlist (people ask for access) | open (anyone can create an account)
//   PLATFORM_ADMIN_EMAILS  comma-separated emails of the people who run the service (SaaS)
//   PLATFORM_NAME, LEGAL_CONTACT_EMAIL  shown on the public pages and in emails
export const isSaas = () => String(process.env.TICKETFORGE_MODE || '').toLowerCase() === 'saas';
/**
 * TICKETFORGE_ALLOW_LOCAL=1 lets a request opened at localhost use this computer (folders, Claude
 * Code agents, git) where that is otherwise off: in the hosted mode (TICKETFORGE_MODE=saas), to try
 * it on your own computer, and behind a reverse proxy (TRUST_PROXY). Never set it on a server.
 */
export const allowLocal = () =>
  /^(1|true|yes)$/i.test(String(process.env.TICKETFORGE_ALLOW_LOCAL || ''));
/**
 * How many reverse proxies stand in front of TicketForge (TRUST_PROXY): 0 when it is empty or off,
 * 1 for any other value that isn't a number. Only then does X-Forwarded-For say who the visitor is.
 */
export function trustedProxyHops() {
  const v = String(process.env.TRUST_PROXY || '')
    .trim()
    .toLowerCase();
  if (/^\d+$/.test(v)) return Number(v);
  return ['', 'false', 'no', 'off'].includes(v) ? 0 : 1;
}
/**
 * Whether a request counts as "on this computer". Headers can't show that (the sender writes them),
 * so the connection itself (`peer`, see lib/peer.ts) must come from this computer. Headers can only
 * take it away: a proxy or tunnel here connects from this computer too, so any address or host it
 * passed on must be this computer as well. Off in SaaS and behind a declared proxy, unless
 * allowLocal().
 */
const LOOPBACK = /^(::1|(::ffff:)?127(\.\d{1,3}){3})$/i;
export function requestIsLocal(
  isLocalHost: (h: any) => boolean,
  headers: { get(n: string): string | null },
  peer: string | null,
) {
  if ((isSaas() || trustedProxyHops()) && !allowLocal()) return false;
  if (!peer || !LOOPBACK.test(peer)) return false;
  if (headers.get('forwarded')) return false;
  const each = (name: string) =>
    String(headers.get(name) || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const hops = [...each('x-forwarded-for'), ...each('x-real-ip')];
  if (!hops.every((h) => LOOPBACK.test(h))) return false;
  return isLocalHost(headers.get('host')) && each('x-forwarded-host').every(isLocalHost);
}
export function signupMode() {
  const m = String(process.env.SIGNUP_MODE || '').toLowerCase();
  if (['closed', 'waitlist', 'open'].includes(m)) return m;
  return isSaas() ? 'open' : 'closed';
}
export const platformAdminEmails = () =>
  String(process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
export const platformName = () => process.env.PLATFORM_NAME || 'TicketForge';
export const requireEmailVerification = () =>
  /^(1|true|yes)$/i.test(String(process.env.REQUIRE_EMAIL_VERIFICATION || ''));

/**
 * On the hosted service, server-wide repository tokens would let every company read the operator's
 * repositories (they are fallbacks when a project has no token of its own). They are removed at
 * start-up in SaaS mode, so each workspace connects its own GitHub or GitLab account.
 */
export function scrubSharedTokens() {
  if (!isSaas()) return;
  for (const k of ['GITHUB_TOKEN', 'GH_TOKEN', 'GITLAB_TOKEN']) {
    if (process.env[k]) {
      delete process.env[k];
      console.warn(`SaaS mode: ignoring ${k} (each workspace connects its own account).`);
    }
  }
}
