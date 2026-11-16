// Plans and limits (SaaS). Each workspace has a plan (lib/plans.js); this works out the plan in force and stops
// things that would go over its limits with a 402 the app turns into an "Upgrade" prompt.
//   Counted things (checked when added): projects, members (people + pending invites), storage (files + screenshots).
//   Monthly things (counted as used): platform AI calls (only AI paid by the service: a workspace's own API keys and
//   people's own Claude subscriptions don't count), AI code jobs.
// Self-hosted, and the service's own default workspace, have no limits.
import { qs, currentWs, DEFAULT_WS } from './db.js';
import { isSaas } from './platform.js';
import { PLANS, LIMIT_DEFS } from './plans.js';

const LABEL = {
  projects: 'projects', members: 'members', aiCalls: 'AI actions this month', codeJobs: 'AI code jobs this month', storageMb: 'MB of storage',
};
const UNLIMITED = { projects: null, members: null, aiCalls: null, codeJobs: null, storageMb: null };
export const billingOn = () => isSaas();
const period = (d = new Date()) => d.toISOString().slice(0, 7); // YYYY-MM (UTC)

/** Subscription states that keep the paid plan: paying, in a Stripe trial, or a failed payment Stripe is still retrying. */
const KEEPS_PLAN = ['active', 'trialing', 'past_due'];

/**
 * A cancelled subscription keeps its paid plan until the period it paid for ends (`cancel_at_period_end` with a
 * `current_period_end`, or the trial end when no period was set); after that the workspace is on Free.
 */
export function cancelledAndEnded(w, now = new Date()) {
  if (!w?.cancel_at_period_end) return false;
  const end = w.current_period_end || w.trial_ends_at;
  return !end || new Date(end) <= now;
}

/** The plan in force for a workspace: { id, name, limits, source: 'subscription' | 'trial' | 'free' | 'unlimited', … }. */
export async function effectivePlan(ws = currentWs()) {
  if (!billingOn() || !ws || ws === DEFAULT_WS) return { id: 'unlimited', name: 'Unlimited', limits: UNLIMITED, source: 'unlimited' };
  const w = (await qs('select plan, subscription_status, trial_ends_at, current_period_end, cancel_at_period_end from workspaces where id = $1', [ws])).rows[0];
  if (!w) return { id: 'free', name: PLANS.free.name, limits: PLANS.free.limits, source: 'free' };
  if (w.plan && PLANS[w.plan] && w.plan !== 'free' && KEEPS_PLAN.includes(w.subscription_status) && !cancelledAndEnded(w)) {
    return { id: w.plan, name: PLANS[w.plan].name, limits: PLANS[w.plan].limits, source: 'subscription', status: w.subscription_status, pastDue: w.subscription_status === 'past_due' };
  }
  if (w.trial_ends_at && new Date(w.trial_ends_at) > new Date()) {
    return { id: 'pro', name: `${PLANS.pro.name} trial`, limits: PLANS.pro.limits, source: 'trial', trialEndsAt: w.trial_ends_at };
  }
  return { id: 'free', name: PLANS.free.name, limits: PLANS.free.limits, source: 'free' };
}

/** The plan limits the app shows: [key, name, unit]. */
const SHOWN = Object.entries(LIMIT_DEFS).map(([key, d]) => [key, d.name, d.unit]);
/**
 * Every plan limit with its name and current value, what's used and what's left: [{ key, name, unit, used, limit,
 * remaining, reached, note }]. `limit` and `remaining` are null when unlimited. Members count pending invites, like
 * checkLimit does. A limit is reached when nothing more of it can be used (used >= limit).
 */
export function limitRows(plan, u) {
  return SHOWN.map(([key, name, unit]) => {
    const used = (key === 'members' ? u.members + u.pendingInvites : u[key]) || 0;
    const limit = plan.limits[key] ?? null;
    const note = key === 'members' && u.pendingInvites ? `Includes ${u.pendingInvites} pending invite${u.pendingInvites === 1 ? '' : 's'}.`
      : key === 'aiCalls' && limit != null ? 'Only AI paid by the service counts. Your own API keys and people’s own Claude subscriptions don’t.'
        : limit === 0 ? 'Not included in this plan.' : '';
    return { key, name, unit, used, limit, remaining: limit == null ? null : Math.max(0, Math.round((limit - used) * 10) / 10), reached: limit != null && used >= limit, note };
  });
}

