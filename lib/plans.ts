// Plans and their limits (placeholder numbers: change them here). `null` = unlimited. Stripe price ids come from
// the environment so test and live mode use different prices. AI calls made with a workspace's own API keys, or
// with a member's own Claude subscription (My AI), don't count toward `aiCalls`: only the platform's AI does.
// A plan with `archived: true` stays in force for workspaces already on it, but is no longer offered for new purchases.
export const PLANS = {
  free: { id: 'free', name: 'Free', blurb: 'Try TicketForge with a small team.', price: { month: 0, year: 0 }, archived: false,
    limits: { projects: 2, members: 3, aiCalls: 100, codeJobs: 0, storageMb: 200 },
    features: ['2 projects, 3 members', '100 AI actions a month', 'Backlog, board, timeline, test cases', 'Bring your own AI keys or Claude subscription'] },
  pro: { id: 'pro', name: 'Pro', blurb: 'For teams shipping every week.', price: { month: 19, year: 190 }, archived: false,
    limits: { projects: 25, members: 10, aiCalls: 2000, codeJobs: 50, storageMb: 5000 },
    features: ['25 projects, 10 members', '2,000 AI actions a month', '50 AI code jobs a month', 'Test automation and GitHub Actions', 'Problem Statements, Feature Briefs, Architecture Records'] },
  team: { id: 'team', name: 'Team', blurb: 'For larger teams and many projects.', price: { month: 49, year: 490 }, archived: false,
    limits: { projects: null, members: 50, aiCalls: 10000, codeJobs: 300, storageMb: 50000 },
    features: ['Unlimited projects, 50 members', '10,000 AI actions a month', '300 AI code jobs a month', 'Review panels and CodeRabbit', 'Priority support'] },
};
export const PLAN_ORDER = ['free', 'pro', 'team'];
export const TRIAL_DAYS = 14;
// Days of paid access after a failed payment, before the workspace goes back to Free (length not decided: placeholder).
export const GRACE_DAYS = Math.max(1, Number(process.env.PAYMENT_GRACE_DAYS) || 7);
export const CURRENCY = process.env.PLAN_CURRENCY || 'USD';

/** Every limit a plan can have: its name and the unit its value is in. The key is the one in a plan's `limits`. */
export const LIMIT_DEFS = {
  projects: { name: 'Projects', unit: 'count' },
  members: { name: 'Members', unit: 'count' },
  aiCalls: { name: 'AI actions this month', unit: 'count' },
  codeJobs: { name: 'AI code jobs this month', unit: 'count' },
  storageMb: { name: 'Storage', unit: 'mb' },
};
export const LIMIT_UNITS = ['count', 'mb'];

/**
 * A plan's limits as a list: [{ key, name, value, unit }]. `value` is a number, or null when the plan has no limit on
 * it. Every limit has a unit, so a value is never shown (or saved) without one.
 */
export function limitList(plan) {
  return Object.entries<any>(LIMIT_DEFS).map(([key, d]) => ({ key, name: d.name, value: plan.limits?.[key] ?? null, unit: d.unit }));
}

/** Checks plan data before it is saved: every limit is known, has a numeric value (null = unlimited) and a unit. Throws on the first problem. */
export function validatePlan(plan) {
  const bad = (m) => { throw new Error(`Plan ${plan?.id || '?'}: ${m}`); };
  if (!plan || !plan.id || !plan.name) bad('needs an id and a name.');
  for (const [key, value] of Object.entries<any>(plan.limits || {})) {
    const d = LIMIT_DEFS[key];
    if (!d) bad(`unknown limit "${key}".`);
    if (!LIMIT_UNITS.includes(d.unit)) bad(`limit "${key}" needs a unit (${LIMIT_UNITS.join(', ')}).`);
    if (value !== null && !(typeof value === 'number' && Number.isFinite(value) && value >= 0)) bad(`limit "${key}" must be a number of ${d.unit} (0 or more), or null for no limit.`);
  }
  return plan;
}
Object.values<any>(PLANS).forEach(validatePlan);

/** A plan as the API returns it: its details plus its limits as a list with units. */
export const publicPlan = (plan) => ({ ...plan, limitList: limitList(plan) });
/**
 * The plans in order. With `forPurchase`, archived plans are left out: they can't be bought any more, though
 * workspaces already on one keep it (limits.js still reads them from PLANS).
 */
export function listPlans({ forPurchase = false }: any = {}) {
  return PLAN_ORDER.map((id) => PLANS[id]).filter((p) => !(forPurchase && p.archived)).map(publicPlan);
}
/** Whether a plan can be chosen for a new purchase: it exists, is paid and isn't archived. */
export const purchasable = (id) => Boolean(PLANS[id] && id !== 'free' && !PLANS[id].archived);

/** Stripe price id for a plan and interval (month | year), from STRIPE_PRICE_PRO_MONTH etc. */
export const priceIdFor = (plan, interval = 'month') => process.env[`STRIPE_PRICE_${String(plan).toUpperCase()}_${interval === 'year' ? 'YEAR' : 'MONTH'}`] || '';
/** The plan a Stripe price id belongs to. */
export function planForPrice(priceId) {
  for (const p of PLAN_ORDER) for (const i of ['month', 'year']) if (priceId && priceIdFor(p, i) === priceId) return p;
  return null;
}
