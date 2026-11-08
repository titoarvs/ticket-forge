// Generation rules: the team's standard for tickets, test cases and automation scripts, set by an administrator
// in Administration → Generation. Every generation gets them as instructions; a few are also enforced in code
// (story points, ticket types, labels, test-case count and titles) so results stay consistent.
import { qs } from './db.js';

export const TICKET_TYPES = ['Story', 'Task', 'Bug', 'Spike'];
export const REASONING = ['fast', 'balanced', 'thorough'];

export const DEFAULT_RULES = {
  reasoning: 'fast',            // fast: no extended thinking, low effort. Consistent and quick.
  stickToDocument: true,
  tickets: {
    titleMaxWords: 10,
    userStory: true,
    acFormat: 'gwt',            // gwt: Given/When/Then · checklist: short testable statements
    acMin: 3,
    acMax: 6,
    pointScale: [1, 2, 3, 5, 8, 13],
    maxPoints: 8,
    types: [...TICKET_TYPES],
    defaultPriority: 'Medium',
    descriptionSections: 'Context, Scope, Out of scope',
    maxLabels: 3,
  },
  tests: {
    perTicket: 3,
    positive: true,
    negative: true,
    edge: true,
    titlePrefix: 'Verify',
    maxSteps: 8,
    preconditions: true,
  },
  automation: {
    roleLocators: true,
    noHardWaits: true,
    testDataPrefix: 'QA',
    oneFlow: true,
  },
  custom: '',
};

const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const text = (v, max, d = '') => (typeof v === 'string' ? v.trim().slice(0, max) : d);

/** Fills gaps with defaults and keeps every value in range. */
export function normalizeRules(r = {}) {
  const D = DEFAULT_RULES, t = r.tickets || {}, s = r.tests || {}, a = r.automation || {};
  const scale = (Array.isArray(t.pointScale) ? t.pointScale : String(t.pointScale ?? '').split(/[\s,]+/))
    .map(Number).filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
  const pointScale = scale.length ? [...new Set(scale)].sort((x, y) => x - y) : D.tickets.pointScale;
  const types = (Array.isArray(t.types) ? t.types : []).filter((x) => TICKET_TYPES.includes(x));
  const acMin = int(t.acMin, 1, 15, D.tickets.acMin);
  return {
    reasoning: REASONING.includes(r.reasoning) ? r.reasoning : D.reasoning,
    stickToDocument: bool(r.stickToDocument, D.stickToDocument),
    tickets: {
      titleMaxWords: int(t.titleMaxWords, 3, 30, D.tickets.titleMaxWords),
      userStory: bool(t.userStory, D.tickets.userStory),
      acFormat: t.acFormat === 'checklist' ? 'checklist' : 'gwt',
      acMin,
      acMax: Math.max(acMin, int(t.acMax, 1, 20, D.tickets.acMax)),
      pointScale,
      maxPoints: int(t.maxPoints, pointScale[0], pointScale[pointScale.length - 1], Math.min(D.tickets.maxPoints, pointScale[pointScale.length - 1])),
      types: types.length ? types : D.tickets.types,
      defaultPriority: ['Highest', 'High', 'Medium', 'Low'].includes(t.defaultPriority) ? t.defaultPriority : D.tickets.defaultPriority,
      descriptionSections: text(t.descriptionSections, 200, D.tickets.descriptionSections),
      maxLabels: int(t.maxLabels, 0, 10, D.tickets.maxLabels),
    },
    tests: {
      perTicket: int(s.perTicket, 1, 15, D.tests.perTicket),
      positive: bool(s.positive, D.tests.positive),
      negative: bool(s.negative, D.tests.negative),
      edge: bool(s.edge, D.tests.edge),
      titlePrefix: text(s.titlePrefix, 30, D.tests.titlePrefix),
      maxSteps: int(s.maxSteps, 2, 30, D.tests.maxSteps),
      preconditions: bool(s.preconditions, D.tests.preconditions),
    },
    automation: {
      roleLocators: bool(a.roleLocators, D.automation.roleLocators),
      noHardWaits: bool(a.noHardWaits, D.automation.noHardWaits),
      testDataPrefix: text(a.testDataPrefix, 20, D.automation.testDataPrefix).replace(/[^\w-]/g, ''),
      oneFlow: bool(a.oneFlow, D.automation.oneFlow),
    },
    custom: text(r.custom, 3000, ''),
  };
}

// ---------------------------------------------------------------- storage
const KEY = 'generation_rules';
const G = globalThis;
G.__tfRules ??= { v: undefined, at: 0, meta: null };
const C = G.__tfRules;

/** The rules in force (defaults until an administrator saves some). */
export async function getRules({ fresh = false } = {}) {
  if (!fresh && C.v !== undefined && Date.now() - C.at < 30000) return C.v;
  let saved = null;
  try { saved = (await qs('select value from app_meta where key = $1', [KEY])).rows[0]?.value || null; } catch { /* database not ready */ }
  C.v = normalizeRules(saved?.rules || {});
  C.meta = saved ? { updatedBy: saved.updatedBy || null, updatedAt: saved.updatedAt || null } : null;
  C.at = Date.now();
  return C.v;
}
export async function rulesMeta() { await getRules(); return C.meta; }
export async function saveRules(actor, rules) {
  const v = normalizeRules(rules);
  await qs('insert into app_meta (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value',
    [KEY, JSON.stringify({ rules: v, updatedBy: actor?.name || null, updatedAt: new Date().toISOString() })]);
  C.v = v; C.meta = { updatedBy: actor?.name || null, updatedAt: new Date().toISOString() }; C.at = Date.now();
  return v;
}
export async function resetRules() {
  await qs('delete from app_meta where key = $1', [KEY]);
  C.v = normalizeRules({}); C.meta = null; C.at = Date.now();
  return C.v;
}

