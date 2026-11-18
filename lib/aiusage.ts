// The AI usage report (Administration → AI → Model routing → Usage): what the AI was used for, by whom, in which
// project and on which model, with tokens and cost, from the ai_usage table (one row per AI call).
import { qs, currentWs, DEFAULT_WS } from './db';

// Every query is for the current workspace only.
const W = () => currentWs() || DEFAULT_WS;
import { getAiSettings } from './settings';
import { normalizeRouting, AI_TASKS } from './aitasks';
import { budgetState } from './claude';

const n = (x) => Number(x) || 0;
const group = async (col, days, extra = '') => (await qs(`select ${col} as k, count(*)::int as calls, sum(input + output + cache_read)::bigint as tokens,
    sum(cache_read)::bigint as cache_read, coalesce(sum(cost) filter (where engine = 'api'), 0) as cost, coalesce(sum(cost) filter (where engine = 'account'), 0) as equiv,
    count(*) filter (where cached)::int as cached, count(*) filter (where escalated)::int as escalated, count(*) filter (where not ok)::int as errors, sum(ms)::bigint as ms
  from ai_usage ${extra} where ${extra ? 'u.' : ''}workspace_id = $2 and at >= now() - ($1 || ' days')::interval group by 1 order by cost desc, tokens desc limit 50`, [String(days), W()])).rows
  .map((r) => ({ key: r.k, calls: r.calls, tokens: n(r.tokens), cacheRead: n(r.cache_read), cost: n(r.cost), equiv: n(r.equiv), cached: r.cached, escalated: r.escalated, errors: r.errors, ms: n(r.ms) }));

export async function usageReport(days = 30) {
  days = Math.max(1, Math.min(365, Number(days) || 30));
  const tot = (await qs(`select count(*)::int as calls, coalesce(sum(input), 0)::bigint as input, coalesce(sum(output), 0)::bigint as output,
      coalesce(sum(cache_read), 0)::bigint as cache_read, coalesce(sum(cache_write), 0)::bigint as cache_write,
      coalesce(sum(cost) filter (where engine = 'api'), 0) as cost, coalesce(sum(cost) filter (where engine = 'account'), 0) as equiv,
      count(*) filter (where cached)::int as cached, count(*) filter (where escalated)::int as escalated, count(*) filter (where not ok)::int as errors,
      count(*) filter (where estimated and not cached and ok)::int as estimated, count(*) filter (where cost is null and engine = 'api')::int as unpriced,
      coalesce(sum(chars) filter (where cached), 0)::bigint as cached_chars
    from ai_usage where workspace_id = $2 and at >= now() - ($1 || ' days')::interval`, [String(days), W()])).rows[0];
  const byDay = (await qs(`select to_char(date_trunc('day', at), 'YYYY-MM-DD') as day, count(*)::int as calls, coalesce(sum(cost) filter (where engine = 'api'), 0) as cost,
      sum(input + output + cache_read)::bigint as tokens from ai_usage where workspace_id = $2 and at >= now() - ($1 || ' days')::interval group by 1 order by 1`, [String(days), W()])).rows
    .map((r) => ({ day: r.day, calls: r.calls, cost: n(r.cost), tokens: n(r.tokens) }));
  const labels = Object.fromEntries(AI_TASKS.map((t) => [t.id, t.label]));
  const byTask = (await group('task', days)).map((r) => ({ ...r, label: labels[r.key] || r.key }));
  const byProject = await group("coalesce(p.name, u.project_id, '(no project)')", days, 'u left join projects p on p.id = u.project_id');
  const byUser = await group("coalesce(nullif(user_name, ''), '(system)')", days);
  const byModel = await group("case when cached then 'Reused answer' else coalesce(nullif(model, ''), engine) end", days);
  const byEngine = await group('engine', days);
  const top = (await qs(`select u.at, u.task, u.engine, u.model, u.input, u.output, u.cache_read, u.cost, u.ms, u.estimated, u.user_name, coalesce(p.name, u.project_id) as project
    from ai_usage u left join projects p on p.id = u.project_id where u.workspace_id = $2 and u.at >= now() - ($1 || ' days')::interval and not u.cached
    order by coalesce(u.cost, 0) desc, (u.input + u.output) desc limit 20`, [String(days), W()])).rows
    .map((r) => ({ ...r, cost: r.cost == null ? null : n(r.cost), label: labels[r.task] || r.task }));
  const routing = normalizeRouting((await getAiSettings().catch(() => ({}))).routing);
  const noCtx = (await qs(`select p.id, p.name from projects p where p.workspace_id = $2 and coalesce(p.data->'appContext'->>'md', '') = ''
      and exists (select 1 from ai_usage u where u.project_id = p.id and u.at >= now() - ($1 || ' days')::interval)`, [String(days), W()])).rows;
  const avgIn = (await qs(`select task, avg(input + cache_read)::int as avg_in, count(*)::int as calls from ai_usage
      where workspace_id = $2 and not cached and at >= now() - ($1 || ' days')::interval group by task`, [String(days), W()])).rows;
  const totals = { calls: tot.calls, cost: n(tot.cost), cached: tot.cached, unpriced: tot.unpriced, errors: tot.errors, escalated: tot.escalated };
  return {
    suggestions: suggest({ routing, totals, byTask, noCtx, avgIn, labels }),
    days,
    totals: { calls: tot.calls, input: n(tot.input), output: n(tot.output), cacheRead: n(tot.cache_read), cacheWrite: n(tot.cache_write), cost: n(tot.cost), equiv: n(tot.equiv),
      cached: tot.cached, escalated: tot.escalated, errors: tot.errors, estimated: tot.estimated, unpriced: tot.unpriced, cachedChars: n(tot.cached_chars) },
    byDay, byTask, byProject, byUser, byModel, byEngine, top,
    budget: { ...routing.budget, ...(await budgetState(routing)) },
  };
}

