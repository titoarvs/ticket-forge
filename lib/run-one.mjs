// Runs ONE generated Playwright script and reports how it went. Used by runner.mjs (its own process, on a regular
// server) and directly inside the request on serverless hosting, where starting another process isn't reliable.
// input: { code, baseUrl, screenshotPath, timeoutMs, headless, app, browser }
//   app = the project's App setup (pages, login settings, roles with passwords) for the `app` helper;
//   browser = which browser to use (see browser.mjs).
// Returns { status: 'Pass'|'Fail', error, durationMs, screenshot, logs }.
import { makeApp, maskSecrets } from './app-helpers.mjs';
import { launch, hideEndpoint } from './browser.mjs';

const strip = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '').slice(0, 4000);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

export async function runOne(input, { signal } = {}) {
  const { chromium, expect } = await import('@playwright/test');
  const started = Date.now();
  const logs = [];
  let browser, page;
  const result = { status: 'Fail', error: '', durationMs: 0, screenshot: null, logs };
  // Stopping the run closes the browser, which ends the script.
  const onAbort = () => { browser?.close().catch(() => {}); };
  signal?.addEventListener('abort', onAbort);
  try {
    // The browser chosen by the server: a remote one, Playwright's Chromium, or Chrome/Edge on this computer.
    browser = await launch(chromium, input.browser || { kind: 'bundled' }, { headless: input.headless !== false });
    if (signal?.aborted) throw new Error('Run stopped');
    const context = await browser.newContext({ baseURL: input.baseUrl, viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(20000);
    page.on('console', (m) => { if (logs.length < 50) logs.push(`console.${m.type()}: ${m.text().slice(0, 300)}`); });
    page.on('pageerror', (e) => { if (logs.length < 50) logs.push(`page error: ${e.message.slice(0, 300)}`); });
    const exp = expect.configure({ timeout: 8000 });
    const app = makeApp(page, exp, input.app || {});
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
    result.error = signal?.aborted ? 'Run stopped' : hideEndpoint(strip(err?.message || err), input.browser);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    result.durationMs = Date.now() - started;
    // Never let a saved password show up in an error or a console log.
    result.error = maskSecrets(result.error, input.app);
    for (let i = 0; i < logs.length; i++) logs[i] = maskSecrets(logs[i], input.app);
    if (page && input.screenshotPath && !signal?.aborted) {
      try { await page.screenshot({ path: input.screenshotPath, type: 'jpeg', quality: 70, timeout: 5000 }); result.screenshot = input.screenshotPath; } catch { /* page gone */ }
    }
    await browser?.close().catch(() => {});
  }
  return result;
}