// ---------------------------------------------------------------- rules as instructions
const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');

/** The rules as plain instructions for the AI. part: 'tickets' | 'tests' | 'automation'. */
export function rulesText(r, part) {
  const out = [];
  if (part === 'tickets') {
    const t = r.tickets;
    if (r.stickToDocument) out.push('Only include what the document asks for: no extra features, nice-to-haves or speculative tickets. Put anything unclear in openQuestions.');
    out.push(`Titles: imperative, at most ${t.titleMaxWords} words (e.g. "Export orders to CSV").`);
    out.push(t.userStory ? 'User story: "As a <role>, I want <goal>, so that <benefit>." on every Story.' : 'Leave userStory empty.');
    out.push(`Acceptance criteria: ${t.acMin}-${t.acMax} per ticket, ${t.acFormat === 'gwt' ? 'each one "Given …, when …, then …"' : 'each a short, testable statement (no Given/When/Then)'}.`);
    out.push(`Story points: only ${t.pointScale.join(', ')}. Anything bigger than ${t.maxPoints} must be split into smaller tickets.`);
    out.push(`Ticket types: only ${list(t.types)}.`);
    out.push(`Priority: ${t.defaultPriority} unless the document clearly says otherwise.`);
    if (t.descriptionSections) out.push(`Description: short sections in this order: ${t.descriptionSections} (one or two lines each, "Section: text").`);
    out.push(t.maxLabels ? `Labels: at most ${t.maxLabels}, lowercase, one word each.` : 'No labels.');
  }
  if (part === 'tests') {
    const s = r.tests;
    const kinds = [s.positive && 'one positive (happy path)', s.negative && 'one negative (invalid input or not allowed)', s.edge && 'one edge case'].filter(Boolean);
    out.push(`Exactly ${s.perTicket} test case${s.perTicket === 1 ? '' : 's'} per ticket${kinds.length ? `, including at least ${list(kinds.slice(0, s.perTicket))}` : ''}. Cover every acceptance criterion across them.`);
    if (s.titlePrefix) out.push(`Test titles start with "${s.titlePrefix} …" (e.g. "${s.titlePrefix} a cashier can open an order").`);
    out.push(`Steps: one user action per step, imperative ("Click Save"), at most ${s.maxSteps} steps.`);
    out.push('Expected result: one observable outcome the user sees.');
    out.push(s.preconditions ? 'Always fill preconditions (write "None" if there are none).' : 'Leave preconditions empty unless essential.');
  }
  if (part === 'automation') {
    const a = r.automation;
    if (a.roleLocators) out.push('Locators, in this order: getByRole, getByLabel, getByPlaceholder, getByText, getByTestId; CSS only as a last resort.');
    if (a.noHardWaits) out.push('Never use page.waitForTimeout or fixed sleeps; rely on web-first assertions.');
    if (a.testDataPrefix) out.push(`Name any data the test creates "${a.testDataPrefix}-" + Date.now().`);
    if (a.oneFlow) out.push('Script only the flow the test case describes; no extra checks.');
  }
  if (r.custom && part !== 'automation') out.push(`Team rules: ${r.custom}`);
  return out.map((x) => `- ${x}`).join('\n');
}

/** What every generation of tickets and test cases is told: be direct, follow the rules exactly. */
export function standardsBlock(r, parts = ['tickets', 'tests']) {
  return `Team standards. Follow them exactly and answer directly; don't deliberate over alternatives:\n${parts.map((p) => rulesText(r, p)).filter(Boolean).join('\n')}`;
}

// ---------------------------------------------------------------- enforced in code
const nearest = (n, scale) => scale.reduce((b, x) => (Math.abs(x - n) < Math.abs(b - n) ? x : b), scale[0]);
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** Story points on the scale, allowed types, default priority, labels, test-case count and titles. */
export function applyTicketRules(t, r) {
  const R = r.tickets, S = r.tests;
  const out = { ...t };
  if (Number.isFinite(out.storyPoints) && out.storyPoints > 0) out.storyPoints = nearest(out.storyPoints, R.pointScale);
  if (out.type !== 'Sub-task' && !R.types.includes(out.type)) out.type = R.types.includes('Story') ? 'Story' : R.types[0];
  if (!out.priority) out.priority = R.defaultPriority;
  out.labels = (out.labels || []).map((l) => String(l).toLowerCase().replace(/\s+/g, '-')).filter(Boolean).slice(0, R.maxLabels);
  if (Array.isArray(out.testCases)) out.testCases = out.testCases.map((tc) => applyTestRules(tc, r));
  return out;
}
export function applyTestRules(tc, r) {
  const p = r.tests.titlePrefix;
  if (!p || !tc.title) return tc;
  if (tc.title.toLowerCase().startsWith(p.toLowerCase())) return { ...tc, title: p + tc.title.slice(p.length) };
  return { ...tc, title: `${p} ${lowerFirst(tc.title)}` };
}
/** Keeps at most the standard number of test cases for a ticket. */
export const capTests = (list, r) => (list || []).slice(0, r.tests.perTicket);
