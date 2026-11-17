// Subscription plans the owner manages (Administration → Billing): name, price, currency (PHP or USD), recurring
// cycle, free-plan option and trial days. A plan has versions: editing the price, currency, cycle, free option or trial
// days of a plan that has subscribers adds a new version. Workspaces keep the version they subscribed to
// (workspaces.plan_version); new subscriptions use the latest version. Other edits (name, text, limits) change the latest
// version in place. The default plans in plans.js are copied in the first time the plans are read.
import { qs } from './db';
import { PLANS, PLAN_ORDER, TRIAL_DAYS, CURRENCY, validatePlan, publicPlan } from './plans';

const err = (message, status = 400) => Object.assign(new Error(message), { status });

export const CURRENCIES = ['PHP', 'USD'];
export const INTERVALS = ['month', 'year'];
/** Subscription states that count as an active subscriber (the same ones limits.js keeps the plan for). */
const SUBSCRIBED = ['active', 'trialing', 'past_due'];

const row = (r) => r && ({
  id: r.id, version: r.version, name: r.name, blurb: r.blurb, price: Number(r.price), currency: r.currency, interval: r.interval,
  isFree: r.is_free, trialDays: r.trial_days, limits: r.limits || {}, features: r.features || [], position: r.position, archived: r.archived,
});
/** A plan as the API returns it: its details plus its limits as a list with units (see publicPlan in plans.js). */
const out = (p, extra: any = {}) => ({ ...publicPlan(p), ...extra });

/** Copies the default plans in when there are none yet (once; safe to call often and from several places). */
let seeded = false;
async function ensureSeeded() {
  if (seeded) return;
  if ((await qs('select 1 from billing_plans limit 1')).rows[0]) { seeded = true; return; }
  const cur = CURRENCIES.includes(CURRENCY) ? CURRENCY : 'USD';
  for (const [i, id] of PLAN_ORDER.entries()) {
    const p = PLANS[id];
    await qs(`insert into billing_plans (id, version, name, blurb, price, currency, interval, is_free, trial_days, limits, features, position, archived)
      values ($1, 1, $2, $3, $4, $5, 'month', $6, $7, $8, $9, $10, $11) on conflict (id, version) do nothing`,
    [id, p.name, p.blurb, p.price.month, cur, id === 'free', id === 'free' ? 0 : TRIAL_DAYS, JSON.stringify(p.limits), JSON.stringify(p.features), i, Boolean(p.archived)]);
  }
}

/** How many workspaces are subscribed to each plan, by version: { [id]: { [version]: n } }. A free plan counts everyone on it. */
async function subscriberCounts() {
  const r = (await qs(`select plan, coalesce(plan_version, 1) as version, count(*)::int as n from workspaces
    where plan = 'free' or coalesce(subscription_status, '') in (${SUBSCRIBED.map((s) => `'${s}'`).join(', ')})
    group by plan, coalesce(plan_version, 1)`)).rows;
  const by: any = {};
  for (const x of r) (by[x.plan] ??= {})[x.version] = x.n;
  return by;
}
const total = (by, id) => Object.values<any>(by[id] || {}).reduce((a: any, b) => a + b, 0);

/**
 * The latest version of every plan, in order: [{ …plan, subscribers, versions }]. With `forPurchase`, archived plans are
 * left out (workspaces already on one keep it).
 */
export async function listBillingPlans({ forPurchase = false }: any = {}) {
  await ensureSeeded();
  const rows = (await qs('select * from billing_plans order by position, id, version')).rows.map(row);
  const by = await subscriberCounts();
  const latest: Map<any, any> = new Map();
  for (const p of rows) latest.set(p.id, p); // rows are ordered by version, so the last one wins
  return [...latest.values()]
    .filter((p) => !(forPurchase && p.archived))
    .map((p) => out(p, { subscribers: total(by, p.id), versions: rows.filter((x) => x.id === p.id).length }));
}

/** One plan version (the latest when `version` is empty), or null. Workspaces on a plan read their own version. */
export async function getPlanVersion(id, version = null) {
  await ensureSeeded();
  const r = version
    ? await qs('select * from billing_plans where id = $1 and version = $2', [id, Number(version)])
    : await qs('select * from billing_plans where id = $1 order by version desc limit 1', [id]);
  return row(r.rows[0]) || null;
}

