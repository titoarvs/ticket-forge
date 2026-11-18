// Which browser the tests use, decided in one place (the test runner process imports this too):
//   1. a remote browser an administrator connected (Browserless or any Playwright / Chrome DevTools endpoint):
//      the only option on serverless hosting such as Vercel, where no browser can be installed;
//   2. Playwright's own Chromium, when installed;
//   3. Google Chrome or Microsoft Edge already on the computer.
import fs from 'node:fs';
import path from 'node:path';

const SYSTEM_BROWSERS = {
  chrome: {
    label: 'Google Chrome',
    paths: {
      darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
      linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'],
      win32: [
        `${process.env.PROGRAMFILES || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
      ],
    },
  },
  msedge: {
    label: 'Microsoft Edge',
    paths: {
      darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
      linux: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge'],
      win32: [
        `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${process.env.PROGRAMFILES || 'C:\\Program Files'}\\Microsoft\\Edge\\Application\\msedge.exe`,
      ],
    },
  },
};

/** Playwright's Chromium is installed (the full browser, or the headless shell used for headless runs). */
export function bundledChromium(chromium) {
  try {
    const exe = chromium.executablePath();
    if (exe && fs.existsSync(exe)) return true;
    // …/ms-playwright/chromium-1254/… → is …/ms-playwright/chromium_headless_shell-1254 there?
    const m = String(exe || '').match(/^(.*[\\/])chromium-(\d+)[\\/]/);
    return Boolean(m && fs.existsSync(path.join(m[1], `chromium_headless_shell-${m[2]}`)));
  } catch {
    return false;
  }
}

/** Chrome or Edge installed on this computer, if any: { channel, label }. */
export function systemBrowser() {
  for (const [channel, b] of Object.entries(SYSTEM_BROWSERS)) {
    if ((b.paths[process.platform] || []).some((p) => p && fs.existsSync(p))) return { channel, label: b.label };
  }
  return null;
}

/**
 * The browser to use: { kind: 'remote', url, protocol } | { kind: 'bundled' } | { kind: 'system', channel, label } | null.
 * `remote` = { url, protocol: 'playwright' | 'cdp' } from settings, if connected.
 */
export function pickBrowser(chromium, remote, { serverless = false } = {}) {
  if (remote?.url) return { kind: 'remote', url: remote.url, protocol: remote.protocol === 'cdp' ? 'cdp' : 'playwright' };
  if (serverless) return null;
  if (bundledChromium(chromium)) return { kind: 'bundled' };
  const sys = systemBrowser();
  return sys ? { kind: 'system', ...sys } : null;
}

/**
 * Turns a Browserless address copied from the wrong place (the REST API such as /function or /json, https://, or a
 * missing path) into the browser connection for the chosen protocol, keeping the token. Other addresses are
 * returned as they are. Returns { url, changed }.
 */
export function normalizeRemote(url, protocol = 'playwright') {
  let u;
  try {
    u = new URL(String(url || '').trim());
  } catch {
    return { url, changed: false };
  }
  if (!/(^|\.)browserless\.io$/i.test(u.hostname)) return { url: u.toString(), changed: false };
  const token = u.searchParams.get('token');
  const out = new URL(`wss://${u.host}`);
  out.pathname =
    protocol === 'cdp'
      ? '/'
      : /^\/(chromium|chrome|firefox|webkit)\/playwright\/?$/i.test(u.pathname)
        ? u.pathname
        : '/chromium/playwright';
  if (token) out.searchParams.set('token', token);
  for (const [k, v] of u.searchParams)
    if (k !== 'token' && protocol !== 'cdp' && /^(launch|stealth|blockAds|timeout)$/i.test(k)) out.searchParams.set(k, v);
  const tidy = (x) => x.replace(/\/\?/, '?').replace(/\/$/, '');
  const next = tidy(out.toString());
  return { url: next, changed: next !== tidy(u.toString()) };
}

/** A connection error in plain words, with what to do. */
export function explainConnectError(message, spec) {
  const m = String(message || '');
  const host = (() => {
    try {
      return new URL(spec?.url).host;
    } catch {
      return 'the remote browser';
    }
  })();
  const bl = /browserless\.io$/i.test(host);
  if (/Unexpected status 404|\b404\b/.test(m)) {
    return `${host} has no browser at that address (404). ${bl ? 'Use the WebSocket address, not the REST API: wss://' + host + '/chromium/playwright?token=… (Playwright) or wss://' + host + '?token=… (Chrome DevTools).' : 'Check the path: it should be the WebSocket endpoint your provider gives for Playwright or Chrome DevTools.'}`;
  }
  if (/Unexpected status 40[13]|\b40[13]\b|unauthori[sz]ed|forbidden|invalid token/i.test(m))
    return `${host} rejected the token (unauthorized). Copy the API token again from your ${bl ? 'Browserless account' : 'provider'}.`;
  if (/Unexpected status 428|version|mismatch/i.test(m))
    return `${host} doesn’t support this Playwright version. Choose “Chrome DevTools (CDP)” under Connects with: it works with any version.`;
  if (/Unexpected status 429|too many|concurrency|quota|units/i.test(m))
    return `${host} is at its limit (too many sessions or out of units on your plan). Try again shortly, or check your plan.`;
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) return `Can’t find ${host}. Check the address (and the region in it).`;
  if (/ECONNREFUSED|timeout|Timeout/i.test(m)) return `Couldn’t reach ${host} in time. Check the address, or try again.`;
  return m;
}

/** Starts (or connects to) the chosen browser. */
export async function launch(chromium, spec, { headless = true } = {}) {
  if (!spec) throw new Error('No test browser is available. Install it from the Test automation page, or connect a remote browser.');
  if (spec.kind === 'remote') {
    spec = { ...spec, url: normalizeRemote(spec.url, spec.protocol).url };
    return spec.protocol === 'cdp' ? chromium.connectOverCDP(spec.url, { timeout: 30000 }) : chromium.connect(spec.url, { timeout: 30000 });
  }
  if (spec.kind === 'system') return chromium.launch({ headless, channel: spec.channel });
  return chromium.launch({ headless });
}

/**
 * Makes page.goto('/path') go to a full URL. Playwright resolves relative URLs against baseURL inside the browser
 * server; remote browsers such as Browserless check navigations before that and block a bare "/path"
 * ("Blocked navigation to …"). Resolving here works the same with every browser. Also applies to pop-ups.
 */
export function absoluteNavigation(context, baseUrl) {
  const fix = (page) => {
    if (page.__tfAbs) return page;
    const goto = page.goto.bind(page);
    page.goto = (url, opts) => goto(/^[a-z][\w+.-]*:/i.test(String(url)) ? url : new URL(String(url), baseUrl || page.url()).href, opts);
    page.__tfAbs = true;
    return page;
  };
  context.pages().forEach(fix);
  context.on('page', fix);
  return fix;
}

/** Never show a remote browser's address (it often holds a token) in errors or logs. */
export function hideEndpoint(text, spec) {
  let out = String(text ?? '');
  if (spec?.kind === 'remote' && spec.url) {
    out = out.split(spec.url).join('[remote browser]');
    try {
      const u = new URL(spec.url);
      for (const v of u.searchParams.values()) if (v.length >= 6) out = out.split(v).join('••••••');
    } catch {
      /* not a URL */
    }
  }
  return out;
}

/** Short, human description of the browser in use. */
export function describeBrowser(spec) {
  if (!spec) return 'none';
  if (spec.kind === 'remote') {
    try {
      return `Remote browser (${new URL(spec.url).host})`;
    } catch {
      return 'Remote browser';
    }
  }
  if (spec.kind === 'system') return `${spec.label} on this computer`;
  return 'Playwright Chromium';
}
