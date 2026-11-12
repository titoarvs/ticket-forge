// Model routing (Administration → AI → Model routing): every AI call names its task, each task has a tier, and each
// tier maps to a model per AI (your Claude account, GitHub Copilot, each AI API). Heavy reasoning gets the top model;
// routine, high-volume work (epics outlines, questions, failure notes) gets a cheaper, faster one, saving usage.

/** The three tiers, best first. */
export const TIERS = ['high', 'standard', 'light'];

/** Every kind of AI work, with the tier it uses unless an administrator changes it. */
export const AI_TASKS = [
  { id: 'epics', group: 'Planning', label: 'Epics from documents', desc: 'New projects from documents, regrouping epics', tier: 'standard' },
  { id: 'tickets', group: 'Planning', label: 'Tickets', desc: 'Enhance, acceptance criteria, new issues', tier: 'high' },
  { id: 'split', group: 'Planning', label: 'Splitting issues', desc: 'Split big issues into small ones', tier: 'standard' },
  { id: 'docs', group: 'Documents', label: 'Documents', desc: 'Problem statements, feature briefs, architecture records', tier: 'high' },
  { id: 'agents', group: 'Documents', label: 'Document agents', desc: 'Epic, Kick Off, UX Design Spec, Demo, Sign-Off, Deploy and Release agents', tier: 'standard' },
  { id: 'repo', group: 'Documents', label: 'Repository scan', desc: 'Built features, page tests and changes from your code', tier: 'standard' },
  { id: 'tests', group: 'Testing', label: 'Test cases', desc: 'Test cases on issues and repository tests', tier: 'standard' },
  { id: 'plan', group: 'Testing', label: 'Test plans', desc: 'AI-built test plans from the repository', tier: 'standard' },
  { id: 'automation', group: 'Testing', label: 'Automation scripts', desc: 'Playwright scripts written from test cases', tier: 'high' },
  { id: 'healing', group: 'Testing', label: 'Self-healing', desc: 'Repairing scripts that broke because the page changed', tier: 'standard' },
  { id: 'selection', group: 'Testing', label: 'Test selection', desc: 'Picking the tests worth running for a change', tier: 'light' },
  { id: 'failure', group: 'Testing', label: 'Failure analysis', desc: 'Root cause and fix notes when an automated test fails', tier: 'light' },
  { id: 'code', group: 'Code', label: 'Coding agents', desc: 'Build a Ticket, Frontend and Backend Developer, Fix a Bug, Architecture Record (Claude Code)', tier: 'high', agent: true },
  { id: 'agent-tests', group: 'Code', label: 'Test and helper agents', desc: 'Feature Tests, Test Automation, Free Worker (Claude Code)', tier: 'standard', agent: true },
  { id: 'review', group: 'Code', label: 'Code review', desc: 'Review a Pull Request, Review Panel, UI/UX Review, on AI changes and open pull requests', tier: 'high', agent: true },
  { id: 'pr', group: 'Code', label: 'Pull request text', desc: 'PR / MR titles and descriptions', tier: 'light' },
  { id: 'quick', group: 'Helpers', label: 'Quick helpers', desc: 'Clarifying questions, frontend/backend labels, small sorting jobs', tier: 'light' },
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
const tierMap = (v, dflt = {}) => Object.fromEntries(TIERS.map((k) => [k, str(v?.[k] ?? dflt[k] ?? '')]));

/** Saved routing → a complete, safe object. */
export function normalizeRouting(v = {}) {
  const tiers = {};
  for (const t of AI_TASKS) tiers[t.id] = TIERS.includes(v?.tiers?.[t.id]) || /^cfg:[\w-]{1,40}$/.test(v?.tiers?.[t.id] || '') ? v.tiers[t.id] : t.tier;
  const api = {};
  for (const [id, m] of Object.entries(v?.api || {})) if (/^[\w-]{1,40}$/.test(id)) api[id] = tierMap(m);
  return {
    enabled: v?.enabled !== false,
    lightFast: v?.lightFast !== false, // light tasks never use extended thinking
    // Save usage: reuse answers to identical requests for these tasks, for `cacheDays` days.
    cache: v?.cache !== false,
    cacheDays: Math.max(1, Math.min(90, Number(v?.cacheDays) || 14)),
    cacheTasks: Array.isArray(v?.cacheTasks) ? v.cacheTasks.filter((t) => TASK_IDS.has(t)) : ['quick', 'repo', 'failure', 'pr', 'selection', 'healing', 'plan'],
    tiers,
    claude: tierMap(v?.claude, CLAUDE_TIER_DEFAULTS),
    copilot: tierMap(v?.copilot),
    api,
  };
}
export const DEFAULT_ROUTING = normalizeRouting({});

/** The tier for a task ('' = no task named: the caller's own choice). A task routed to a custom configuration has no tier. */
export function tierFor(routing, task) {
  const p = pickFor(routing, task);
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
