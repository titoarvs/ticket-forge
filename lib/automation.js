// Test automation: Claude turns test cases into Playwright scripts, which run in a real
// (headless) Chromium against the app under test. Each script runs in its own process.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { askJson } from './claude.js';
import { agentInstructions } from './agents.js';
import { makeApp, maskSecrets, LOGOUT_RE, findLoginForm, describeLoginForm } from './app-helpers.mjs';
import { getRules, rulesText, getGuide, guideBlock } from './genrules.js';
import { saveFailureShot } from './shots.js';
import { ROOT, DATA_DIR, SERVERLESS } from './db.js';
import { pickBrowser, launch, describeBrowser, hideEndpoint, systemBrowser, explainConnectError } from './browser.mjs';
import { runOne } from './run-one.mjs';
import { getRemoteBrowser } from './settings.js';

export const RUN_DIR = path.join(DATA_DIR, 'runs');
fs.mkdirSync(RUN_DIR, { recursive: true });
const RUNNER = path.join(ROOT, 'lib', 'runner.mjs');

/** The browser tests use right now (remote, Playwright's Chromium, or Chrome/Edge on this computer), or null. */
export async function browserSpec() {
  const { chromium } = await import('@playwright/test');
  return pickBrowser(chromium, await getRemoteBrowser().catch(() => null), { serverless: SERVERLESS });
}

/** What to do when no test browser is available. */
export const noBrowser = () => (SERVERLESS
  ? 'This server can’t run a browser (serverless hosting such as Vercel). An administrator can connect a remote browser (for example Browserless) in Test automation → Settings → Remote browser, or run TicketForge on a computer.'
  : 'No test browser is available. An administrator can install Chromium in Test automation → Settings, install Google Chrome or Microsoft Edge, or connect a remote browser.');

export async function engineStatus() {
  let installed = false, version = null;
  try {
    await import('@playwright/test');
    installed = true;
    version = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', '@playwright', 'test', 'package.json'), 'utf8')).version;
  } catch { /* not installed */ }
  if (!installed) return { installed: false, browser: false, version: null, serverless: SERVERLESS, source: null, label: 'none' };
  const spec = await browserSpec().catch(() => null);
  return { installed, browser: Boolean(spec), version, serverless: SERVERLESS, source: spec?.kind || null, label: describeBrowser(spec),
    systemBrowser: SERVERLESS ? null : systemBrowser()?.label || null };
}

