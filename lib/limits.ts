// Plans and limits (SaaS). Each workspace has a plan (lib/plans.ts); this works out the plan in force and stops
// things that would go over its limits with a 402 the app turns into an "Upgrade" prompt.
//   Counted things (checked when added): projects, members (people + pending invites), storage (files + screenshots).
//   Monthly things (counted as used): platform AI calls (only AI paid by the service: a workspace's own API keys and
//   people's own Claude subscriptions don't count), AI code jobs, database schema reads.
//   Per project (checked when added): database connections.
// Self-hosted, and the service's own default workspace, have no limits.
// Every feature is open to every plan (TF-101): only a positive number is a limit that stops anything. A plan value of
// 0 used to mean "not included in this plan"; it is no longer a gate, so the feature works on every plan.
import { asSystem, currentWs, DEFAULT_WS } from './db';
import { orm, workspaces, projects, workspaceMembers, invites, files, screenshots, usageCounters, eq, and, isNull, gt, sql } from './orm';
import { isSaas } from './platform';
import { PLANS, LIMIT_DEFS } from './plans';
import { getPlanVersion } from './billing-plans';

const LABEL = {
  projects: 'projects',
  members: 'members',
  aiCalls: 'AI actions this month',
  codeJobs: 'AI code jobs this month',
  storageMb: 'MB of storage',
  dbConnections: 'database connections per project',
  schemaReads: 'schema reads this month',
};
const UNLIMITED = { projects: null, members: null, aiCalls: null, codeJobs: null, storageMb: null, dbConnections: null, schemaReads: null };
export const billingOn = () => isSaas();
/** Whether a plan value is a limit that stops things: a positive number. `null` (no limit) and 0 (no longer a gate) aren't. */
const enforced = (limit) => limit != null && limit > 0;

/** Runs a Drizzle query in system context (these counts are about the whole workspace, whoever asks). */
const sys = <T>(run: () => PromiseLike<T>): Promise<T> => asSystem(async () => await run());
/** The workspace's plan facts. The keys stay snake_case, as the plan code below reads them. */
const planRow = async (ws): Promise<any> =>
  (
    await sys(() =>
      orm
        .select({
          plan: workspaces.plan,
          plan_version: workspaces.planVersion,
          subscription_status: workspaces.subscriptionStatus,
          trial_ends_at: workspaces.trialEndsAt,
          current_period_end: workspaces.currentPeriodEnd,
          cancel_at_period_end: workspaces.cancelAtPeriodEnd,
        })
        .from(workspaces)
        .where(eq(workspaces.id, ws)),
    )
  )[0];
const count = sql<number>`count(*)::int`;
const bytesOf = (col) => sql<string>`coalesce(sum(${col}), 0)::bigint`;
const period = (d = new Date()) => d.toISOString().slice(0, 7); // YYYY-MM (UTC)

/** Subscription states that keep the paid plan: paying, in a Stripe trial, or a failed payment Stripe is still retrying. */
const KEEPS_PLAN = ['active', 'trialing', 'past_due'];

/**
 * A cancelled subscription keeps its paid plan until the period it paid for ends (`cancel_at_period_end` with a
 * `current_period_end`, or the trial end when no period was set); after that the workspace is on Free.
 */
function cancelledAndEnded(w, now = new Date()) {
  if (!w?.cancel_at_period_end) return false;
  const end = w.current_period_end || w.trial_ends_at;
  return !end || new Date(end) <= now;
}

/**
 * A trial that ended without a payment: the workspace is locked until the owner pays. A cancelled trial isn't locked
 * (it just ends and the workspace is on Free), and neither is a subscription that is paid or paying.
 */
function trialEndedUnpaid(w, now = new Date()) {
  return Boolean(
    w?.plan &&
    w.plan !== 'free' &&
    w.subscription_status === 'trialing' &&
    !w.cancel_at_period_end &&
    w.trial_ends_at &&
    new Date(w.trial_ends_at) <= now,
  );
}

