// Failure analysis: when automated tests fail, the AI reads each failure (error, the script, the test case, the page it
// ended on, browser logs) and writes a detailed note for the issue's comment: what failed, the likely cause, whether it's
// a product bug or the test, the evidence, and what to do next. Uses the "failure" task, a light model tier by default
// (Administration → AI → Model routing), so it costs little.
import { askJson } from './claude';
import { contextBlock } from './appcontext';

const clip = (s, n) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
export const CATEGORIES = {
  'app-bug': 'Product bug',
  'test-script': 'Test script',
  'test-data': 'Test data',
  environment: 'Environment',
  flaky: 'Flaky / timing',
  'needs-info': 'Needs a look',
};
const OWNER = { 'app-bug': 'developer', 'test-script': 'qa', 'test-data': 'qa', environment: 'devops', flaky: 'qa', 'needs-info': 'qa' };

const SYSTEM = `You are a senior QA automation engineer triaging failed Playwright end-to-end tests.
For each failure, decide from the evidence whether the PRODUCT is wrong (it doesn't meet the test case / acceptance criteria),
the TEST SCRIPT is wrong (bad locator, wrong step order, wrong assertion, missing wait on an assertion), the TEST DATA or
account is wrong, the ENVIRONMENT is the problem (app down, 5xx, network, sign-in, timeouts loading), or it looks FLAKY.
Be specific and concrete: quote the failing locator or assertion, name the page and element, and point to the log line.
Never invent facts that aren't in the evidence; when unsure, say what to check. Plain, short sentences. Return JSON only.`;

function evidence({ ticket, tc, result }: any) {
  const steps = Array.isArray(tc.steps)
    ? tc.steps.map((s, i) => `${i + 1}. ${typeof s === 'string' ? s : s?.action || ''}`).join('\n')
    : String(tc.steps || '');
  return `Issue ${ticket.key}: ${ticket.title}
Acceptance criteria:
${(ticket.acceptanceCriteria || []).map((a, i) => `AC${i + 1}. ${clip(a, 240)}`).join('\n') || '(none)'}

Test case: ${tc.title}
Preconditions: ${clip(tc.preconditions, 400) || '(none)'}
Steps:
${clip(steps, 1500)}
Expected: ${clip(tc.expected, 600)}

Playwright script that ran:
${clip(tc.script, 3500) || '(no script)'}

Error (${result.attempts > 1 ? `failed ${result.attempts} attempts` : 'first attempt'}, after ${Math.round((result.durationMs || 0) / 100) / 10}s):
${clip(result.error, 2500)}
${result.page ? `\nPage when it failed: ${result.page.url} (title "${clip(result.page.title, 120)}")\nVisible text:\n${clip(result.page.text, 1200)}` : ''}
${
  result.logs?.length
    ? `\nBrowser log (console, page errors, failed requests, 5xx):\n${result.logs
        .slice(-25)
        .map((l) => `- ${clip(l, 240)}`)
        .join('\n')}`
    : ''
}`;
}

function clean(a) {
  const category = CATEGORIES[a?.category] ? a.category : 'needs-info';
  const list = (v, n) =>
    (Array.isArray(v) ? v : [])
      .map((x) => clip(x, 400))
      .filter(Boolean)
      .slice(0, n);
  return {
    category,
    label: CATEGORIES[category],
    owner: ['developer', 'qa', 'devops'].includes(a?.owner) ? a.owner : OWNER[category],
    confidence: ['high', 'medium', 'low'].includes(a?.confidence) ? a.confidence : 'medium',
    summary: clip(a?.summary, 300),
    failedStep: clip(a?.failedStep, 300),
    cause: clip(a?.cause, 900),
    expected: clip(a?.expected, 400),
    actual: clip(a?.actual, 400),
    evidence: list(a?.evidence, 5),
    fix: clip(a?.fix, 900),
    nextSteps: list(a?.nextSteps, 5),
    scriptFix: clip(a?.scriptFix, 1500),
  };
}

/**
 * failures: [{ ticket, tc, result }] for ONE issue. Returns Map(tcId -> analysis). Failures without a script or that
 * were stopped get no analysis. Errors are swallowed: the plain report still goes out.
 */
export async function analyzeFailures({ project, failures, ai = {} }: any) {
  const out: any = new Map();
  const todo = failures.filter((f) => f.tc?.script && !/^Run stopped/.test(f.result?.error || ''));
  if (!todo.length) return out;
  const ticket = todo[0].ticket;
  const prompt = `Application: ${project?.name || ''}${project?.summary ? ` — ${clip(project.summary, 300)}` : ''}
${todo.length} automated test${todo.length > 1 ? 's' : ''} failed for this issue. Analyse each one.

${todo.map((f, i) => `=============== FAILURE ${i} ===============\n${evidence(f)}`).join('\n\n')}

Return JSON: { "analyses": [ {
  "index": 0,
  "category": "app-bug | test-script | test-data | environment | flaky | needs-info",
  "confidence": "high | medium | low",
  "owner": "developer | qa | devops",
  "summary": "one sentence: what went wrong, for the issue's comment",
  "failedStep": "the test-case step (or script line) where it broke",
  "expected": "what should have happened",
  "actual": "what happened instead, from the error / page / logs",
  "cause": "the most likely root cause, 1-3 sentences, specific",
  "evidence": ["the exact error, locator, log line or page text that shows it"],
  "fix": "what to change: in the product (for a bug) or in the test",
  "scriptFix": "for test-script problems only: the corrected lines of the script, else empty",
  "nextSteps": ["short, concrete actions in order"]
} ] }`;
  try {
    const res = await askJson({
      ...ai,
      task: 'failure',
      reasoning: 'fast',
      system: SYSTEM + contextBlock(project, { short: true }),
      prompt,
    });
    for (const a of res.analyses || []) {
      const f = todo[Number(a.index)];
      if (f) out.set(f.tc.id, clean(a));
    }
  } catch (e) {
    if (ai.signal?.aborted) return out;
    out.error = e.message;
  }
  void ticket;
  return out;
}

/** The analysis as plain text, for the comment body, email and notifications. */
export function analysisText(a) {
  if (!a) return '';
  return [
    `  ${a.label} (${a.confidence} confidence) — ${a.summary}`,
    a.failedStep && `  Failed at: ${a.failedStep}`,
    a.expected && `  Expected: ${a.expected}`,
    a.actual && `  Actual: ${a.actual}`,
    a.cause && `  Likely cause: ${a.cause}`,
    a.evidence.length && `  Evidence: ${a.evidence.join(' · ')}`,
    a.fix && `  Fix: ${a.fix}`,
    a.nextSteps.length && `  Next: ${a.nextSteps.map((s, i) => `${i + 1}) ${s}`).join(' ')}`,
  ]
    .filter(Boolean)
    .join('\n');
}
