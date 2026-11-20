// Generation rules: the team's standard for tickets, test cases and automation scripts, set by an
// administrator in Administration → Generation. Every generation gets them as instructions; a few
// are also enforced in code (story points, ticket types, labels, test-case count and titles) so
// results stay consistent.
import { getMeta, setMeta, deleteMeta } from './appmeta';
import { wsKey, wsCache } from './wsmeta';

export const TICKET_TYPES = ['Story', 'Task', 'Bug', 'Spike'];
export const REASONING = ['fast', 'balanced', 'thorough'];

export const DEFAULT_RULES = {
  reasoning: 'fast', // fast: no extended thinking, low effort. Consistent and quick.
  stickToDocument: true,
  tickets: {
    titleMaxWords: 10,
    userStory: true,
    acFormat: 'gwt', // gwt: Given/When/Then · checklist: short testable statements
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
  // Test management (the test repository and test plans): how repository tests are written and
  // plans are built. `standard` names the corporate standard the fields started from (istqb, xray,
  // bdd, browserstack, custom).
  testmgmt: {
    standard: 'xray',
    format: 'steps', // steps · gherkin · both (Gherkin for user-facing behaviour, steps for the rest)
    titleFormat: 'Verify <behaviour> when <condition>',
    perIssue: 4,
    stepsMin: 2,
    stepsMax: 8,
    expectedEveryStep: true,
    testData: true,
    preconditions: true,
    gherkinStyle: 'declarative', // declarative (business language) · imperative (UI actions)
    priorityRule:
      'High: money, security, legal or data loss. Medium: core flows. Low: cosmetic or rare.',
    labels: 'smoke, regression, security, ui, api, integration, negative, edge',
    planRules:
      'A smoke plan has at most 15 tests. A regression plan includes every High-priority test in scope.',
    custom: '',
  },
  custom: '',
};
export const TM_FORMATS = ['steps', 'gherkin', 'both'];

const int = (v, lo, hi, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const text = (v, max, d = '') => (typeof v === 'string' ? v.trim().slice(0, max) : d);

/** Fills gaps with defaults and keeps every value in range. */
export function normalizeRules(r: any = {}) {
  const D = DEFAULT_RULES,
    t = r.tickets || {},
    s = r.tests || {},
    a = r.automation || {};
  const scale = (
    Array.isArray(t.pointScale) ? t.pointScale : String(t.pointScale ?? '').split(/[\s,]+/)
  )
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
  const pointScale: any = scale.length
    ? [...new Set(scale)].sort((x: any, y: any) => x - y)
    : D.tickets.pointScale;
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
      maxPoints: int(
        t.maxPoints,
        pointScale[0],
        pointScale[pointScale.length - 1],
        Math.min(D.tickets.maxPoints, pointScale[pointScale.length - 1]),
      ),
      types: types.length ? types : D.tickets.types,
      defaultPriority: ['Highest', 'High', 'Medium', 'Low'].includes(t.defaultPriority)
        ? t.defaultPriority
        : D.tickets.defaultPriority,
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
      testDataPrefix: text(a.testDataPrefix, 20, D.automation.testDataPrefix).replace(
        /[^\w-]/g,
        '',
      ),
      oneFlow: bool(a.oneFlow, D.automation.oneFlow),
    },
    testmgmt: (() => {
      const m = r.testmgmt || {},
        T = D.testmgmt;
      const stepsMin = int(m.stepsMin, 1, 30, T.stepsMin);
      return {
        standard: ['istqb', 'xray', 'bdd', 'browserstack', 'custom'].includes(m.standard)
          ? m.standard
          : T.standard,
        format: TM_FORMATS.includes(m.format) ? m.format : T.format,
        titleFormat: text(m.titleFormat, 120, T.titleFormat),
        perIssue: int(m.perIssue, 1, 20, T.perIssue),
        stepsMin,
        stepsMax: Math.max(stepsMin, int(m.stepsMax, 1, 40, T.stepsMax)),
        expectedEveryStep: bool(m.expectedEveryStep, T.expectedEveryStep),
        testData: bool(m.testData, T.testData),
        preconditions: bool(m.preconditions, T.preconditions),
        gherkinStyle: m.gherkinStyle === 'imperative' ? 'imperative' : 'declarative',
        priorityRule: text(m.priorityRule, 600, T.priorityRule),
        labels: text(m.labels, 400, T.labels),
        planRules: text(m.planRules, 1500, T.planRules),
        custom: text(m.custom, 3000, ''),
      };
    })(),
    custom: text(r.custom, 3000, ''),
  };
}

