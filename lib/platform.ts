// How this TicketForge runs: self-hosted (one company, set up by its owner at /setup, people join by invite) or as
// a SaaS (anyone signs up and gets their own workspace). Self-hosted is the default and keeps today's behaviour.
//   TICKETFORGE_MODE   selfhost | saas
//   SIGNUP_MODE        closed (invite only) | waitlist (people ask for access) | open (anyone can create an account)
//   PLATFORM_ADMIN_EMAILS  comma-separated emails of the people who run the service (SaaS)
//   PLATFORM_NAME, LEGAL_CONTACT_EMAIL  shown on the public pages and in emails
export const isSaas = () => String(process.env.TICKETFORGE_MODE || '').toLowerCase() === 'saas';
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
