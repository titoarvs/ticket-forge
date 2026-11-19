import { spawn } from 'node:child_process';
import { isSaas } from '../platform';
import { isPrivateHost } from '../netguard';
import fs from 'node:fs';
import path from 'node:path';
import { makeApp, maskSecrets, findLoginForm, describeLoginForm } from '../app-helpers.mjs';
import { DATA_DIR, currentWs, DEFAULT_WS, ROOT, SERVERLESS } from '../db';
import {
  pickBrowser,
  describeBrowser,
  systemBrowser,
  launch,
  explainConnectError,
  hideEndpoint,
  absoluteNavigation,
} from '../browser.mjs';
import { getRemoteBrowser } from '../settings';

export const RUN_DIR = path.join(DATA_DIR, 'runs');
/**
 * Run screenshots of other workspaces start with "<workspace>--", so /runs/<file> only serves your
 * own (app/runs).
 */
export const runPrefix = (ws = currentWs()) => (!ws || ws === DEFAULT_WS ? '' : `${ws}--`);
fs.mkdirSync(RUN_DIR, { recursive: true });
export const RUNNER = path.join(ROOT, 'lib', 'runner.mjs');
/**
 * The browser tests use right now (remote, Playwright's Chromium, or Chrome/Edge on this computer),
 * or null.
 */
export async function browserSpec() {
  const { chromium } = await import('@playwright/test');
  return pickBrowser(chromium, await getRemoteBrowser().catch(() => null), {
    serverless: SERVERLESS,
  });
}
/** What to do when no test browser is available. */
export const noBrowser = () =>
  SERVERLESS
    ? 'This server can’t run a browser (serverless hosting such as Vercel). An administrator can connect a remote browser (for example Browserless) in Test automation → Settings → Remote browser, or run TicketForge on a computer.'
    : 'No test browser is available. An administrator can install Chromium in Test automation → Settings, install Google Chrome or Microsoft Edge, or connect a remote browser.';