/** The 402 the app shows as an upgrade prompt. */
function limitError(metric, limit, plan) {
  const what = LABEL[metric] || metric;
  const msg = limit === 0
    ? `Your ${plan.name} plan doesn’t include ${what.replace(/ this month$/, '')}. Upgrade to use it.`
    : `Your ${plan.name} plan allows ${limit.toLocaleString()} ${what}. Upgrade for more.`;
  return Object.assign(new Error(msg), { status: 402, extra: { code: 'limit', metric, limit, plan: plan.id } });
}

/** What the workspace uses now (for the Billing page and the counted limits). */
export async function usage(ws = currentWs()) {
  const p = period();
  const [proj, mem, inv, files, shots, ctr] = await Promise.all([
    qs('select count(*)::int n from projects where workspace_id = $1', [ws]),
    qs("select count(*)::int n from workspace_members where workspace_id = $1 and status = 'active'", [ws]),
    qs('select count(*)::int n from invites where workspace_id = $1 and accepted_at is null and revoked_at is null and expires_at > now()', [ws]),
    qs('select coalesce(sum(f.bytes), 0)::bigint b from files f join projects p on p.id = f.project_id where p.workspace_id = $1', [ws]),
    qs('select coalesce(sum(s.bytes), 0)::bigint b from screenshots s join projects p on p.id = s.project_id where p.workspace_id = $1', [ws]),
    qs('select metric, n from usage_counters where workspace_id = $1 and period = $2', [ws, p]),
  ]);
  const monthly = Object.fromEntries(ctr.rows.map((r) => [r.metric, r.n]));
  return {
    projects: proj.rows[0].n, members: mem.rows[0].n, pendingInvites: inv.rows[0].n,
    storageMb: Math.round((Number(files.rows[0].b) + Number(shots.rows[0].b)) / 1048576 * 10) / 10,
    aiCalls: monthly.aiCalls || 0, codeJobs: monthly.codeJobs || 0, period: p,
  };
}

/**
 * Before adding something counted: projects (adding = 1), members (people + pending invites + adding), storage
 * (adding = bytes). Throws the upgrade 402 when it would go over the plan.
 */
export async function checkLimit(metric, adding = 1, ws = currentWs()) {
  const plan = await effectivePlan(ws);
  const limit = plan.limits[metric];
  if (limit == null) return;
  const u = await usage(ws);
  const now = metric === 'members' ? u.members + u.pendingInvites : metric === 'storageMb' ? u.storageMb : u[metric];
  const add = metric === 'storageMb' ? adding / 1048576 : adding;
  if (now + add > limit) throw limitError(metric, limit, plan);
}

/**
 * Uses one of a monthly allowance (aiCalls, codeJobs), atomically: two requests at once can't both take the last one.
 * Returns a function that gives it back (for a call that then failed), or a no-op when there's no limit.
 */
export async function consume(metric, ws = currentWs()) {
  const plan = await effectivePlan(ws);
  const limit = plan.limits[metric];
  if (limit == null) return () => {};
  if (limit <= 0) throw limitError(metric, limit, plan);
  const p = period();
  const r = await qs(`insert into usage_counters (workspace_id, metric, period, n) values ($1, $2, $3, 1)
    on conflict (workspace_id, metric, period) do update set n = usage_counters.n + 1 where usage_counters.n < $4 returning n`, [ws, metric, p, limit]);
  if (!r.rows[0]) throw limitError(metric, limit, plan);
  let given = false;
  return () => {
    if (given) return;
    given = true;
    qs('update usage_counters set n = greatest(n - 1, 0) where workspace_id = $1 and metric = $2 and period = $3', [ws, metric, p]).catch(() => {});
  };
}