// ---------------------------------------------------------------- storage
const KEY = 'generation_rules';
const C: any = wsCache('__tfRulesWs', () => ({ v: undefined, at: 0, meta: null }));

/** The rules in force (defaults until an administrator saves some). */
export async function getRules({ fresh = false }: any = {}) {
  if (!fresh && C.v !== undefined && Date.now() - C.at < 30000) return C.v;
  let saved = null;
  try {
    saved = (await getMeta(wsKey(KEY))) || null;
  } catch {
    /* database not ready */
  }
  C.v = normalizeRules(saved?.rules || {});
  C.meta = saved
    ? { updatedBy: saved.updatedBy || null, updatedAt: saved.updatedAt || null }
    : null;
  C.at = Date.now();
  return C.v;
}
export async function rulesMeta() {
  await getRules();
  return C.meta;
}
export async function saveRules(actor, rules) {
  const v = normalizeRules(rules);
  await setMeta(wsKey(KEY), {
    rules: v,
    updatedBy: actor?.name || null,
    updatedAt: new Date().toISOString(),
  });
  C.v = v;
  C.meta = { updatedBy: actor?.name || null, updatedAt: new Date().toISOString() };
  C.at = Date.now();
  return v;
}
export async function resetRules() {
  await deleteMeta(wsKey(KEY));
  C.v = normalizeRules({});
  C.meta = null;
  C.at = Date.now();
  return C.v;
}

// ---------------------------------------------------------------- rules as instructions
const list = (xs) =>
  xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '';