/** Streams `npx playwright install chromium` output lines to onLine. */
export function installBrowser(onLine) {
  if (SERVERLESS) return Promise.reject(Object.assign(new Error('Test automation needs a regular server: serverless hosting (like Vercel) can’t install or run a browser. Run TicketForge on your own computer to use it.'), { status: 400 }));
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

/** A compact description of the open page so the AI can pick real selectors. */
async function describe(page, maxEls = 350, maxText = 5000) {
  const title = await page.title().catch(() => '');
  const elements = await page.locator('a, button, input, select, textarea, label, h1, h2, h3, [role], [data-testid], [aria-label]').evaluateAll((els, max) => els.slice(0, max).map((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    const attrs = ['id', 'name', 'type', 'placeholder', 'role', 'aria-label', 'data-testid', 'data-action', 'href']
      .map((a) => (el.getAttribute(a) ? `${a}="${el.getAttribute(a).slice(0, 60)}"` : null)).filter(Boolean).join(' ');
    const text = el.type === 'password' ? '' : (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    return `<${el.tagName.toLowerCase()}${attrs ? ` ${attrs}` : ''}>${text}`;
  }).filter(Boolean), maxEls).catch(() => []);
  const text = (await page.locator('body').innerText().catch(() => '')).replace(/\n{3,}/g, '\n\n').slice(0, maxText);
  return { url: page.url(), path: pathOf(page.url()), title, elements: elements.join('\n'), text };
}
const settle = (page) => page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
const pathOf = (u) => { try { const x = new URL(u); return `${x.pathname}${x.hash.startsWith('#/') ? x.hash : ''}`; } catch { return u; } };
async function withBrowser(baseUrl, fn) {
  const { chromium, expect } = await import('@playwright/test');
  const spec = await browserSpec();
  let browser;
  try { browser = await launch(chromium, spec); }
  catch (e) { throw Object.assign(new Error(`Couldn’t start the test browser (${describeBrowser(spec)}): ${explainConnectError(hideEndpoint(String(e.message || e).split('\n')[0], spec), spec)}`), { status: 502 }); }
  try {
    const context = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(20000);
    return await fn(page, expect.configure({ timeout: 8000 }));
  } finally {
    await browser.close();
  }
}
/** A role that has both a username and a password saved: the one asked for, else the first. */
const loginRole = (app, name) => {
  const ok = (app.roles || []).filter((r) => r.username && r.password);
  return ok.find((r) => r.name === name) || ok[0] || null;
};

/** Snapshot of one URL (no login). */
export async function snapshotPage(url) {
  return withBrowser(url, async (page) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await settle(page);
    return describe(page);
  });
}

/**
 * What the AI sees before writing scripts: the start page (after signing in as `role`, when credentials are
 * saved) and each page in the App setup, so it can use real selectors on every page.
 */
export async function snapshotApp({ baseUrl, app = {}, role }) {
  return withBrowser(baseUrl, async (page, expect) => {
    const notes = [];
    const who = loginRole(app, role);
    if (who) {
      try { await makeApp(page, expect, app).loginAs(who.name); notes.push(`Signed in as ${who.name}.`); }
      catch (e) { notes.push(`Signing in as ${who.name} failed: ${maskSecrets(e.message.split('\n')[0], app)}`); await page.goto('/').catch(() => {}); }
    } else {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
    }
    await settle(page);
    const start = await describe(page, 150, 2500);
    const pages = [];
    // Pages with dynamic segments (/orders/:id) need real values, so they aren't visited here.
    for (const p of (app.pages || []).filter((x) => !String(x.path).includes(':')).slice(0, 6)) {
      try {
        await page.goto(p.path, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await settle(page);
        pages.push({ name: p.name, ...(await describe(page, 60, 500)) });
      } catch (e) { pages.push({ name: p.name, path: p.path, error: e.message.split('\n')[0] }); }
    }
    return { ...start, signedInAs: who?.name || null, notes, pages };
  });
}

/**
 * Finds the app's login form without signing in: the login page, and which field, password field and button
 * it uses. Nothing is typed or submitted. Returns { path, tried, fields: { user, pass, submit }, screenshot }.
 */
export async function detectLogin({ baseUrl, app = {} }) {
  const file = 'login-form.png';
  return withBrowser(baseUrl, async (page) => {
    const found = await findLoginForm(page, { ...app, login: { ...(app.login || {}), path: '' } });
    await settle(page);
    const fields = await describeLoginForm(page, app.login || {});
    await page.screenshot({ path: path.join(RUN_DIR, file), timeout: 5000 }).catch(() => {});
    return { ...found, fields, url: page.url(), screenshot: `/runs/${file}` };
  });
}

/** Signs in as a role and reports where it landed, with a screenshot. */
export async function testLogin({ baseUrl, app = {}, role }) {
  const r = (app.roles || []).find((x) => x.name === role || x.id === role);
  if (!r) throw Object.assign(new Error('That role isn’t in the App setup.'), { status: 400 });
  const file = `login-${String(r.id || 'role').replace(/[^\w-]/g, '')}.png`;
  return withBrowser(baseUrl, async (page, expect) => {
    const helper = makeApp(page, expect, app);
    const notes = () => helper.notes.map((n) => maskSecrets(n, app));
    try {
      await helper.loginAs(r.name);
      await settle(page);
      await page.screenshot({ path: path.join(RUN_DIR, file), timeout: 5000 }).catch(() => {});
      return { ok: true, url: page.url(), title: await page.title().catch(() => ''), screenshot: `/runs/${file}`, notes: notes(), loginPath: helper.loginPath };
    } catch (e) {
      await page.screenshot({ path: path.join(RUN_DIR, file), timeout: 5000 }).catch(() => {});
      return { ok: false, error: maskSecrets(String(e.message || e).split('\n').slice(0, 3).join(' '), app), url: page.url(), screenshot: `/runs/${file}`, notes: notes(), loginPath: helper.loginPath };
    }
  });
}

/**
 * Finds the app's pages by following links from the start page (after signing in as `role`). It only follows
 * links: it never clicks buttons or submits forms, and skips links that look like logging out or deleting.
 */
export async function discoverPages({ baseUrl, app = {}, role, max = 30 }) {
  const SKIP = /delete|remove|destroy|unsubscribe|deactivate/i;
  return withBrowser(baseUrl, async (page, expect) => {
    const origin = new URL(baseUrl).origin;
    let start = '/';
    let loginPath = (app.login?.path || '').replace(/\/+$/, '');
    if (role) {
      const helper = makeApp(page, expect, app);
      await helper.loginAs(role);
      loginPath = (helper.loginPath || loginPath).replace(/\/+$/, '') || '/';
      start = pathOf(page.url());
    }
    const queue = [{ path: start, depth: 0, via: '' }];
    const seen = new Set();
    const found = [];
    while (queue.length && found.length < max) {
      const { path: p, depth, via } = queue.shift();
      if (seen.has(p)) continue;
      seen.add(p);
      try {
        const res = await page.goto(p, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await settle(page);
        if (res && res.status() >= 400) continue;
        const here = pathOf(page.url());
        if (here !== p && seen.has(here)) continue;
        seen.add(here);
        if (role && here.replace(/\/+$/, '') === loginPath) continue; // bounced to the login page: not a real page for this role
        const info = await page.evaluate(() => ({
          title: document.title,
          h1: (document.querySelector('h1')?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60),
          links: [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.href, text: (a.innerText || a.getAttribute('aria-label') || a.title || '').trim().replace(/\s+/g, ' ').slice(0, 60) })),
        }));
        const name = (via && via.length <= 40 ? via : '') || info.h1 || info.title || here;
        found.push({ name, path: here, title: info.title });
        if (depth >= 2) continue;
        for (const l of info.links) {
          let u;
          try { u = new URL(l.href); } catch { continue; }
          if (u.origin !== origin) continue;
          if (LOGOUT_RE.test(l.text) || LOGOUT_RE.test(u.pathname) || SKIP.test(l.text) || SKIP.test(u.pathname)) continue;
          if (/\.(pdf|zip|png|jpe?g|gif|svg|csv|xlsx?|docx?|txt)$/i.test(u.pathname)) continue;
          const next = `${u.pathname}${u.hash.startsWith('#/') ? u.hash : ''}`;
          if (!seen.has(next)) queue.push({ path: next, depth: depth + 1, via: l.text });
        }
      } catch { /* skip pages that don't load */ }
    }
    // Distinct names, so app.goto('Name') is unambiguous.
    const names = new Map();
    for (const f of found) {
      const k = f.name.toLowerCase();
      names.set(k, (names.get(k) || 0) + 1);
      if (names.get(k) > 1) f.name = `${f.name} (${f.path})`;
    }
    return found;
  });
}

/** The App setup as the AI sees it: names, paths and descriptions, never credentials. */
function appMapText(app, snapshot) {
  const pages = app.pages || [], roles = app.roles || [];
  const lines = [];
  if (pages.length) {
    lines.push('Pages (open with await app.goto("<name>"); app.url("<name>") returns the path). Dynamic segments like :id need values:',
      'await app.goto("<name>", { id: 42 }). Get real ids by first opening the list page and reading a link or row when possible.');
    for (const p of pages) lines.push(`- "${p.name}" → ${p.path}${p.description ? `: ${p.description}` : ''}`);
  } else lines.push('No pages are set up yet: navigate with page.goto(\'/path\') and the links you see.');
  if (roles.length) {
    lines.push('', 'User roles (sign in with await app.loginAs("<role>"); it fills the login form with saved credentials):');
    for (const r of roles) lines.push(`- "${r.name}"${r.description ? `: ${r.description}` : ''}${r.username && r.password ? '' : ' (no credentials saved yet)'}`);
    lines.push(`Login form: ${app.login?.path || 'found automatically'} (app.loginAs handles it).`);
  } else lines.push('', 'No user roles are set up: the app may not need signing in.');
  if (app.notes) lines.push('', `Notes from the team: ${app.notes}`);
  if (snapshot?.notes?.length) lines.push('', `While taking the snapshot: ${snapshot.notes.join(' ')}`);
  return lines.join('\n');
}

const SCRIPT_SYSTEM = `You are a senior QA automation engineer who writes Playwright tests in JavaScript.
For each test case you write ONLY the body of an async function with the signature
  async ({ page, expect, baseURL, app }) => { /* your code */ }
Rules:
- No imports, no test()/describe() wrappers, no require. "page" is a Playwright Page whose context already has baseURL set, so page.goto('/') opens the app.
- "app" knows the application's pages and user roles (see the app map):
  await app.loginAs('Role') signs in as that role. Never type usernames or passwords yourself and never put credentials in a script.
  await app.goto('Page name') opens a page from the app map; app.url('Page name') returns its path (for toHaveURL).
  For dynamic pages (paths with :params) pass values: await app.goto('Order detail', { id: 1001 }); app.url('Order detail', { id: 1001 }).
  app.credentials('Role') returns { username, password }: use it only when the test is about the login form itself.
- When a test case has "runAs", start with await app.loginAs(runAs). If it has none but needs a signed-in user and roles exist, sign in with the most fitting role.
- Prefer app.goto for pages in the app map; otherwise page.goto('/path').
- Prefer user-facing locators: getByRole, getByLabel, getByPlaceholder, getByText, getByTestId. Use CSS selectors only when the snapshot shows no better handle.
- Use the page snapshot to pick selectors that really exist. Navigate the way a user would.
- Assert the expected result with expect(...) web-first assertions (toBeVisible, toHaveText, toHaveURL, toHaveCount...). Every script must contain at least one expect.
- Keep each script independent: start by signing in and/or opening a page. Use unique test data (e.g. Date.now()) when creating records.
- If the feature is clearly not present in the app, still write the steps that would verify it so the test fails with a clear message.
- Always reply with a single valid JSON value and nothing else.`;

/** What the AI is told before writing test scripts: the base instructions, team standards and guide. */
export function automationSystem(rules, guide) {
  const team = rulesText(rules, 'automation');
  return `${team ? `${SCRIPT_SYSTEM}\n\nTeam standards. Follow them exactly:\n${team}` : SCRIPT_SYSTEM}${guideBlock(guide, ['automation'])}`;
}
export const SCRIPT_BASE = () => SCRIPT_SYSTEM;

export async function generateScripts({ ticket, tests, project, baseUrl, snapshot, ai, app = {} }) {
  const roleName = (id) => (app.roles || []).find((r) => r.id === id)?.name || undefined;
  const pageShots = (snapshot.pages || []).map((p) => (p.error
    ? `### Page "${p.name}" (${p.path}): couldn't open it (${p.error})`
    : `### Page "${p.name}" (${p.path}, title "${p.title}")\n${p.elements}\nText: ${p.text.replace(/\s+/g, ' ').slice(0, 400)}`)).join('\n\n');
  const prompt = `Application under test: ${project?.name || ''}
Base URL: ${baseUrl}
Project summary: ${project?.summary || ''}

App map:
${appMapText(app, snapshot)}

Issue ${ticket.key}: ${ticket.title}
User story: ${ticket.userStory || ''}
Acceptance criteria:
${(ticket.acceptanceCriteria || []).map((a, i) => `AC${i + 1}. ${a}`).join('\n')}

Snapshot of the start page ${snapshot.path || snapshot.url}${snapshot.signedInAs ? ` (signed in as ${snapshot.signedInAs})` : ''}, title "${snapshot.title}":
Interactive elements:
${snapshot.elements}

Visible text:
${snapshot.text}
${pageShots ? `\nOther pages from the app map:\n${pageShots}\n` : ''}
Test cases to automate:
${JSON.stringify(tests.map((t, i) => ({ index: i, title: t.title, runAs: roleName(t.roleId), preconditions: t.preconditions, steps: t.steps, expected: t.expected })), null, 2)}

Return JSON: { "scripts": [ { "index": 0, "code": "await app.loginAs('…');\\n..." } ] }`;
  const rules = await getRules();
  const res = await askJson({ ...ai, reasoning: rules.reasoning, system: automationSystem(rules, await getGuide()) + await agentInstructions('feature-verification'), prompt });
  return (res.scripts || []).map((s) => ({ index: Number(s.index), code: String(s.code || '').replace(/^```(?:js|javascript)?\s*|```\s*$/g, '').trim() }));
}

/** Runs one script in a child process. Returns { status, error, durationMs, screenshot, logs }. */
export function runScript({ code, baseUrl, tcId, timeoutMs = 60000, signal, app, browser = null }) {
  // Keep only the latest screenshot per test case.
  for (const f of fs.readdirSync(RUN_DIR)) if (f.startsWith(`${tcId}-`)) fs.rmSync(path.join(RUN_DIR, f), { force: true });
  const file = `${tcId}-${Date.now()}.jpg`;
  const input = { code, baseUrl, screenshotPath: path.join(RUN_DIR, file), timeoutMs, headless: true, app, browser };
  const finish = (r) => {
    // The local file; runAutomation stores failures in the database and removes it.
    r.localShot = r.screenshot ? path.join(RUN_DIR, file) : null;
    r.screenshot = r.screenshot ? `/runs/${file}` : null;
    r.at = new Date().toISOString();
    return r;
  };
  // Serverless hosting can't reliably start another process: run the script here, in this request.
  if (SERVERLESS) {
    return runOne(input, { signal }).catch((e) => ({ status: 'Fail', error: String(e?.message || e).slice(0, 2000), durationMs: 0, logs: [], screenshot: null })).then(finish);
  }
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
      resolve(finish(r));
    });
    child.stdin.end(JSON.stringify(input));
  });
}

