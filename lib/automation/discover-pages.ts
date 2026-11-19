import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { askJson } from '../claude';
import { agentInstructions } from '../agents';
import { contextBlock } from '../appcontext';
import { makeApp, LOGOUT_RE } from '../app-helpers.mjs';
import { rulesText, guideBlock, getRules, getGuide } from '../genrules';
import { SERVERLESS, ROOT } from '../db';
import { runSettings, runOne } from '../run-one.mjs';
import { withBrowser, pathOf, settle, RUN_DIR, runPrefix, RUNNER } from './snapshot-app';

/**
 * Finds the app's pages by following links from the start page (after signing in as `role`). It
 * only follows links: it never clicks buttons or submits forms, and skips links that look like
 * logging out or deleting.
 */
export async function discoverPages({ baseUrl, app = {}, role, max = 30 }: any) {
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
    const seen: Set<any> = new Set();
    const found: any[] = [];
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
          h1: (document.querySelector('h1')?.innerText || '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 60),
          links: [...document.querySelectorAll('a[href]')].map((a: any) => ({
            href: a.href,
            text: (a.innerText || a.getAttribute('aria-label') || a.title || '')
              .trim()
              .replace(/\s+/g, ' ')
              .slice(0, 60),
          })),
        }));
        const name = (via && via.length <= 40 ? via : '') || info.h1 || info.title || here;
        found.push({ name, path: here, title: info.title });
        if (depth >= 2) continue;
        for (const l of info.links) {
          let u;
          try {
            u = new URL(l.href);
          } catch {
            continue;
          }
          if (u.origin !== origin) continue;
          if (
            LOGOUT_RE.test(l.text) ||
            LOGOUT_RE.test(u.pathname) ||
            SKIP.test(l.text) ||
            SKIP.test(u.pathname)
          )
            continue;
          if (/\.(pdf|zip|png|jpe?g|gif|svg|csv|xlsx?|docx?|txt)$/i.test(u.pathname)) continue;
          const next = `${u.pathname}${u.hash.startsWith('#/') ? u.hash : ''}`;
          if (!seen.has(next)) queue.push({ path: next, depth: depth + 1, via: l.text });
        }
      } catch {
        /* skip pages that don't load */
      }
    }
    // Distinct names, so app.goto('Name') is unambiguous.
    const names: Map<any, any> = new Map();
    for (const f of found) {
      const k = f.name.toLowerCase();
      names.set(k, (names.get(k) || 0) + 1);
      if (names.get(k) > 1) f.name = `${f.name} (${f.path})`;
    }
    return found;
  });
}
/** The App setup as the AI sees it: names, paths and descriptions, never credentials. */
function appMapText(app: any, snapshot) {
  const pages = app.pages || [],
    roles = app.roles || [];
  const lines: any[] = [];
  if (pages.length) {
    lines.push(
      'Pages (open with await app.goto("<name>"); app.url("<name>") returns the path). Dynamic segments like :id need values:',
      'await app.goto("<name>", { id: 42 }). Get real ids by first opening the list page and reading a link or row when possible.',
    );
    for (const p of pages)
      lines.push(`- "${p.name}" → ${p.path}${p.description ? `: ${p.description}` : ''}`);
  } else
    lines.push("No pages are set up yet: navigate with page.goto('/path') and the links you see.");
  if (roles.length) {
    lines.push(
      '',
      'User roles (sign in with await app.loginAs("<role>"); it handles the login form, single sign-on, MFA codes and saved sessions):',
    );
    const how = (r) =>
      (r.signIn === 'session'
        ? r.session
          ? 'saved session'
          : 'saved session — none saved yet'
        : r.signIn === 'sso'
          ? `single sign-on${r.ssoButton ? ` via “${r.ssoButton}”` : ''}`
          : 'login form') + (r.totp ? ', MFA code filled automatically' : '');
    const ready = (r) =>
      r.signIn === 'session' ? Boolean(r.session) : Boolean(r.username && r.password);
    for (const r of roles)
      lines.push(
        `- "${r.name}"${r.description ? `: ${r.description}` : ''} (${how(r)})${ready(r) ? '' : ' (no credentials saved yet)'}`,
      );
    lines.push(`Login form: ${app.login?.path || 'found automatically'} (app.loginAs handles it).`);
  } else lines.push('', 'No user roles are set up: the app may not need signing in.');
  if (app.db?.name)
    lines.push(
      '',
      `Database: await app.db.query(sql, params) runs a read-only SQL query on ${app.db.name} (${app.db.engineLabel || 'PostgreSQL'}; placeholders are written ${app.db.placeholder || '$1'}, ${app.db.placeholder === '@p1' ? '@p2' : app.db.placeholder === '?' ? '?' : '$2'}…) and returns the rows, e.g.`,
      `  const [row] = await app.db.query('select status from orders where id = ${app.db.placeholder || '$1'}', [orderId]); expect(row?.status).toBe('paid');`,
      'Use it after the UI steps when the expected result is about saved data, with the exact names from the DATABASE SCHEMA. Never write data with it.',
    );
  if (app.notes) lines.push('', `Notes from the team: ${app.notes}`);
  if (snapshot?.notes?.length)
    lines.push('', `While taking the snapshot: ${snapshot.notes.join(' ')}`);
  return lines.join('\n');
}
const SCRIPT_SYSTEM = `You are a senior QA automation engineer who writes Playwright tests in JavaScript.
For each test case you write ONLY the body of an async function with the signature
  async ({ page, expect, baseURL, app }: any) => { /* your code */ }
Rules:
- No imports, no test()/describe() wrappers, no require. "page" is a Playwright Page whose context already has baseURL set, so page.goto('/') opens the app.
- "app" knows the application's pages and user roles (see the app map):
  await app.loginAs('Role') signs in as that role. Never type usernames or passwords yourself and never put credentials in a script.
  await app.goto('Page name') opens a page from the app map; app.url('Page name') returns its path (for toHaveURL).
  For dynamic pages (paths with :params) pass values: await app.goto('Order detail', { id: 1001 }); app.url('Order detail', { id: 1001 }).
  app.credentials('Role') returns { username, password }: use it only when the test is about the login form itself.
  app.mfaCode('Role') returns the role's current authenticator code: use it only when the test is about the MFA step itself.
  Never click single sign-on buttons or fill identity-provider pages yourself: app.loginAs does that.
- When a test case has "runAs", start with await app.loginAs(runAs). If it has none but needs a signed-in user and roles exist, sign in with the most fitting role.
- Prefer app.goto for pages in the app map; otherwise page.goto('/path').
- Prefer user-facing locators: getByRole, getByLabel, getByPlaceholder, getByText, getByTestId. Use CSS selectors only when the snapshot shows no better handle.
- Use the page snapshot to pick selectors that really exist. Navigate the way a user would.
- Assert the expected result with expect(...) web-first assertions (toBeVisible, toHaveText, toHaveURL, toHaveCount...). Every script must contain at least one expect.
- Keep each script independent: start by signing in and/or opening a page. Use unique test data (e.g. Date.now()) when creating records.
- If the feature is clearly not present in the app, still write the steps that would verify it so the test fails with a clear message.
- Always reply with a single valid JSON value and nothing else.`;
/**
 * What the AI is told before writing test scripts: the base instructions, team standards and guide.
 */