/** The rules as plain instructions for the AI. part: 'tickets' | 'tests' | 'automation'. */
export function rulesText(r, part) {
  const out: any[] = [];
  if (part === 'tickets') {
    const t = r.tickets;
    if (r.stickToDocument)
      out.push(
        'Only include what the document asks for: no extra features, nice-to-haves or speculative tickets. Put anything unclear in openQuestions.',
      );
    out.push(`Titles: imperative, at most ${t.titleMaxWords} words (e.g. "Export orders to CSV").`);
    out.push(
      t.userStory
        ? 'User story: "As a <role>, I want <goal>, so that <benefit>." on every Story.'
        : 'Leave userStory empty.',
    );
    out.push(
      `Acceptance criteria: ${t.acMin}-${t.acMax} per ticket, ${t.acFormat === 'gwt' ? 'each one "Given …, when …, then …"' : 'each a short, testable statement (no Given/When/Then)'}.`,
    );
    out.push(
      `Story points: only ${t.pointScale.join(', ')}. Anything bigger than ${t.maxPoints} must be split into smaller tickets.`,
    );
    out.push(`Ticket types: only ${list(t.types)}.`);
    out.push(`Priority: ${t.defaultPriority} unless the document clearly says otherwise.`);
    if (t.descriptionSections)
      out.push(
        `Description: short sections in this order: ${t.descriptionSections} (one or two lines each, "Section: text").`,
      );
    out.push(
      t.maxLabels ? `Labels: at most ${t.maxLabels}, lowercase, one word each.` : 'No labels.',
    );
  }
  if (part === 'tests') {
    const s = r.tests;
    const kinds = [
      s.positive && 'one positive (happy path)',
      s.negative && 'one negative (invalid input or not allowed)',
      s.edge && 'one edge case',
    ].filter(Boolean);
    out.push(
      `Exactly ${s.perTicket} test case${s.perTicket === 1 ? '' : 's'} per ticket${kinds.length ? `, including at least ${list(kinds.slice(0, s.perTicket))}` : ''}. Cover every acceptance criterion across them.`,
    );
    if (s.titlePrefix)
      out.push(
        `Test titles start with "${s.titlePrefix} …" (e.g. "${s.titlePrefix} a cashier can open an order").`,
      );
    out.push(
      `Steps: one user action per step, imperative ("Click Save"), at most ${s.maxSteps} steps.`,
    );
    out.push('Expected result: one observable outcome the user sees.');
    out.push(
      s.preconditions
        ? 'Always fill preconditions (write "None" if there are none).'
        : 'Leave preconditions empty unless essential.',
    );
  }
  if (part === 'automation') {
    const a = r.automation;
    if (a.roleLocators)
      out.push(
        'Locators, in this order: getByRole, getByLabel, getByPlaceholder, getByText, getByTestId; CSS only as a last resort.',
      );
    if (a.noHardWaits)
      out.push('Never use page.waitForTimeout or fixed sleeps; rely on web-first assertions.');
    if (a.testDataPrefix)
      out.push(`Name any data the test creates "${a.testDataPrefix}-" + Date.now().`);
    if (a.oneFlow) out.push('Script only the flow the test case describes; no extra checks.');
  }
  if (part === 'testmgmt') {
    const m = r.testmgmt;
    const STD = {
      istqb: 'ISTQB test-case conventions',
      xray: 'the Xray for Jira test format',
      bdd: 'BDD / Cucumber (Gherkin) practice',
      browserstack: 'BrowserStack Test Management conventions',
      custom: 'the company standard below',
    };
    out.push(`Write repository tests to ${STD[m.standard] || STD.custom}.`);
    out.push(
      m.format === 'gherkin'
        ? `Format: every test is a Gherkin scenario (type "Cucumber"): Scenario, Given, When, Then (And/But allowed), ${m.gherkinStyle === 'declarative' ? 'declarative business language, no UI clicks' : 'imperative steps naming the UI actions'}.`
        : m.format === 'both'
          ? `Format: user-facing behaviour as Gherkin scenarios (type "Cucumber", ${m.gherkinStyle} style); technical, API or data checks as step tables (type "Manual").`
          : 'Format: step tables (type "Manual"): each step has an action, test data and an expected result.',
    );
    if (m.titleFormat) out.push(`Titles follow the pattern "${m.titleFormat}".`);
    if (m.format !== 'gherkin') {
      out.push(`Steps: ${m.stepsMin}-${m.stepsMax} per test, one action each, imperative.`);
      out.push(
        m.expectedEveryStep
          ? 'Every step has its own expected result.'
          : 'Only the final step needs an expected result.',
      );
      out.push(
        m.testData
          ? 'Put concrete test data (values, accounts, amounts) in the Data column, never inside the action.'
          : 'Leave the Data column empty unless a value is essential.',
      );
    }
    out.push(
      m.preconditions
        ? 'Always state preconditions (the state before the test).'
        : 'Preconditions only when essential.',
    );
    out.push(
      `Write about ${m.perIssue} tests per issue: the main flow, then negative and edge cases, covering every acceptance criterion.`,
    );
    if (m.priorityRule) out.push(`Priority: ${m.priorityRule}`);
    if (m.labels) out.push(`Labels: only from this list: ${m.labels}.`);
    if (m.custom) out.push(`Company rules: ${m.custom}`);
  }
  if (part === 'testplan') {
    const m = r.testmgmt;
    if (m.planRules) out.push(`Plan rules: ${m.planRules}`);
    if (m.custom) out.push(`Company rules: ${m.custom}`);
  }
  if (r.custom && !['automation', 'testmgmt', 'testplan'].includes(part))
    out.push(`Team rules: ${r.custom}`);
  return out.map((x) => `- ${x}`).join('\n');
}

