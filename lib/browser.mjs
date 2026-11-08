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
      win32: [`${process.env.PROGRAMFILES || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`],
    },
  },
  msedge: {
    label: 'Microsoft Edge',
    paths: {
      darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
      linux: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge'],
      win32: [`${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`, `${process.env.PROGRAMFILES || 'C:\\Program Files'}\\Microsoft\\Edge\\Application\\msedge.exe`],
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
  } catch { return false; }
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

/** Starts (or connects to) the chosen browser. */
export async function launch(chromium, spec, { headless = true } = {}) {
  if (!spec) throw new Error('No test browser is available. Install it from the Test automation page, or connect a remote browser.');
  if (spec.kind === 'remote') {
    return spec.protocol === 'cdp'
      ? chromium.connectOverCDP(spec.url, { timeout: 30000 })
      : chromium.connect(spec.url, { timeout: 30000 });
  }
  if (spec.kind === 'system') return chromium.launch({ headless, channel: spec.channel });
  return chromium.launch({ headless });
}

/** Never show a remote browser's address (it often holds a token) in errors or logs. */
export function hideEndpoint(text, spec) {
  let out = String(text ?? '');
  if (spec?.kind === 'remote' && spec.url) {
    out = out.split(spec.url).join('[remote browser]');
    try { const u = new URL(spec.url); for (const v of u.searchParams.values()) if (v.length >= 6) out = out.split(v).join('••••••'); } catch { /* not a URL */ }
  }
  return out;
}

/** Short, human description of the browser in use. */
export function describeBrowser(spec) {
  if (!spec) return 'none';
  if (spec.kind === 'remote') { try { return `Remote browser (${new URL(spec.url).host})`; } catch { return 'Remote browser'; } }
  if (spec.kind === 'system') return `${spec.label} on this computer`;
  return 'Playwright Chromium';
}