export async function engineStatus() {
  let installed = false,
    version = null;
  try {
    await import('@playwright/test');
    installed = true;
    version = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, 'node_modules', '@playwright', 'test', 'package.json'),
        'utf8',
      ),
    ).version;
  } catch {
    /* not installed */
  }
  if (!installed)
    return {
      installed: false,
      browser: false,
      version: null,
      serverless: SERVERLESS,
      source: null,
      label: 'none',
    };
  const spec = await browserSpec().catch(() => null);
  return {
    installed,
    browser: Boolean(spec),
    version,
    serverless: SERVERLESS,
    source: spec?.kind || null,
    label: describeBrowser(spec),
    systemBrowser: SERVERLESS ? null : systemBrowser()?.label || null,
  };
}
/** Streams `npx playwright install chromium` output lines to onLine. */
export function installBrowser(onLine) {
  if (SERVERLESS)
    return Promise.reject(
      Object.assign(
        new Error(
          'Test automation needs a regular server: serverless hosting (like Vercel) can’t install or run a browser. Run TicketForge on your own computer to use it.',
        ),
        { status: 400 },
      ),
    );
  return new Promise((resolve, reject) => {
    const cli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
    const child = spawn(/*turbopackIgnore: true*/ process.execPath, [cli, 'install', 'chromium'], {
      cwd: ROOT,
    });
    const pipe = (d) =>
      String(d)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((l) => onLine(l));
    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(undefined as any)
        : reject(new Error(`Browser install exited with code ${code}`)),
    );
  });
}
/** A compact description of the open page so the AI can pick real selectors. */
async function describe(page, maxEls = 350, maxText = 5000) {
  const title = await page.title().catch(() => '');
  const elements = await page
    .locator(
      'a, button, input, select, textarea, label, h1, h2, h3, [role], [data-testid], [aria-label]',
    )
    .evaluateAll(
      (els, max) =>
        els
          .slice(0, max)
          .map((el) => {
            const r = el.getBoundingClientRect();
            if (!r.width && !r.height) return null;
            const attrs = [
              'id',
              'name',
              'type',
              'placeholder',
              'role',
              'aria-label',
              'data-testid',
              'data-action',
              'href',
            ]
              .map((a) => (el.getAttribute(a) ? `${a}="${el.getAttribute(a).slice(0, 60)}"` : null))
              .filter(Boolean)
              .join(' ');
            const text =
              el.type === 'password'
                ? ''
                : (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
            return `<${el.tagName.toLowerCase()}${attrs ? ` ${attrs}` : ''}>${text}`;
          })
          .filter(Boolean),
      maxEls,
    )
    .catch(() => []);
  const text = (
    await page
      .locator('body')
      .innerText()
      .catch(() => '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, maxText);
  return { url: page.url(), path: pathOf(page.url()), title, elements: elements.join('\n'), text };
}
export const settle = (page) =>
  page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
export const pathOf = (u) => {
  try {
    const x = new URL(u);
    return `${x.pathname}${x.hash.startsWith('#/') ? x.hash : ''}`;
  } catch {
    return u;
  }
};
/**
 * The hosted service (SaaS) runs test browsers on its own servers: the app under test must be on
 * the public internet, not a private or internal address (which would reach the server's own
 * network). Self-hosted, anything goes.
 */
export async function assertPublicTarget(url) {
  if (!isSaas() || !url) return;
  let u;
  try {
    u = new URL(url);
  } catch {
    throw Object.assign(
      new Error('Enter the full address of the app to test, like https://staging.example.com.'),
      { status: 400 },
    );
  }
  if (!/^https?:$/.test(u.protocol))
    throw Object.assign(new Error('The app to test must use http:// or https://.'), {
      status: 400,
    });
  if (await isPrivateHost(u.hostname)) {
    throw Object.assign(
      new Error(
        `${u.host} is a private or internal address. On the hosted service, test an app that's reachable on the internet, or run tests on GitHub Actions.`,
      ),
      { status: 400 },
    );
  }
}
export async function withBrowser(baseUrl, fn) {
  await assertPublicTarget(baseUrl);
  const { chromium, expect } = await import('@playwright/test');
  const spec = await browserSpec();
  let browser;
  try {
    browser = await launch(chromium, spec);
  } catch (e) {
    throw Object.assign(
      new Error(
        `Couldn’t start the test browser (${describeBrowser(spec)}): ${explainConnectError(hideEndpoint(String(e.message || e).split('\n')[0], spec), spec)}`,
      ),
      { status: 502 },
    );
  }
  try {
    const context = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: 1280, height: 800 },
    });
    absoluteNavigation(context, baseUrl);
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
 * What the AI sees before writing scripts: the start page (after signing in as `role`, when
 * credentials are saved) and each page in the App setup, so it can use real selectors on every
 * page.
 */
export async function snapshotApp({ baseUrl, app = {}, role }: any) {
  return withBrowser(baseUrl, async (page, expect) => {
    const notes: any[] = [];
    const who = loginRole(app, role);
    if (who) {
      try {
        await makeApp(page, expect, app).loginAs(who.name);
        notes.push(`Signed in as ${who.name}.`);
      } catch (e) {
        notes.push(
          `Signing in as ${who.name} failed: ${maskSecrets(e.message.split('\n')[0], app)}`,
        );
        await page.goto('/').catch(() => {});
      }
    } else {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
    }
    await settle(page);
    const start = await describe(page, 150, 2500);
    const pages: any[] = [];
    // Pages with dynamic segments (/orders/:id) need real values, so they aren't visited here.
    for (const p of (app.pages || []).filter((x) => !String(x.path).includes(':')).slice(0, 6)) {
      try {
        await page.goto(p.path, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await settle(page);
        pages.push({ name: p.name, ...(await describe(page, 60, 500)) });
      } catch (e) {
        pages.push({ name: p.name, path: p.path, error: e.message.split('\n')[0] });
      }
    }
    return { ...start, signedInAs: who?.name || null, notes, pages };
  });
}
/**
 * Finds the app's login form without signing in: the login page, and which field, password field
 * and button it uses. Nothing is typed or submitted. Returns { path, tried, fields: { user, pass,
 * submit }, screenshot }.
 */
export async function detectLogin({ baseUrl, app = {} }: any) {
  const file = `${runPrefix()}login-form.png`;
  return withBrowser(baseUrl, async (page) => {
    const found = await findLoginForm(page, { ...app, login: { ...(app.login || {}), path: '' } });
    await settle(page);
    const fields = await describeLoginForm(page, app.login || {});
    await page.screenshot({ path: path.join(RUN_DIR, file), timeout: 5000 }).catch(() => {});
    return { ...found, fields, url: page.url(), screenshot: `/runs/${file}` };
  });
}
/** Signs in as a role and reports where it landed, with a screenshot. */
export async function testLogin({ baseUrl, app = {}, role }: any) {
  const r = (app.roles || []).find((x) => x.name === role || x.id === role);
  if (!r) throw Object.assign(new Error('That role isn’t in the App setup.'), { status: 400 });
  const file = `${runPrefix()}login-${String(r.id || 'role').replace(/[^\w-]/g, '')}.png`;
  return withBrowser(baseUrl, async (page, expect) => {
    const helper = makeApp(page, expect, app);
    const notes = () => helper.notes.map((n) => maskSecrets(n, app));
    try {
      await helper.loginAs(r.name);
      await settle(page);
      await page.screenshot({ path: path.join(RUN_DIR, file), timeout: 5000 }).catch(() => {});
      return {
        ok: true,
        url: page.url(),
        title: await page.title().catch(() => ''),
        screenshot: `/runs/${file}`,
        notes: notes(),
        loginPath: helper.loginPath,
      };
    } catch (e) {
      await page.screenshot({ path: path.join(RUN_DIR, file), timeout: 5000 }).catch(() => {});
      return {
        ok: false,
        error: maskSecrets(
          String(e.message || e)
            .split('\n')
            .slice(0, 3)
            .join(' '),
          app,
        ),
        url: page.url(),
        screenshot: `/runs/${file}`,
        notes: notes(),
        loginPath: helper.loginPath,
      };
    }
  });
}
