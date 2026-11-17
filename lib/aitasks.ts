// Model routing (Administration → AI → Model routing): every AI call names its task, each task has a tier, and each
// tier maps to a model per AI (your Claude account, GitHub Copilot, each AI API). Heavy reasoning gets the top model;
// routine, high-volume work (epics outlines, questions, failure notes) gets a cheaper, faster one, saving usage.

/** The three tiers, best first. */
export const TIERS = ['high', 'standard', 'light'];

/** Every kind of AI work, with the tier it uses unless an administrator changes it. */
export const AI_TASKS = [
  { id: 'epics', group: 'Planning', label: 'Epics from documents', desc: 'New projects from documents, regrouping epics', tier: 'standard', maxOut: 32000, escalate: true },
  { id: 'tickets', group: 'Planning', label: 'Tickets', desc: 'Enhance, acceptance criteria, new issues', tier: 'high', maxOut: 16000, escalate: true },
  { id: 'split', group: 'Planning', label: 'Splitting issues', desc: 'Split big issues into small ones', tier: 'standard', maxOut: 12000, escalate: true },
  { id: 'docs', group: 'Documents', label: 'Documents', desc: 'Problem statements, feature briefs, architecture records', tier: 'high', maxOut: 32000 },
  { id: 'agents', group: 'Documents', label: 'Document agents', desc: 'Epic, Kick Off, UX Design Spec, Demo, Sign-Off, Deploy and Release agents', tier: 'standard', maxOut: 16000 },
  { id: 'repo', group: 'Documents', label: 'Repository scan', desc: 'Built features, page tests and changes from your code', tier: 'standard', maxOut: 24000 },
  { id: 'tests', group: 'Testing', label: 'Test cases', desc: 'Test cases on issues and repository tests', tier: 'standard', maxOut: 16000, escalate: true },
  { id: 'plan', group: 'Testing', label: 'Test plans', desc: 'AI-built test plans from the repository', tier: 'standard', maxOut: 16000, escalate: true },
  { id: 'automation', group: 'Testing', label: 'Automation scripts', desc: 'Playwright scripts written from test cases', tier: 'high', maxOut: 16000 },
  { id: 'healing', group: 'Testing', label: 'Self-healing', desc: 'Repairing scripts that broke because the page changed', tier: 'standard', maxOut: 8000 },
  { id: 'selection', group: 'Testing', label: 'Test selection', desc: 'Picking the tests worth running for a change', tier: 'light', maxOut: 4000 },
  { id: 'failure', group: 'Testing', label: 'Failure analysis', desc: 'Root cause and fix notes when an automated test fails', tier: 'light', maxOut: 3000 },
  { id: 'code', group: 'Code', label: 'Coding agents', desc: 'Build a Ticket, Frontend and Backend Developer, Fix a Bug, Architecture Record (Claude Code)', tier: 'high', maxOut: 32000, agent: true },
  { id: 'agent-tests', group: 'Code', label: 'Test and helper agents', desc: 'Feature Tests, Test Automation, Free Worker (Claude Code)', tier: 'standard', agent: true },
  { id: 'review', group: 'Code', label: 'Code review', desc: 'Review a Pull Request, Review Panel, UI/UX Review, on AI changes and open pull requests', tier: 'high', agent: true },
  { id: 'pr', group: 'Code', label: 'Pull request text', desc: 'PR / MR titles and descriptions', tier: 'light', maxOut: 1500 },
  { id: 'quick', group: 'Helpers', label: 'Quick helpers', desc: 'Clarifying questions, frontend/backend labels, small sorting jobs', tier: 'light', maxOut: 2000 },
];
const TASK_IDS = new Set(AI_TASKS.map((t) => t.id));

/** Which routing task a Claude Code agent's runs count as. */
export const AGENT_TASK = { build: 'code', frontend: 'code', backend: 'code', 'bug-fix': 'code', 'architecture-record': 'code',
  'feature-tests': 'agent-tests', 'test-automation': 'agent-tests', 'free-worker': 'agent-tests', review: 'review', 'review-panel': 'review', 'ui-review': 'review' };

/** Claude Code aliases: always the newest model of each family your Claude Code knows. */
export const CLAUDE_TIER_DEFAULTS = { high: 'opus', standard: 'sonnet', light: 'haiku' };
/** Suggested models per tier for each AI API (shown as hints; blank uses the provider's own model). */
export const API_TIER_HINTS = {
  anthropic: { high: 'claude-opus-5-5', standard: 'claude-sonnet-5-5', light: 'claude-haiku-5-5' },
  openai: { high: 'gpt-4.1', standard: 'gpt-4.1', light: 'gpt-4.1-mini' },
  gemini: { high: 'gemini-2.5-pro', standard: 'gemini-2.5-flash', light: 'gemini-2.5-flash-lite' },
};

const str = (v, n = 120) => String(v ?? '').trim().slice(0, n);
const tierMap = (v, dflt: any = {}) => Object.fromEntries(TIERS.map((k) => [k, str(v?.[k] ?? dflt[k] ?? '')]));

