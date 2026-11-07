// Test automation: Claude turns test cases into Playwright scripts, which run in a real
// (headless) Chromium against the app under test. Each script runs in its own process.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { askJson } from './claude.js';
import { ROOT, DATA_DIR } from './db.js';

export const RUN_DIR = path.join(DATA_DIR, 'runs');
fs.mkdirSync(RUN_DIR, { recursive: true });
const RUNNER = path.join(ROOT, 'lib', 'runner.mjs');

export async function engineStatus() {
  try {
    const { chromium } = await import('@playwright/test');
    const exe = chromium.executablePath();
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', '@playwright', 'test', 'package.json'), 'utf8'));
    return { installed: true, browser: fs.existsSync(exe), version: pkg.version };
  } catch {
    return { installed: false, browser: false, version: null };
  }
}

/** Streams `npx playwright install chromium` output lines to onLine. */
export function installBrowser(onLine) {
  return new Promise((resolve, reject) => {
    const cli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
    const child = spawn(/*turbopackIgnore: true*/ process.execPath, [cli, 'install', 'chromium'], { cwd: ROOT });
    const pipe = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => onLine(l));
    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Browser install exited with code ${code}`))));
  });
}

/** A compact description of the page so Claude can pick real selectors. */
export async function snapshotPage(url) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const title = await page.title();
    const elements = await page.locator('a, button, input, select, textarea, label, h1, h2, h3, [role], [data-testid], [aria-label]').evaluateAll((els) => els.slice(0, 350).map((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      const attrs = ['id', 'name', 'type', 'placeholder', 'role', 'aria-label', 'data-testid', 'data-action', 'href']
        .map((a) => (el.getAttribute(a) ? `${a}="${el.getAttribute(a).slice(0, 60)}"` : null)).filter(Boolean).join(' ');
      const text = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      return `<${el.tagName.toLowerCase()}${attrs ? ` ${attrs}` : ''}>${text}`;
    }).filter(Boolean));
    const text = (await page.locator('body').innerText().catch(() => '')).replace(/\n{3,}/g, '\n\n').slice(0, 5000);
    return { url: page.url(), title, elements: elements.join('\n'), text };
  } finally {
    await browser.close();
  }
}

const SCRIPT_SYSTEM = `You are a senior QA automation engineer who writes Playwright tests in JavaScript.
For each test case you write ONLY the body of an async function with the signature
  async ({ page, expect, baseURL }) => { /* your code */ }
Rules:
- No imports, no test()/describe() wrappers, no require. "page" is a Playwright Page whose context already has baseURL set, so page.goto('/') opens the app.
- Prefer user-facing locators: getByRole, getByLabel, getByPlaceholder, getByText, getByTestId. Use CSS selectors only when the snapshot shows no better handle.
- Use the page snapshot to pick selectors that really exist. Navigate the way a user would.
- Assert the expected result with expect(...) web-first assertions (toBeVisible, toHaveText, toHaveURL, toHaveCount...). Every script must contain at least one expect.
- Keep each script independent: start with page.goto. Use unique test data (e.g. Date.now()) when creating records.
- If the feature is clearly not present in the app, still write the steps that would verify it so the test fails with a clear message.
- Always reply with a single valid JSON value and nothing else.`;

export async function generateScripts({ ticket, tests, project, baseUrl, snapshot, ai }) {
  const prompt = `Application under test: ${project?.name || ''}
Base URL: ${baseUrl}
Project summary: ${project?.summary || ''}

Issue ${ticket.key}: ${ticket.title}
User story: ${ticket.userStory || ''}
Acceptance criteria:
${(ticket.acceptanceCriteria || []).map((a, i) => `AC${i + 1}. ${a}`).join('\n')}

Snapshot of ${snapshot.url} (title "${snapshot.title}"):
Interactive elements:
${snapshot.elements}

Visible text:
${snapshot.text}

Test cases to automate:
${JSON.stringify(tests.map((t, i) => ({ index: i, title: t.title, preconditions: t.preconditions, steps: t.steps, expected: t.expected })), null, 2)}

Return JSON: { "scripts": [ { "index": 0, "code": "await page.goto('/');\\n..." } ] }`;
  const res = await askJson({ ...ai, system: SCRIPT_SYSTEM, prompt });
  return (res.scripts || []).map((s) => ({ index: Number(s.index), code: String(s.code || '').replace(/^```(?:js|javascript)?\s*|```\s*$/g, '').trim() }));
}

/** Runs one script in a child process. Returns { status, error, durationMs, screenshot, logs }. */
export function runScript({ code, baseUrl, tcId, timeoutMs = 60000, signal }) {
  // Keep only the latest screenshot per test case.
  for (const f of fs.readdirSync(RUN_DIR)) if (f.startsWith(`${tcId}-`)) fs.rmSync(path.join(RUN_DIR, f), { force: true });
  const file = `${tcId}-${Date.now()}.png`;
  return new Promise((resolve) => {
    const child = spawn(/*turbopackIgnore: true*/ process.execPath, [RUNNER], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const kill = () => child.kill('SIGKILL');
    const hard = setTimeout(kill, timeoutMs + 20000);
    signal?.addEventListener('abort', kill);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', () => {
      clearTimeout(hard);
      signal?.removeEventListener('abort', kill);
      const line = out.trim().split('\n').pop();
      let r;
      try { r = JSON.parse(line); } catch { r = { status: 'Fail', error: signal?.aborted ? 'Run stopped' : (err || out || 'Runner crashed').slice(-2000), durationMs: 0, logs: [] }; }
      r.screenshot = r.screenshot ? `/runs/${file}` : null;
      r.at = new Date().toISOString();
      resolve(r);
    });
    child.stdin.end(JSON.stringify({ code, baseUrl, screenshotPath: path.join(RUN_DIR, file), timeoutMs, headless: true }));
  });
}

/**
 * Full run. items: [{ ticket, tc }] where ticket = { id, key, title, userStory, acceptanceCriteria } and
 * tc = { id, title, steps, expected, preconditions, script }. emit(event) streams progress.
 */
export async function runAutomation({ items, baseUrl, regenerate, project, ai, emit, signal }) {
  const needScripts = items.filter((it) => regenerate || !it.tc.script?.trim());
  if (needScripts.length) {
    emit({ type: 'phase', message: `Opening ${baseUrl} to learn the page…` });
    let snapshot;
    try { snapshot = await snapshotPage(baseUrl); } catch (e) { emit({ type: 'error', message: `Could not open ${baseUrl}: ${e.message.split('\n')[0]}` }); return; }
    const byTicket = new Map();
    for (const it of needScripts) {
      if (!byTicket.has(it.ticket.id)) byTicket.set(it.ticket.id, { ticket: it.ticket, list: [] });
      byTicket.get(it.ticket.id).list.push(it);
    }
    const jobs = [...byTicket.values()];
    let done = 0;
    const worker = async () => {
      while (jobs.length && !signal?.aborted) {
        const { ticket, list } = jobs.shift();
        emit({ type: 'phase', message: `Claude is writing ${list.length} script${list.length > 1 ? 's' : ''} for ${ticket.key}…` });
        try {
          const scripts = await generateScripts({ ticket, tests: list.map((x) => x.tc), project, baseUrl, snapshot, ai: { ...ai, signal } });
          for (const s of scripts) {
            const it = list[s.index];
            if (it && s.code) { it.tc.script = s.code; emit({ type: 'script', ticketId: ticket.id, tcId: it.tc.id, code: s.code }); }
          }
        } catch (e) {
          if (signal?.aborted) return;
          emit({ type: 'phase', level: 'warn', message: `Could not write scripts for ${ticket.key}: ${e.message}` });
        }
        done += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
    void done;
  }
  for (const it of items) {
    if (signal?.aborted) return;
    if (!it.tc.script?.trim()) {
      emit({ type: 'result', ticketId: it.ticket.id, tcId: it.tc.id, result: { status: 'Fail', error: 'No automation script', durationMs: 0, at: new Date().toISOString(), logs: [] } });
      continue;
    }
    emit({ type: 'start', ticketId: it.ticket.id, tcId: it.tc.id });
    const result = await runScript({ code: it.tc.script, baseUrl, tcId: it.tc.id, signal });
    if (signal?.aborted) return;
    emit({ type: 'result', ticketId: it.ticket.id, tcId: it.tc.id, result });
  }
}