/**
 * Full run. items: [{ ticket, tc }] where ticket = { id, key, title, userStory, acceptanceCriteria } and
 * tc = { id, title, steps, expected, preconditions, script }. emit(event) streams progress.
 */
export async function runAutomation({ items, baseUrl, regenerate, project, ai, emit, signal, app = {}, user }) {
  const spec = await browserSpec();
  emit({ type: 'phase', message: `Test browser: ${describeBrowser(spec)}` });
  const needScripts = items.filter((it) => regenerate || !it.tc.script?.trim());
  if (needScripts.length) {
    const firstRole = needScripts.map((it) => (app.roles || []).find((r) => r.id === it.tc.roleId)?.name).find(Boolean);
    emit({ type: 'phase', message: `Opening ${baseUrl} to learn ${app.pages?.length ? `its ${app.pages.length > 6 ? 'first 6' : app.pages.length} page${app.pages.length > 1 ? 's' : ''}` : 'the page'}…` });
    let snapshot;
    try { snapshot = await snapshotApp({ baseUrl, app, role: firstRole }); } catch (e) { emit({ type: 'error', message: `Could not open ${baseUrl}: ${maskSecrets(e.message.split('\n')[0], app)}` }); return; }
    for (const n of snapshot.notes || []) emit({ type: 'phase', level: /failed/.test(n) ? 'warn' : undefined, message: n });
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
        emit({ type: 'phase', message: `AI is writing ${list.length} script${list.length > 1 ? 's' : ''} for ${ticket.key}…` });
        try {
          const scripts = await generateScripts({ ticket, tests: list.map((x) => x.tc), project, baseUrl, snapshot, app, ai: { ...ai, signal, onSwitch: (message) => emit({ type: 'phase', level: 'warn', message }) } });
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
    const result = await runScript({ code: it.tc.script, baseUrl, tcId: it.tc.id, signal, app, browser: spec });
    // Failures: keep the screenshot in the database. Passes: nothing to keep.
    const local = result.localShot;
    delete result.localShot;
    if (result.status !== 'Pass' && project?.id && local) {
      try { result.screenshot = await saveFailureShot({ file: local, projectId: project.id, issueId: it.ticket.id, tcId: it.tc.id, error: result.error, user }); }
      catch (e) { emit({ type: 'phase', level: 'warn', message: `Couldn’t save the screenshot: ${e.message}` }); }
    } else if (result.status === 'Pass' && local) {
      fs.rm(local, { force: true }, () => {});
      result.screenshot = null;
    }
    if (signal?.aborted) return;
    emit({ type: 'result', ticketId: it.ticket.id, tcId: it.tc.id, result });
  }
}
