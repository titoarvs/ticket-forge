// Self-healing Agent: when an automated test fails because the page changed (a renamed button, a
// moved field, a new step, a missing wait on an assertion), it reads the page as it was at the
// failure and rewrites the script. The caller re-runs the healed script once and keeps it only if
// it passes. Real product bugs are never "healed": the agent must not change what the test proves
// (its assertions on the expected result).
import { askJson } from './claude';
import { agentInstructions } from './agents';
import { contextBlock } from './appcontext';

const clip = (s, n) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
/** Failures the agent can't help with: no script, stopped, the browser or app unreachable. */
export const healable = (r) =>
  r &&
  r.status !== 'Pass' &&
  r.page &&
  !/No automation script|Run stopped|Couldn’t connect|ERR_CONNECTION|net::ERR|ECONNREFUSED|Target page, context or browser has been closed/i.test(
    r.error || '',
  );

const SYSTEM = `You are a Playwright test-maintenance engineer (a self-healing agent, like BrowserStack's).
A test script failed. Decide if it failed because the SCRIPT no longer matches the page (renamed or moved element,
changed label, extra dialog or step, a click before the element is ready, a brittle CSS/XPath locator) or because the
APP is wrong (the expected result isn't there, wrong value, error message, missing feature).
- Script problem: rewrite the script so it does the same test-case steps on the page as it is now. Use the page's
  real elements: getByRole / getByLabel / getByText / getByTestId. Keep every assertion on the expected result
  exactly as strict (same values and texts). Rely on Playwright's auto-waiting assertions, never fixed waits.
- App problem, or not sure: do NOT heal. Return healable false with the reason.
Never weaken, remove or loosen an assertion to make a test pass. Return JSON only.`;

/** Returns { healable, reason, code }. */
export async function healScript({ ticket, tc, result, baseUrl, project, ai = {} }: any) {
  const steps = Array.isArray(tc.steps)
    ? tc.steps.map((s, i) => `${i + 1}. ${typeof s === 'string' ? s : s?.action || ''}`).join('\n')
    : String(tc.steps || '');
  const res = await askJson({
    ...ai,
    task: 'healing',
    reasoning: 'fast',
    system: SYSTEM + (await agentInstructions('self-healing')) + contextBlock(project),
    prompt: `App: ${project?.name || ''} at ${baseUrl}
Issue ${ticket.key}: ${ticket.title}
Acceptance criteria:
${(ticket.acceptanceCriteria || []).map((a, i) => `AC${i + 1}. ${clip(a, 200)}`).join('\n') || '(none)'}

Test case: ${tc.title}
Steps:
${clip(steps, 1500)}
Expected: ${clip(tc.expected, 500)}

Script that failed (body of async ({ page, expect, baseURL, app }: any) => { … }; app.loginAs(role) signs in):
${clip(tc.script, 5000)}

Error:
${clip(result.error, 2000)}

Page at the failure: ${result.page?.url || '?'} (title "${clip(result.page?.title, 100)}")
Visible text:
${clip(result.page?.text, 1500)}
Interactive elements (tag[role][type][data-testid] "accessible name"):
${clip(result.page?.elements, 5000) || '(not captured)'}
${
  result.logs?.length
    ? `\nBrowser log:\n${result.logs
        .slice(-15)
        .map((l) => `- ${clip(l, 200)}`)
        .join('\n')}`
    : ''
}

Return JSON: { "healable": true | false, "reason": "one sentence: what changed on the page, or why it's an app problem", "code": "the full repaired script body, only when healable" }`,
  });
  const code = String(res.code || '')
    .replace(/^```(?:js|javascript|ts)?\s*|```\s*$/g, '')
    .trim();
  return {
    healable: Boolean(res.healable) && code.length > 20 && code !== String(tc.script || '').trim(),
    reason: clip(res.reason, 300),
    code,
  };
}
