// Plans and their limits (placeholder numbers: change them here). `null` = unlimited. Stripe price ids come from
// the environment so test and live mode use different prices. AI calls made with a workspace's own API keys, or
// with a member's own Claude subscription (My AI), don't count toward `aiCalls`: only the platform's AI does.
export const PLANS = {
  free: { id: 'free', name: 'Free', blurb: 'Try TicketForge with a small team.', price: { month: 0, year: 0 },
    limits: { projects: 2, members: 3, aiCalls: 100, codeJobs: 0, storageMb: 200 },
    features: ['2 projects, 3 members', '100 AI actions a month', 'Backlog, board, timeline, test cases', 'Bring your own AI keys or Claude subscription'] },
  pro: { id: 'pro', name: 'Pro', blurb: 'For teams shipping every week.', price: { month: 19, year: 190 },
    limits: { projects: 25, members: 10, aiCalls: 2000, codeJobs: 50, storageMb: 5000 },
    features: ['25 projects, 10 members', '2,000 AI actions a month', '50 AI code jobs a month', 'Test automation and GitHub Actions', 'Problem Statements, Feature Briefs, Architecture Records'] },
  team: { id: 'team', name: 'Team', blurb: 'For larger teams and many projects.', price: { month: 49, year: 490 },
    limits: { projects: null, members: 50, aiCalls: 10000, codeJobs: 300, storageMb: 50000 },
    features: ['Unlimited projects, 50 members', '10,000 AI actions a month', '300 AI code jobs a month', 'Review panels and CodeRabbit', 'Priority support'] },
};
export const PLAN_ORDER = ['free', 'pro', 'team'];
export const TRIAL_DAYS = 14;
export const CURRENCY = process.env.PLAN_CURRENCY || 'USD';
/** Stripe price id for a plan and interval (month | year), from STRIPE_PRICE_PRO_MONTH etc. */
export const priceIdFor = (plan, interval = 'month') => process.env[`STRIPE_PRICE_${String(plan).toUpperCase()}_${interval === 'year' ? 'YEAR' : 'MONTH'}`] || '';
/** The plan a Stripe price id belongs to. */
export function planForPrice(priceId) {
  for (const p of PLAN_ORDER) for (const i of ['month', 'year']) if (priceId && priceIdFor(p, i) === priceId) return p;
  return null;
}
