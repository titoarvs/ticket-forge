// Runs ONE generated Playwright script in its own process.
// Input (stdin, JSON): { code, baseUrl, screenshotPath, timeoutMs, headless, app }
//   app = the project's App setup (pages, login settings, roles with passwords) for the `app` helper.
// Output (stdout, last line JSON): { status: 'Pass'|'Fail', error, durationMs, screenshot, logs }
import { chromium, expect } from '@playwright/test';
import { makeApp, maskSecrets } from './app-helpers.mjs';

const readStdin = async () => { let s = ''; for await (const c of process.stdin) s += c; return s; };
const strip = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '').slice(0, 4000);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

const input = JSON.parse(await readStdin());
const started = Date.now();
const logs = [];
let browser, page;
const result = { status: 'Fail', error: '', durationMs: 0, screenshot: null, logs };

try {
  browser = await chromium.launch({ headless: input.headless !== false });
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
  await Promise.race([
    fn(page, exp, input.baseUrl, app),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`Test timed out after ${Math.round(input.timeoutMs / 1000)}s`)), input.timeoutMs); }),
  ]);
  clearTimeout(timer);
  result.status = 'Pass';
} catch (err) {
  result.status = 'Fail';
  result.error = strip(err?.message || err);
} finally {
  result.durationMs = Date.now() - started;
  // Never let a saved password show up in an error or a console log.
  result.error = maskSecrets(result.error, input.app);
  for (let i = 0; i < logs.length; i++) logs[i] = maskSecrets(logs[i], input.app);
  if (page && input.screenshotPath) {
    try { await page.screenshot({ path: input.screenshotPath, type: 'jpeg', quality: 70, timeout: 5000 }); result.screenshot = input.screenshotPath; } catch { /* page gone */ }
  }
  await browser?.close().catch(() => {});
  process.stdout.write(`\n${JSON.stringify(result)}\n`);
  process.exit(0);
}