/** Saved routing → a complete, safe object. */
export function normalizeRouting(v: any = {}) {
  const tiers: any = {};
  for (const t of AI_TASKS) tiers[t.id] = TIERS.includes(v?.tiers?.[t.id]) || /^cfg:[\w-]{1,40}$/.test(v?.tiers?.[t.id] || '') ? v.tiers[t.id] : t.tier;
  const api: any = {};
  for (const [id, m] of Object.entries<any>(v?.api || {})) if (/^[\w-]{1,40}$/.test(id)) api[id] = tierMap(m);
  return {
    enabled: v?.enabled !== false,
    lightFast: v?.lightFast !== false, // light tasks never use extended thinking
    // Save usage: reuse answers to identical requests for these tasks, for `cacheDays` days.
    cache: v?.cache !== false,
    cacheDays: Math.max(1, Math.min(90, Number(v?.cacheDays) || 14)),
    cacheTasks: Array.isArray(v?.cacheTasks) ? v.cacheTasks.filter((t) => TASK_IDS.has(t)) : ['quick', 'repo', 'failure', 'pr', 'selection', 'healing', 'plan'],
    tiers,
    // Cheap first: tasks marked escalate run on Standard and are re-asked once on High if the answer doesn't parse.
    escalate: v?.escalate === true,
    // Your own prices (USD per million tokens) for models the built-in list doesn't have, or to override it.
    prices: normalizePrices(v?.prices),
    // Monthly AI budget in USD (0 = none). warn: banner only · downgrade: High work runs on Standard · pause: AI stops.
    budget: { monthlyUsd: Math.max(0, Number(v?.budget?.monthlyUsd) || 0), action: ['warn', 'downgrade', 'pause'].includes(v?.budget?.action) ? v.budget.action : 'downgrade' },
    claude: tierMap(v?.claude, CLAUDE_TIER_DEFAULTS),
    copilot: tierMap(v?.copilot),
    api,
  };
}
export const DEFAULT_ROUTING = normalizeRouting({});

/** The tier for a task ('' = no task named: the caller's own choice). A task routed to a custom configuration has no tier. */
export function tierFor(routing, task) {
  const p: any = pickFor(routing, task);
  return TIERS.includes(p) ? p : '';
}
/** What a task runs on: a tier, 'cfg:<id>' (a custom AI configuration) or '' (the caller's own choice). */
export function pickFor(routing, task) {
  if (!routing?.enabled || !TASK_IDS.has(task)) return '';
  return routing.tiers[task] || 'standard';
}

/** Custom AI configurations (Administration → AI → Configurations): a named engine + model + reasoning + instructions. */
export const ENGINES = ['claude', 'copilot', 'api'];
export function normalizeConfigs(list) {
  return (Array.isArray(list) ? list : []).filter((c) => c && /^[\w-]{1,40}$/.test(c.id)).slice(0, 30).map((c) => ({
    id: c.id, name: str(c.name, 40) || 'Configuration', engine: ENGINES.includes(c.engine) ? c.engine : 'claude', providerId: str(c.providerId, 40),
    model: str(c.model, 80), reasoning: ['fast', 'balanced', 'thorough'].includes(c.reasoning) ? c.reasoning : '', instructions: str(c.instructions, 2000), enabled: c.enabled !== false,
  }));
}

// ---------------------------------------------------------------- prices (USD per million tokens)
// Anthropic list prices; cache writes are 1.25x input (5-minute cache). Other providers: add yours in Administration
// → AI → Model routing → Prices. A model without a price shows tokens only.
export const PRICES_DEFAULT = {
  'claude-fable-5-2': { in: 8, out: 40, cacheRead: 0.2 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
  'claude-opus-5': { in: 5, out: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01 },
};
/** Claude Code aliases → the model they mean today (for API-equivalent estimates of Claude account runs). */
const ALIAS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5', fable: 'claude-fable-5-2' };
function normalizePrices(v) {
  const out: any = {};
  for (const [m, p] of Object.entries<any>(v && typeof v === 'object' ? v : {})) {
    if (!/^[\w.:/-]{1,80}$/.test(m) || !p) continue;
    const n = (x) => (Number.isFinite(Number(x)) && Number(x) >= 0 ? Number(x) : null);
    if (n(p.in) == null || n(p.out) == null) continue;
    out[m] = { in: n(p.in), out: n(p.out), cacheRead: n(p.cacheRead) ?? n(p.in) * 0.1 };
  }
  return out;
}
/** The price of a model: your price, else the built-in one (longest matching name, so dated ids match too). */
export function priceFor(model, prices: any = {}) {
  const m = ALIAS[String(model || '').toLowerCase()] || String(model || '');
  if (!m) return null;
  const all = { ...PRICES_DEFAULT, ...prices };
  if (all[m]) return all[m];
  const k = Object.keys(all).filter((x) => m.startsWith(x)).sort((a, b) => b.length - a.length)[0];
  return k ? all[k] : null;
}
/** USD for one call's tokens, or null when the model has no price. */
export function costOf(model, t, prices) {
  const p = priceFor(model, prices);
  if (!p || !t) return null;
  return ((t.input || 0) * p.in + (t.output || 0) * p.out + (t.cacheRead || 0) * (p.cacheRead ?? p.in * 0.1) + (t.cacheWrite || 0) * p.in * 1.25) / 1e6;
}
/** Output limit for a task (tokens). */
export const maxOutFor = (task) => AI_TASKS.find((t) => t.id === task)?.maxOut || 32000;