/** What every generation of tickets and test cases is told: be direct, follow the rules exactly. */
export function standardsBlock(r, parts = ['tickets', 'tests']) {
  const lines = [...new Set(parts.flatMap((p) => rulesText(r, p).split('\n')).filter(Boolean))];
  return `Team standards. Follow them exactly and answer directly; don't deliberate over alternatives:\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------- enforced in code
const nearest = (n, scale) =>
  scale.reduce((b, x) => (Math.abs(x - n) < Math.abs(b - n) ? x : b), scale[0]);
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Story points on the scale, allowed types, default priority, labels, test-case count and titles.
 */
export function applyTicketRules(t, r) {
  const R = r.tickets;
  const out = { ...t };
  if (Number.isFinite(out.storyPoints) && out.storyPoints > 0)
    out.storyPoints = nearest(out.storyPoints, R.pointScale);
  if (out.type !== 'Sub-task' && !R.types.includes(out.type))
    out.type = R.types.includes('Story') ? 'Story' : R.types[0];
  if (!out.priority) out.priority = R.defaultPriority;
  out.labels = (out.labels || [])
    .map((l) => String(l).toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean)
    .slice(0, R.maxLabels);
  if (Array.isArray(out.testCases))
    out.testCases = out.testCases.map((tc) => applyTestRules(tc, r));
  return out;
}
export function applyTestRules(tc, r) {
  const p = r.tests.titlePrefix;
  if (!p || !tc.title) return tc;
  if (tc.title.toLowerCase().startsWith(p.toLowerCase()))
    return { ...tc, title: p + tc.title.slice(p.length) };
  return { ...tc, title: `${p} ${lowerFirst(tc.title)}` };
}
/** Keeps at most the standard number of test cases for a ticket. */
export const capTests = (list, r) => (list || []).slice(0, r.tests.perTicket);

// ---------------------------------------------------------------- generation guide (Markdown) An
// administrator can import a Markdown document (glossary, conventions, example tickets and test
// cases) that the AI gets as reference context, so wording and structure match the team's way of
// working.
export const GUIDE_MAX = 60000;
const GUIDE_KEY = 'generation_guide';
const GC: any = wsCache('__tfGuideWs');
const cleanApply = (a: any = {}) => ({
  tickets: a.tickets !== false,
  tests: a.tests !== false,
  automation: a.automation === true,
});

/**
 * The guide in force, or null: { text, name, chars, applyTo: { tickets, tests, automation },
 * updatedBy, updatedAt }.
 */
export async function getGuide({ fresh = false }: any = {}) {
  if (!fresh && GC.v !== undefined && Date.now() - GC.at < 30000) return GC.v;
  let v = null;
  try {
    v = (await getMeta(wsKey(GUIDE_KEY))) || null;
  } catch {
    /* database not ready */
  }
  GC.v = v?.text ? { ...v, applyTo: cleanApply(v.applyTo), chars: v.text.length } : null;
  GC.at = Date.now();
  return GC.v;
}
export async function saveGuide(actor, { text, name, applyTo }: any) {
  const t = String(text || '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!t) throw Object.assign(new Error('The guide is empty.'), { status: 400 });
  if (t.length > GUIDE_MAX)
    throw Object.assign(
      new Error(
        `The guide is too long (${t.length.toLocaleString()} characters; the limit is ${GUIDE_MAX.toLocaleString()}). Shorten it so the AI can use all of it.`,
      ),
      { status: 400 },
    );
  const v = {
    text: t,
    name: String(name || 'generation-guide.md').slice(0, 120),
    applyTo: cleanApply(applyTo),
    updatedBy: actor?.name || null,
    updatedAt: new Date().toISOString(),
  };
  await setMeta(wsKey(GUIDE_KEY), v);
  GC.v = { ...v, chars: t.length };
  GC.at = Date.now();
  return GC.v;
}
export async function clearGuide() {
  await deleteMeta(wsKey(GUIDE_KEY));
  GC.v = null;
  GC.at = Date.now();
}
/**
 * The guide as AI context, when it applies to any of `parts` ('tickets' | 'tests' | 'automation').
 */
export function guideBlock(guide, parts) {
  if (!guide?.text || !parts.some((p) => guide.applyTo?.[p])) return '';
  return `\n\nTeam generation guide (Markdown). Use it as the reference for terms, wording, structure and examples, and keep your output uniform with it. Where it conflicts with the team standards above, the standards win:\n<guide name="${guide.name}">\n${guide.text}\n</guide>`;
}
