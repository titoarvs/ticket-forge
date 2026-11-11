// AI for the test repository (Test management): writes repository tests for issues, and improves one test, following
// the company's test standard (Administration → Generation → Test management). Nothing is saved here.
import { askJson } from './claude.js';
import { getRules, getGuide, guideBlock, rulesText } from './genrules.js';

const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const SHAPE = `{ "title": "…", "type": "Manual|Cucumber", "priority": "High|Medium|Low", "labels": ["…"], "preconditions": "…",
  "steps": [ { "action": "…", "data": "…", "expected": "…" } ],   // for step tests
  "gherkin": "Scenario: …\\n  Given …\\n  When …\\n  Then …"    // for Cucumber tests
}`;
async function system() {
  const rules = await getRules();
  return { rules, text: `You are a senior QA engineer writing reusable tests for a test repository (like Xray for Jira or BrowserStack Test Management).
Follow the company's test standard exactly:
${rulesText(rules, 'testmgmt')}
Never invent features the issue doesn't describe. Return JSON only.${guideBlock(await getGuide(), ['tests'])}` };
}
function clean(t, rules) {
  const m = rules.testmgmt;
  const allowed = new Set(String(m.labels || '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean));
  const type = t.type === 'Cucumber' || (m.format === 'gherkin') ? 'Cucumber' : 'Manual';
  return {
    title: clip(t.title, 200), type, priority: ['High', 'Medium', 'Low'].includes(t.priority) ? t.priority : 'Medium',
    labels: (Array.isArray(t.labels) ? t.labels : []).map((x) => String(x).toLowerCase().trim()).filter((x) => x && (!allowed.size || allowed.has(x))).slice(0, 5),
    preconditions: clip(t.preconditions || '', 600),
    steps: type === 'Cucumber' ? [] : (Array.isArray(t.steps) ? t.steps : []).slice(0, m.stepsMax).map((st) => ({ action: clip(st.action, 300), data: clip(st.data || '', 200), expected: clip(st.expected || '', 400) })).filter((st) => st.action),
    gherkin: type === 'Cucumber' ? clip(t.gherkin || '', 3000) : '',
  };
}

/** Repository tests for each issue (in parallel). Returns { results: [{ ticketId, key, tests: [...] , error }] }. */
export async function writeRepoTests({ project, issueIds, instruction = '', ai = {}, emit = (_e) => {} }) {
  const { rules, text } = await system();
  const repo = project.testRepo || { tests: [] };
  const issues = issueIds.map((id) => project.tickets.find((t) => t.id === id)).filter(Boolean);
  const results = [];
  let done = 0;
  const queue = [...issues];
  const worker = async () => {
    while (queue.length) {
      if (ai.signal?.aborted) return;
      const t = queue.shift();
      emit({ type: 'progress', message: `Writing tests for ${t.key}`, done, total: issues.length });
      const epic = project.epics.find((e) => e.id === t.epicId);
      const existing = repo.tests.filter((x) => x.issueIds?.includes(t.id)).map((x) => `- ${x.key} ${x.title}`).join('\n');
      try {
        const res = await askJson({ ...ai, task: 'tests', reasoning: rules.reasoning, system: text, prompt: `Write repository tests for this issue.

PROJECT: ${project.name}${epic ? `\nEPIC: ${epic.key} ${epic.title}` : ''}
ISSUE ${t.key} [${t.type}, ${t.status}]: ${t.title}
User story: ${clip(t.userStory, 600) || 'n/a'}
Description: ${clip(t.description, 2000) || 'n/a'}
Acceptance criteria:
${(t.acceptanceCriteria || []).map((a, i) => `AC${i + 1}. ${clip(a, 300)}`).join('\n') || 'n/a'}
${existing ? `\nTESTS THAT ALREADY COVER IT (don't duplicate them):\n${existing}\n` : ''}${instruction ? `\nInstructions for this run: ${clip(instruction, 1500)}\n` : ''}
Return JSON: { "tests": [ ${SHAPE} ] }` });
        results.push({ ticketId: t.id, key: t.key, title: t.title, tests: (res.tests || []).map((x) => clean(x, rules)).filter((x) => x.title && (x.steps.length || x.gherkin)).slice(0, Math.max(rules.testmgmt.perIssue + 2, 3)) });
      } catch (e) {
        if (ai.signal?.aborted) return;
        results.push({ ticketId: t.id, key: t.key, title: t.title, tests: [], error: clip(e.message, 300) });
      }
      done++;
      emit({ type: 'progress', message: `${done} of ${issues.length} issues done`, done, total: issues.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, issues.length) }, worker));
  const order = new Map(issueIds.map((id, i) => [id, i]));
  return { results: results.sort((a, b) => order.get(a.ticketId) - order.get(b.ticketId)) };
}

/** One test rewritten to the standard (or as the instruction says: convert to Gherkin, add negative steps…). */
export async function improveRepoTest({ project, test, instruction = '', ai = {} }) {
  const { rules, text } = await system();
  const issues = (test.issueIds || []).map((id) => project.tickets.find((t) => t.id === id)).filter(Boolean);
  const res = await askJson({ ...ai, task: 'tests', reasoning: rules.reasoning, system: text, prompt: `Improve this repository test so it meets the company standard${instruction ? ` and this instruction: "${clip(instruction, 800)}"` : ''}. Keep what it proves.

TEST ${test.key || ''}: ${test.title}
Type: ${test.type} · Priority: ${test.priority} · Labels: ${(test.labels || []).join(', ') || 'none'}
Preconditions: ${test.preconditions || 'none'}
${test.type === 'Cucumber' ? `Gherkin:\n${test.gherkin || ''}` : `Steps:\n${(test.steps || []).map((s, i) => `${i + 1}. ${s.action}${s.data ? ` [data: ${s.data}]` : ''} → ${s.expected || '—'}`).join('\n')}`}

ISSUES IT COVERS:
${issues.map((t) => `${t.key} ${t.title}\n  AC: ${(t.acceptanceCriteria || []).slice(0, 6).map((a) => clip(a, 160)).join(' | ')}`).join('\n') || 'none'}

Return JSON: { "test": ${SHAPE}, "changes": "one or two sentences: what you changed" }` });
  return { test: clean(res.test || {}, rules), changes: clip(res.changes || '', 400) };
}