/** Every call in the period, as CSV. */
export async function usageCsv(days = 30) {
  const rows = (await qs(`select u.at, coalesce(p.name, u.project_id, '') as project, u.user_name, u.task, u.engine, u.model, u.tier, u.input, u.output, u.cache_read, u.cache_write,
      u.estimated, u.cached, u.escalated, u.ok, u.ms, u.cost from ai_usage u left join projects p on p.id = u.project_id
    where u.workspace_id = $2 and u.at >= now() - ($1 || ' days')::interval order by u.at desc limit 100000`, [String(Math.max(1, Math.min(365, Number(days) || 30))), W()])).rows;
  const cols = ['at', 'project', 'user_name', 'task', 'engine', 'model', 'tier', 'input', 'output', 'cache_read', 'cache_write', 'estimated', 'cached', 'escalated', 'ok', 'ms', 'cost'];
  const esc = (v) => { const s = v instanceof Date ? v.toISOString() : v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

/** Average tokens and cost of one call of a task over the last 30 days (for "about this much" before big jobs). */
export async function taskAverage(task) {
  const r = (await qs(`select count(*)::int as calls, avg(input + output + cache_read) as tokens, avg(cost) filter (where engine = 'api') as cost
    from ai_usage where workspace_id = $2 and task = $1 and not cached and ok and at >= now() - interval '30 days'`, [String(task), W()])).rows[0];
  return { calls: r.calls, tokens: Math.round(n(r.tokens)), cost: r.cost == null ? null : n(r.cost) };
}

/**
 * Suggestions from the actual usage: each says what to change, why, and roughly what it saves. "action" names a
 * setting the page can switch on in one click.
 */
function suggest({ routing, totals, byTask, noCtx, avgIn, labels }: any) {
  const out: any[] = [];
  const calls = (id) => byTask.find((t) => t.key === id)?.calls || 0;
  const highTasks = Object.entries<any>(routing.tiers).filter(([, v]) => v === 'high').map(([k]) => k);
  const escalatable = ['tickets', 'tests', 'epics', 'split', 'plan'].filter((t) => highTasks.includes(t) && calls(t) > 0);
  if (!routing.escalate && escalatable.length) out.push({ id: 'escalate', impact: 'high', title: 'Try Standard first for High work',
    text: `${escalatable.map((t) => labels[t] || t).join(', ')} run on High (${escalatable.reduce((a, t) => a + calls(t), 0)} calls). Trying Standard first and stepping up to High only when the answer isn’t usable usually costs 40–60% less on these tasks.`, action: 'escalate' });
  if (totals.calls >= 20 && totals.cached / Math.max(1, totals.calls) < 0.05) {
    const missing = ['tests', 'plan', 'repo'].filter((t) => !routing.cacheTasks.includes(t) && calls(t) > 0);
    if (!routing.cache) out.push({ id: 'cache', impact: 'medium', title: 'Turn on reusing answers', text: 'Identical requests are sent to the AI again every time. Reusing answers costs nothing when the input hasn’t changed.', action: 'cache' });
    else if (missing.length) out.push({ id: 'cache-tasks', impact: 'medium', title: `Reuse answers for ${missing.map((t) => labels[t] || t).join(', ')}`, text: 'These tasks are often asked the same thing again (the same issue, the same repository). Reused answers cost nothing; “Again” still asks fresh.', action: 'cache-tasks', tasks: missing });
  }
  if (noCtx.length) out.push({ id: 'context', impact: 'medium', title: `Build the App context for ${noCtx.slice(0, 3).map((p) => p.name).join(', ')}${noCtx.length > 3 ? ` and ${noCtx.length - 3} more` : ''}`,
    text: 'Without it, every AI action has to be told about the app again, and answers guess names. Build it once in Project settings → App context; it’s then cached by the AI API (cheap to re-send).', projects: noCtx.slice(0, 5) });
  const heavy = avgIn.filter((r) => r.calls >= 3 && r.avg_in > 25000).sort((a, b) => b.avg_in - a.avg_in)[0];
  if (heavy) out.push({ id: 'heavy', impact: 'medium', title: `${labels[heavy.task] || heavy.task} sends a lot per call`, text: `About ${Math.round(heavy.avg_in / 1000)}k tokens per call on average. Run it on fewer items at a time, or on Light if the results are routine.` });
  if (!routing.budget.monthlyUsd && totals.cost > 0) out.push({ id: 'budget', impact: 'low', title: 'Set a monthly AI budget', text: `API spend in this period: $${totals.cost.toFixed(2)}. A budget warns at 80% and then moves High work to Standard (or pauses AI), so a busy month can’t surprise you.` });
  if (!routing.lightFast) out.push({ id: 'light-fast', impact: 'low', title: 'No extended thinking on Light tasks', text: 'Light tasks (questions, labels, failure notes) don’t need it; thinking makes them slower and costlier.', action: 'light-fast' });
  if (totals.unpriced > 0) out.push({ id: 'prices', impact: 'low', title: 'Add prices for your other models', text: `${totals.unpriced} API calls used models without a price, so their cost isn’t counted. Add them in Savings & limits → Prices.` });
  if (totals.calls >= 20 && totals.errors / totals.calls > 0.05) out.push({ id: 'errors', impact: 'low', title: 'Many AI calls failed', text: `${totals.errors} of ${totals.calls} calls failed: failed calls still cost time and sometimes tokens. Check Providers and the AI connection.` });
  const order = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.impact] - order[b.impact]);
}
