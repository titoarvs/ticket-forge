import { api, perm, body, HttpError } from '@/lib/server/http';
import { engineStatus } from '@/lib/automation';
import { publicRemoteBrowser, saveRemoteBrowser, clearRemoteBrowser, checkBrowserUrl } from '@/lib/settings';
import { launch, hideEndpoint, describeBrowser, normalizeRemote, explainConnectError } from '@/lib/browser.mjs';

// Driving a browser takes a while: let this run up to 2 minutes on serverless hosting (Vercel).
export const maxDuration = 120;

// The test browser, for administrators: what is in use, and a remote browser to connect (needed on serverless
// hosting). The address is stored encrypted and never sent back.

export const GET = api(async () => {
  await perm('users.manage');
  return { engine: await engineStatus(), remote: await publicRemoteBrowser() };
});

/** Saves a remote browser address after checking that it connects. */
export const PUT = api(async (req) => {
  const user = await perm('users.manage');
  const b = await body(req);
  const spec = remoteSpec(b);
  const test = await tryBrowser(spec);
  if (!test.ok && !b.force) throw new HttpError(400, `Couldn’t connect: ${test.error}`);
  await saveRemoteBrowser(user, { url: spec.url, protocol: spec.protocol });
  return { ok: true, test, corrected: spec.corrected, engine: await engineStatus(), remote: await publicRemoteBrowser() };
});

export const DELETE = api(async () => {
  await perm('users.manage');
  await clearRemoteBrowser();
  return { engine: await engineStatus(), remote: await publicRemoteBrowser() };
});

/** Tests the browser in use (or an address typed in the form) by opening a blank page. */
export const POST = api(async (req) => {
  await perm('users.manage');
  const b = await body(req);
  if (b.url) { const spec = remoteSpec(b); return { ...(await tryBrowser(spec)), corrected: spec.corrected }; }
  const { browserSpec } = await import('@/lib/automation');
  return tryBrowser(await browserSpec());
});

/** The address typed in the form, corrected when it's a Browserless address copied from the wrong place. */
function remoteSpec(b: any) {
  const protocol = b.protocol === 'cdp' ? 'cdp' : 'playwright';
  const n = normalizeRemote(checkBrowserUrl(b.url), protocol);
  return { kind: 'remote', url: n.url, protocol, corrected: n.changed };
}

async function tryBrowser(spec: any) {
  const started = Date.now();
  try {
    const { chromium } = await import('@playwright/test');
    const browser = await launch(chromium, spec);
    try {
      const page = await (await browser.newContext()).newPage();
      await page.goto('about:blank');
      return { ok: true, browser: describeBrowser(spec), version: browser.version(), ms: Date.now() - started };
    } finally { await browser.close().catch(() => {}); }
  } catch (e: any) {
    return { ok: false, browser: describeBrowser(spec), error: explainConnectError(hideEndpoint(String(e?.message || e).split('\n')[0], spec), spec), ms: Date.now() - started };
  }
}