/** { locked, reason, plan: { id, name }, trialEndedAt }: whether the workspace is locked and the pay prompt is shown (SaaS only). */
export async function lockStatus(ws = currentWs()) {
  if (!billingOn() || !ws || ws === DEFAULT_WS) return { locked: false };
  const w = await planRow(ws);
  if (!trialEndedUnpaid(w)) return { locked: false };
  const def = await getPlanVersion(w.plan, w.plan_version || 1);
  return {
    locked: true,
    reason: 'trial_ended',
    plan: { id: w.plan, name: def?.name || PLANS[w.plan]?.name || w.plan },
    trialEndedAt: w.trial_ends_at,
  };
}

/** The plan in force for a workspace: { id, name, limits, source: 'subscription' | 'trial' | 'locked' | 'free' | 'unlimited', … }. */
export async function effectivePlan(ws = currentWs()) {
  if (!billingOn() || !ws || ws === DEFAULT_WS) return { id: 'unlimited', name: 'Unlimited', limits: UNLIMITED, source: 'unlimited' };
  const w = await planRow(ws);
  if (!w) return { id: 'free', name: PLANS.free.name, limits: PLANS.free.limits, source: 'free' };
  // The plan version the workspace subscribed to: later edits to the plan don't change it (billing-plans.js).
  const def = w.plan && w.plan !== 'free' ? (await getPlanVersion(w.plan, w.plan_version || 1)) || PLANS[w.plan] : null;
  if (def && trialEndedUnpaid(w)) {
    return {
      id: w.plan,
      name: def.name,
      limits: PLANS.free.limits,
      source: 'locked',
      locked: true,
      status: w.subscription_status,
      trialEndsAt: w.trial_ends_at,
    };
  }
  if (def && KEEPS_PLAN.includes(w.subscription_status) && !cancelledAndEnded(w)) {
    return {
      id: w.plan,
      version: w.plan_version || 1,
      name: def.name,
      limits: def.limits,
      source: 'subscription',
      status: w.subscription_status,
      pastDue: w.subscription_status === 'past_due',
      ...(w.subscription_status === 'trialing' ? { trialEndsAt: w.trial_ends_at } : {}),
    };
  }
  if (w.trial_ends_at && new Date(w.trial_ends_at) > new Date()) {
    return { id: 'pro', name: `${PLANS.pro.name} trial`, limits: PLANS.pro.limits, source: 'trial', trialEndsAt: w.trial_ends_at };
  }
  return { id: 'free', name: PLANS.free.name, limits: PLANS.free.limits, source: 'free' };
}

/** The plan limits the app shows: [key, name, unit]. */
const SHOWN = Object.entries<any>(LIMIT_DEFS)
  .filter(([, d]) => !d.perProject)
  .map(([key, d]) => [key, d.name, d.unit]);
/**
 * Every plan limit with its name and current value, what's used and what's left: [{ key, name, unit, used, limit,
 * remaining, reached, note }]. `limit` and `remaining` are null when unlimited. Members count pending invites, like
 * checkLimit does. A limit is reached when nothing more of it can be used (used >= limit).
 */
export function limitRows(plan, u) {
  return SHOWN.map(([key, name, unit]) => {
    const used = (key === 'members' ? u.members + u.pendingInvites : u[key]) || 0;
    const value = plan.limits[key] ?? null;
    const limit = enforced(value) ? value : null;
    const note =
      key === 'members' && u.pendingInvites
        ? `Includes ${u.pendingInvites} pending invite${u.pendingInvites === 1 ? '' : 's'}.`
        : key === 'aiCalls' && limit != null
          ? 'Only AI paid by the service counts. Your own API keys and people’s own Claude subscriptions don’t.'
          : value === 0
            ? 'Included in every plan, with no limit.'
            : '';
    return {
      key,
      name,
      unit,
      used,
      limit,
      remaining: limit == null ? null : Math.max(0, Math.round((limit - used) * 10) / 10),
      reached: limit != null && used >= limit,
      note,
    };
  });
}

/** The 402 the app shows as an upgrade prompt. */
function limitError(metric, limit, plan) {
  const what = LABEL[metric] || metric;
  const msg = `Your ${plan.name} plan allows ${limit.toLocaleString()} ${what}. Upgrade for more.`;
  return Object.assign(new Error(msg), { status: 402, extra: { code: 'limit', metric, limit, plan: plan.id } });
}

