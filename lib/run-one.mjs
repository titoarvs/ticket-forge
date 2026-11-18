// Runs ONE generated Playwright script and reports how it went. Used by runner.mjs (its own process, on a regular
// server) and directly inside the request on serverless hosting, where starting another process isn't reliable.
// input: { code, baseUrl, screenshotPath, timeoutMs, headless, app, browser }
//   app = the project's App setup (pages, login settings, roles with passwords) for the `app` helper, and
//   app.db = { url, engine, name }: the Test database for app.db.query() (read-only), when the project has one;
//   browser = which browser to use (see browser.mjs).
// Returns { status: 'Pass'|'Fail', error, durationMs, screenshot, logs }.
import { makeApp, maskSecrets } from './app-helpers.mjs';
import { launch, hideEndpoint, explainConnectError, absoluteNavigation } from './browser.mjs';
import { openDb, hideUrl } from './dbdrivers.mjs';

// Test automation → Settings → Run settings (app.run). Defaults keep runs steady on a typical staging site.
export const RUN_DEFAULTS = { retries: 1, testTimeoutSec: 90, actionTimeoutSec: 15, navTimeoutSec: 30, expectTimeoutSec: 10, device: 'desktop', locale: 'en-PH', timezoneId: 'Asia/Manila', ignoreHttpsErrors: false, reducedMotion: true };
const DEVICES = { desktop: { viewport: { width: 1440, height: 900 } }, laptop: { viewport: { width: 1280, height: 800 } }, tablet: { viewport: { width: 820, height: 1180 }, hasTouch: true }, mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } };
const num = (v, d, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
/** The run settings with defaults and limits applied. */
export function runSettings(run = {}) {
  const r = { ...RUN_DEFAULTS, ...run };
  return { ...r, retries: num(r.retries, 1, 0, 3), testTimeoutSec: num(r.testTimeoutSec, 90, 15, 600), actionTimeoutSec: num(r.actionTimeoutSec, 15, 2, 120),
    navTimeoutSec: num(r.navTimeoutSec, 30, 5, 180), expectTimeoutSec: num(r.expectTimeoutSec, 10, 2, 120), device: DEVICES[r.device] ? r.device : 'desktop',
    locale: String(r.locale || 'en-PH').slice(0, 20), timezoneId: String(r.timezoneId || 'Asia/Manila').slice(0, 60) };
}

/**
 * app.db: read-only SQL on the project's Test database, so a test can check what the app saved. Each query reads only
 * (see lib/dbdrivers.mjs), runs for 10 s at most, returns 500 rows at most, and queries run one at a time.
 * Opens the connection on first use. cfg = { url, engine, name }.
 */
function makeDb(cfg) {
  if (!cfg?.url) {
    const none = async () => { throw new Error('No Test database is set up for this project (Project settings → Database), so app.db.query() isn’t available.'); };
    return { api: { query: none }, close: async () => {} };
  }
  let conn = null, chain = Promise.resolve();
  const run = async (sql, params) => {
    conn ??= await openDb(cfg.engine || 'postgres', cfg.url, { readOnly: true, timeoutMs: 10000, purpose: 'test run' });
    try { return (await conn.query(String(sql), Array.isArray(params) ? params : [])).slice(0, 500); }
    catch (e) { throw new Error(`app.db.query failed: ${hideUrl(e.message, cfg.url)}`); }
  };
  return {
    api: { query: (sql, params = []) => { const p = chain.then(() => run(sql, params)); chain = p.catch(() => {}); return p; } },
    close: async () => { await chain; await conn?.close(); },
  };
}

const strip = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '').slice(0, 4000);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

