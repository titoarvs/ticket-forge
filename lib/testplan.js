// Test plans built with AI (Test management → Test plans → Build plan with AI): from the project's test repository the AI
// picks the tests that fit a goal (smoke, regression, an epic, a sprint, retesting failures…), ordered by risk, with a
// reason each, and lists the issues in scope that no test covers. Nothing is saved here.
import { askJson } from './claude.js';
import { getRules, rulesText } from './genrules.js';
import { contextBlock } from './appcontext.js';

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const KINDS = {
  smoke: 'a SMOKE plan: the few tests that prove the most important flows still work end to end (sign-in, the main happy paths). Small and fast.',
  regression: 'a REGRESSION plan: broad coverage of the scope, favouring high-priority tests, tests of areas that changed or failed before, security and integration tests; skip near-duplicates.',
  feature: 'a FEATURE plan for the chosen epic(s): every acceptance-relevant test of their issues, happy paths first, then negative and edge cases.',
  sprint: 'a SPRINT plan: the tests covering the issues in the chosen sprint, especially those done or in review.',
  retest: 'a RETEST plan: tests that failed or were blocked last time, plus closely related tests of the same issues.',
  custom: 'a plan for the goal described below.',
};

/** Latest result of each test across executions. */
function latest(repo) {
  const out = {};
  for (const e of [...(repo.executions || [])].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
    for (const [id, r] of Object.entries(e.runs || {})) if (r && r.status && r.status !== 'TODO') out[id] = r.status;
  }
  return out;
}

export async function buildTestPlan({ project, kind = 'regression', goal = '', epicIds = [], sprintId = '', maxTests = 40, ai = {} }) {
  const repo = project.testRepo || { tests: [], executions: [] };
  if (!repo.tests?.length) throw Object.assign(new Error('The test repository is empty: add or import tests first.'), { status: 400 });
  const byId = new Map(project.tickets.map((t) => [t.id, t]));
  const epicOf = (t) => project.epics.find((e) => e.id === t?.epicId);
  const inScopeIssue = (t) => t && (!epicIds.length || epicIds.includes(t.epicId)) && (!sprintId || t.sprintId === sprintId);
  const last = latest(repo);
  const scoped = repo.tests.filter((t) => {
    const issues = (t.issueIds || []).map((id) => byId.get(id)).filter(Boolean);
    if (!epicIds.length && !sprintId) return true;
    return issues.some(inScopeIssue);
  }).filter((t) => kind !== 'retest' || ['FAILED', 'BLOCKED'].includes(last[t.id]) || (t.issueIds || []).some((id) => repo.tests.some((o) => o.issueIds?.includes(id) && ['FAILED', 'BLOCKED'].includes(last[o.id]))));
  if (!scoped.length) throw Object.assign(new Error(kind === 'retest' ? 'Nothing failed or was blocked in the scope yet.' : 'No tests cover the chosen scope.'), { status: 400 });
  const scopeIssues = project.tickets.filter((t) => !t.parentId && (epicIds.length || sprintId ? inScopeIssue(t) : true));
  const catalog = scoped.slice(0, 600).map((t) => {
    const issues = (t.issueIds || []).map((id) => byId.get(id)).filter(Boolean);
    return `${t.key} | ${clip(t.title, 140)} | ${t.type || 'Manual'}, ${t.priority || 'Medium'}${t.labels?.length ? `, ${t.labels.join('/')}` : ''} | ${issues.map((x) => `${x.key}[${x.status}${epicOf(x) ? `, ${epicOf(x).key}` : ''}]`).join(' ') || 'no issue'} | last: ${last[t.id] || 'never run'}`;
  }).join('\n');
  const rules = await getRules();
  const res = await askJson({ ...ai, task: 'plan', reasoning: rules.reasoning === 'fast' ? 'balanced' : rules.reasoning,
    system: `You are a QA lead building a test plan from an existing test repository. You only choose from the tests listed; never invent tests.
Order the chosen tests by risk and value (most important first). Give a short, specific reason for each. Return JSON only.
${rulesText(rules, 'testplan') ? ` + contextBlock(project)Follow the company's rules for plans:\n${rulesText(rules, 'testplan')}` : ''}`,
    prompt: `PROJECT: ${project.name}
SCOPE: ${epicIds.length ? `epics ${epicIds.map((id) => { const e = project.epics.find((x) => x.id === id); return e ? `${e.key} ${e.title}` : id; }).join('; ')}` : 'the whole project'}${sprintId ? `, sprint ${(project.sprints || []).find((s) => s.id === sprintId)?.name || ''}` : ''}

Build ${KINDS[kind] || KINDS.custom}
${goal ? `Goal from the team: ${clip(goal, 1500)}` : ''}
At most ${maxTests} tests.

TESTS (key | title | type, priority, labels | issues covered [status, epic] | last result):
${catalog}

ISSUES IN SCOPE (to find gaps):
${scopeIssues.slice(0, 200).map((x) => `${x.key} [${x.status}] ${clip(x.title, 100)}`).join('\n')}

Return JSON: { "title": "short plan title", "description": "1–2 sentences: what this plan proves and when to run it",
"tests": [ { "key": "…", "why": "…" } ],
"gaps": [ { "issue": "ISSUE-KEY", "why": "what isn't covered" } ] }  (gaps: in-scope issues that matter for this plan but no listed test covers; at most 10)` });
  const byKey = new Map(repo.tests.map((t) => [t.key, t]));
  const seen = new Set();
  const tests = (res.tests || []).map((x) => ({ t: byKey.get(String(x.key)), why: clip(x.why, 240) })).filter((x) => x.t && !seen.has(x.t.id) && seen.add(x.t.id)).slice(0, maxTests)
    .map((x) => ({ id: x.t.id, key: x.t.key, why: x.why }));
  const issueByKey = new Map(project.tickets.map((t) => [t.key, t]));
  const gaps = (res.gaps || []).map((g) => ({ t: issueByKey.get(String(g.issue)), why: clip(g.why, 240) })).filter((g) => g.t && !repo.tests.some((x) => x.issueIds?.includes(g.t.id) && seen.has(x.id)))
    .slice(0, 10).map((g) => ({ id: g.t.id, key: g.t.key, title: g.t.title, why: g.why }));
  return { title: clip(res.title || 'Test plan', 120), description: clip(res.description || '', 600), tests, gaps, considered: scoped.length };
}