/** What the workspace uses now (for the Billing page and the counted limits). */
export async function usage(ws = currentWs()) {
  const p = period();
  const [[proj], [mem], [inv], [fileBytes], [shotBytes], ctr] = await Promise.all([
    sys(() => orm.select({ n: count }).from(projects).where(eq(projects.workspaceId, ws))),
    sys(() =>
      orm
        .select({ n: count })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, ws), eq(workspaceMembers.status, 'active'))),
    ),
    sys(() =>
      orm
        .select({ n: count })
        .from(invites)
        .where(and(eq(invites.workspaceId, ws), isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, sql`now()`))),
    ),
    sys(() =>
      orm
        .select({ b: bytesOf(files.bytes) })
        .from(files)
        .innerJoin(projects, eq(projects.id, files.projectId))
        .where(eq(projects.workspaceId, ws)),
    ),
    sys(() =>
      orm
        .select({ b: bytesOf(screenshots.bytes) })
        .from(screenshots)
        .innerJoin(projects, eq(projects.id, screenshots.projectId))
        .where(eq(projects.workspaceId, ws)),
    ),
    sys(() =>
      orm
        .select({ metric: usageCounters.metric, n: usageCounters.n })
        .from(usageCounters)
        .where(and(eq(usageCounters.workspaceId, ws), eq(usageCounters.period, p))),
    ),
  ]);
  const monthly = Object.fromEntries(ctr.map((r) => [r.metric, r.n]));
  return {
    projects: proj.n,
    members: mem.n,
    pendingInvites: inv.n,
    storageMb: Math.round(((Number(fileBytes.b) + Number(shotBytes.b)) / 1048576) * 10) / 10,
    aiCalls: monthly.aiCalls || 0,
    codeJobs: monthly.codeJobs || 0,
    schemaReads: monthly.schemaReads || 0,
    period: p,
  };
}

/**
 * Before adding something counted: projects (adding = 1), members (people + pending invites + adding), storage
 * (adding = bytes). Throws the upgrade 402 when it would go over the plan.
 */
export async function checkLimit(metric, adding = 1, ws = currentWs()) {
  const plan = await effectivePlan(ws);
  const limit = plan.limits[metric];
  if (!enforced(limit)) return;
  const u = await usage(ws);
  const now = metric === 'members' ? u.members + u.pendingInvites : metric === 'storageMb' ? u.storageMb : u[metric];
  const add = metric === 'storageMb' ? adding / 1048576 : adding;
  if (now + add > limit) throw limitError(metric, limit, plan);
}

/** Before adding something counted per project (dbConnections), given how many the project has now. */
export async function checkPerProject(metric, current, ws = currentWs()) {
  const plan = await effectivePlan(ws);
  const limit = plan.limits[metric];
  if (enforced(limit) && current + 1 > limit) throw limitError(metric, limit, plan);
}

/**
 * Uses one of a monthly allowance (aiCalls, codeJobs), atomically: two requests at once can't both take the last one.
 * Returns a function that gives it back (for a call that then failed), or a no-op when there's no limit.
 */
export async function consume(metric, ws = currentWs()) {
  const plan = await effectivePlan(ws);
  const limit = plan.limits[metric];
  if (!enforced(limit)) return () => {};
  const p = period();
  const [taken] = await sys(() =>
    orm
      .insert(usageCounters)
      .values({ workspaceId: ws, metric, period: p, n: 1 })
      .onConflictDoUpdate({
        target: [usageCounters.workspaceId, usageCounters.metric, usageCounters.period],
        set: { n: sql`${usageCounters.n} + 1` },
        setWhere: sql`${usageCounters.n} < ${limit}`,
      })
      .returning({ n: usageCounters.n }),
  );
  if (!taken) throw limitError(metric, limit, plan);
  let given = false;
  return () => {
    if (given) return;
    given = true;
    sys(() =>
      orm
        .update(usageCounters)
        .set({ n: sql`greatest(${usageCounters.n} - 1, 0)` })
        .where(and(eq(usageCounters.workspaceId, ws), eq(usageCounters.metric, metric), eq(usageCounters.period, p))),
    ).catch(() => {});
  };
}