export async function runOne(input, { signal } = {}) {
  const { chromium, expect } = await import('@playwright/test');
  const started = Date.now();
  const logs = [];
  let browser, page;
  const db = makeDb(input.app?.db);
  const result = { status: 'Fail', error: '', durationMs: 0, screenshot: null, logs };
  // Stopping the run closes the browser, which ends the script.
  const onAbort = () => { browser?.close().catch(() => {}); };
  signal?.addEventListener('abort', onAbort);
  try {
    // The browser chosen by the server: a remote one, Playwright's Chromium, or Chrome/Edge on this computer.
    browser = await launch(chromium, input.browser || { kind: 'bundled' }, { headless: input.headless !== false });
    if (signal?.aborted) throw new Error('Run stopped');
    const rs = runSettings(input.app?.run);
    const context = await browser.newContext({
      baseURL: input.baseUrl, ...DEVICES[rs.device], locale: rs.locale, timezoneId: rs.timezoneId,
      ignoreHTTPSErrors: Boolean(rs.ignoreHttpsErrors), reducedMotion: rs.reducedMotion === false ? 'no-preference' : 'reduce',
      serviceWorkers: 'block', // cached app shells make runs see old builds
    });
    absoluteNavigation(context, input.baseUrl);
    page = await context.newPage();
    page.setDefaultTimeout(rs.actionTimeoutSec * 1000);
    page.setDefaultNavigationTimeout(rs.navTimeoutSec * 1000);
    page.on('requestfailed', (r) => { if (logs.length < 50 && r.resourceType() !== 'image') logs.push(`request failed: ${r.method()} ${r.url().slice(0, 200)} (${r.failure()?.errorText || 'error'})`); });
    page.on('response', (r) => { if (logs.length < 50 && r.status() >= 500) logs.push(`server error ${r.status()}: ${r.request().method()} ${r.url().slice(0, 200)}`); });
    page.on('console', (m) => { if (logs.length < 50) logs.push(`console.${m.type()}: ${m.text().slice(0, 300)}`); });
    page.on('pageerror', (e) => { if (logs.length < 50) logs.push(`page error: ${e.message.slice(0, 300)}`); });
    const exp = expect.configure({ timeout: rs.expectTimeoutSec * 1000 });
    const app = makeApp(page, exp, input.app || {});
    app.db = db.api;
    // Scripts are written as the body of async ({ page, expect, baseURL, app }) => { … }
    const fn = new AsyncFunction('page', 'expect', 'baseURL', 'app', input.code);
    let timer;
    try {
      await Promise.race([
        fn(page, exp, input.baseUrl, app),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`Test timed out after ${Math.round(input.timeoutMs / 1000)}s`)), input.timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
    result.status = 'Pass';
  } catch (err) {
    result.status = 'Fail';
    const msg = hideEndpoint(strip(err?.message || err), input.browser);
    result.error = signal?.aborted ? 'Run stopped' : !page && input.browser?.kind === 'remote' ? `Couldn’t connect to the remote browser: ${explainConnectError(msg, input.browser)}` : msg;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    result.durationMs = Date.now() - started;
    // Never let a saved password show up in an error or a console log.
    result.error = maskSecrets(result.error, input.app);
    for (let i = 0; i < logs.length; i++) logs[i] = maskSecrets(logs[i], input.app);
    // Where the page was when the test failed: evidence for the failure analysis.
    if (page && result.status !== 'Pass' && !signal?.aborted) {
      try {
        const text = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
        result.page = { url: page.url(), title: await page.title().catch(() => ''), text: maskSecrets(String(text).replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').slice(0, 1500), input.app) };
        // Interactive elements as the user would find them (role / label / test id): what the Self-healing Agent repairs locators from.
        const els = await page.evaluate(() => [...document.querySelectorAll('a,button,input,select,textarea,[role],[data-testid],label,h1,h2,h3')]
          .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).slice(0, 160)
          .map((e) => {
            const tag = e.tagName.toLowerCase(), role = e.getAttribute('role') || '', type = e.getAttribute('type') || '', tid = e.getAttribute('data-testid') || '';
            const name = (e.getAttribute('aria-label') || (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement ? (e.labels?.[0]?.innerText || e.placeholder) : e.innerText) || e.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 70);
            return `${tag}${role ? `[role=${role}]` : ''}${type ? `[type=${type}]` : ''}${tid ? `[data-testid=${tid}]` : ''}${name ? ` "${name}"` : ''}`;
          })).catch(() => []);
        result.page.elements = maskSecrets([...new Set(els)].join('\n'), input.app).slice(0, 6000);
      } catch { /* page gone */ }
    }
    if (page && input.screenshotPath && !signal?.aborted) {
      try { await page.screenshot({ path: input.screenshotPath, type: 'jpeg', quality: 70, timeout: 5000 }); result.screenshot = input.screenshotPath; } catch { /* page gone */ }
    }
    await browser?.close().catch(() => {});
    await db.close();
  }
  return result;
}