/** Checks what the owner typed and returns clean values. `base` holds the current values when editing. Throws 400 on the first problem. */
function clean(input, base: any = {}) {
  const v = { ...base };
  if ('name' in input) {
    v.name = String(input.name ?? '').trim();
    if (!v.name || v.name.length > 60) throw err('Give the plan a name (up to 60 characters).');
  }
  if ('blurb' in input) v.blurb = String(input.blurb ?? '').trim().slice(0, 200);
  if ('isFree' in input) v.isFree = Boolean(input.isFree);
  if ('currency' in input) {
    v.currency = String(input.currency ?? '').toUpperCase();
    if (!CURRENCIES.includes(v.currency)) throw err(`Currency must be ${CURRENCIES.join(' or ')}.`);
  }
  if ('interval' in input) {
    v.interval = String(input.interval ?? '');
    if (!INTERVALS.includes(v.interval)) throw err('The billing cycle must be monthly or yearly.');
  }
  if ('price' in input) {
    v.price = Number(input.price);
    if (!Number.isFinite(v.price) || v.price < 0 || v.price > 10000000) throw err('The price must be a number of 0 or more.');
  }
  if ('trialDays' in input) {
    v.trialDays = Number(input.trialDays ?? 0);
    if (!Number.isInteger(v.trialDays) || v.trialDays < 0 || v.trialDays > 365) throw err('Trial days must be a whole number from 0 to 365.');
  }
  if ('archived' in input) v.archived = Boolean(input.archived);
  if ('features' in input) {
    if (!Array.isArray(input.features)) throw err('Features must be a list.');
    v.features = input.features.map((f) => String(f).trim()).filter(Boolean).slice(0, 12);
  }
  if ('limits' in input) {
    try { validatePlan({ id: 'x', name: 'x', limits: input.limits }); } catch (e) { throw err(e.message.replace(/^Plan x: /, '')); }
    v.limits = input.limits;
  }
  if (v.isFree) { v.price = 0; v.trialDays = 0; }
  else if (!(v.price > 0)) throw err('A paid plan needs a price above 0. Tick “Free plan” for a free one.');
  return v;
}

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'plan';

/** Creates a plan (version 1). Returns it. */
export async function createPlan(input, actor) {
  await ensureSeeded();
  const v = clean({ name: '', blurb: '', isFree: false, price: 0, currency: 'USD', interval: 'month', trialDays: 0, features: [], ...input }, {});
  v.limits ??= (v.isFree ? PLANS.free : PLANS.pro).limits; // the owner can edit limits later; start from the default tier
  let id = slug(v.name), n = 1;
  while ((await qs('select 1 from billing_plans where id = $1 limit 1', [id])).rows[0]) id = `${slug(v.name).slice(0, 26)}-${++n}`;
  const pos = (await qs('select coalesce(max(position), -1) + 1 as n from billing_plans')).rows[0].n;
  await qs(`insert into billing_plans (id, version, name, blurb, price, currency, interval, is_free, trial_days, limits, features, position, archived, created_by)
    values ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12)`,
  [id, v.name, v.blurb, v.price, v.currency, v.interval, v.isFree, v.trialDays, JSON.stringify(v.limits), JSON.stringify(v.features), pos, actor?.name || null]);
  return out(await getPlanVersion(id), { subscribers: 0, versions: 1 });
}

/** The terms a subscriber agreed to: changing any of them while there are subscribers makes a new version. */
const TERMS = ['price', 'currency', 'interval', 'isFree', 'trialDays'];

/**
 * Edits a plan. When the plan has subscribers and a price, currency, cycle, free option or trial days changes, a new
 * version is added: subscribers stay on their version and new subscriptions use the new one. Otherwise the latest version
 * is changed in place. Returns { plan, newVersion }.
 */
export async function updatePlan(id, input, actor) {
  const cur = await getPlanVersion(String(id));
  if (!cur) throw err('Plan not found.', 404);
  const next = clean(input || {}, cur);
  const termsChanged = TERMS.some((k) => next[k] !== cur[k]);
  const by = await subscriberCounts();
  const subscribers: any = total(by, cur.id);
  const args = [cur.id, next.name, next.blurb, next.price, next.currency, next.interval, next.isFree, next.trialDays, JSON.stringify(next.limits), JSON.stringify(next.features), next.archived];
  let version = cur.version;
  if (termsChanged && subscribers > 0) {
    version = cur.version + 1;
    await qs(`insert into billing_plans (id, version, name, blurb, price, currency, interval, is_free, trial_days, limits, features, archived, position, created_by)
      values ($1, $12, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $13, $14)`, [...args, version, cur.position, actor?.name || null]);
  } else {
    await qs(`update billing_plans set name = $2, blurb = $3, price = $4, currency = $5, interval = $6, is_free = $7, trial_days = $8,
      limits = $9, features = $10, archived = $11 where id = $1 and version = $12`, [...args, cur.version]);
  }
  const versions = (await qs('select count(*)::int n from billing_plans where id = $1', [cur.id])).rows[0].n;
  return { newVersion: version !== cur.version, plan: out(await getPlanVersion(cur.id, version), { subscribers: total(by, cur.id), versions }) };
}