export function automationSystem(rules, guide) {
  const team = rulesText(rules, 'automation');
  return `${team ? `${SCRIPT_SYSTEM}\n\nTeam standards. Follow them exactly:\n${team}` : SCRIPT_SYSTEM}${guideBlock(guide, ['automation'])}`;
}
export const SCRIPT_BASE = () => SCRIPT_SYSTEM;
export async function generateScripts({
  ticket,
  tests,
  project,
  baseUrl,
  snapshot,
  ai,
  app = {},
  notes = '',
}: any) {
  const roleName = (id) => (app.roles || []).find((r) => r.id === id)?.name || undefined;
  const pageShots = (snapshot.pages || [])
    .map((p) =>
      p.error
        ? `### Page "${p.name}" (${p.path}): couldn't open it (${p.error})`
        : `### Page "${p.name}" (${p.path}, title "${p.title}")\n${p.elements}\nText: ${p.text.replace(/\s+/g, ' ').slice(0, 400)}`,
    )
    .join('\n\n');
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
${JSON.stringify(
  tests.map((t, i) => ({
    index: i,
    title: t.title,
    runAs: roleName(t.roleId),
    preconditions: t.preconditions,
    steps: t.steps,
    expected: t.expected,
  })),
  null,
  2,
)}

${notes ? `\n${notes}\nUse these answers when writing the scripts.\n` : ''}
Return JSON: { "scripts": [ { "index": 0, "code": "await app.loginAs('…');\\n..." } ] }`;
  const rules = await getRules();
  const res = await askJson({
    ...ai,
    task: 'automation',
    reasoning: rules.reasoning,
    system:
      automationSystem(rules, await getGuide()) +
      (await agentInstructions('feature-verification')) +
      contextBlock(project),
    prompt,
    brain: { projectId: project?.id, issues: [ticket], max: 4000 },
  });
  return (res.scripts || []).map((s) => ({
    index: Number(s.index),
    code: String(s.code || '')
      .replace(/^```(?:js|javascript)?\s*|```\s*$/g, '')
      .trim(),
  }));
}
/** Runs one script in a child process. Returns { status, error, durationMs, screenshot, logs }. */
export function runScript({ code, baseUrl, tcId, timeoutMs, signal, app, browser = null }: any) {
  timeoutMs ??= runSettings(app?.run).testTimeoutSec * 1000;
  // Keep only the latest screenshot per test case.
  for (const f of fs.readdirSync(RUN_DIR))
    if (f.startsWith(`${runPrefix()}${tcId}-`)) fs.rmSync(path.join(RUN_DIR, f), { force: true });
  const file = `${runPrefix()}${tcId}-${Date.now()}.jpg`;
  const input = {
    code,
    baseUrl,
    screenshotPath: path.join(RUN_DIR, file),
    timeoutMs,
    headless: true,
    app,
    browser,
  };
  const finish = (r) => {
    // The local file; runAutomation stores failures in the database and removes it.
    r.localShot = r.screenshot ? path.join(RUN_DIR, file) : null;
    r.screenshot = r.screenshot ? `/runs/${file}` : null;
    r.at = new Date().toISOString();
    return r;
  };
  // Serverless hosting can't reliably start another process: run the script here, in this request.
  if (SERVERLESS) {
    return runOne(input, { signal })
      .catch((e) => ({
        status: 'Fail',
        error: String(e?.message || e).slice(0, 2000),
        durationMs: 0,
        logs: [],
        screenshot: null,
      }))
      .then(finish);
  }
  return new Promise((resolve) => {
    const child = spawn(/*turbopackIgnore: true*/ process.execPath, [RUNNER], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    const kill = () => child.kill('SIGKILL');
    const hard = setTimeout(kill, timeoutMs + 20000);
    signal?.addEventListener('abort', kill);
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('close', () => {
      clearTimeout(hard);
      signal?.removeEventListener('abort', kill);
      const line = out.trim().split('\n').pop();
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        r = {
          status: 'Fail',
          error: signal?.aborted ? 'Run stopped' : (err || out || 'Runner crashed').slice(-2000),
          durationMs: 0,
          logs: [],
        };
      }
      resolve(finish(r));
    });
    child.stdin.end(JSON.stringify(input));
  });
}
