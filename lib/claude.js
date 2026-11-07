// Claude providers.
//  - "cli": shells out to the Claude Code CLI (`claude -p`), which uses the Claude
//    account you are logged into on this machine. No API key needed.
//  - "api": uses the Anthropic SDK with ANTHROPIC_API_KEY.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { DATA_DIR } from './db.js';

let CLI_BIN = process.env.CLAUDE_BIN || 'claude';
const LOCAL_CLI_DIR = path.join(DATA_DIR, 'claude-code');
const WORKDIR = path.join(os.tmpdir(), 'ticketforge-claude');
fs.mkdirSync(WORKDIR, { recursive: true });

export const DEFAULT_API_MODEL = 'claude-opus-5-5';
export const DEFAULT_CLI_MODEL = 'opus';

// Candidate Claude Code executables: $CLAUDE_BIN, `claude` on PATH, native installs, and the copy
// bundled with the Claude desktop app. The newest version wins, because old versions can't use
// current models.
function candidateBins() {
  if (process.env.CLAUDE_BIN) return [process.env.CLAUDE_BIN];
  const home = os.homedir();
  const out = ['claude'];
  const globDir = (dir, sub = []) => {
    try {
      return fs.readdirSync(dir).flatMap((v) => {
        const base = path.join(dir, v);
        if (!sub.length) return [base];
        return globDir(base, sub.slice(1)).map((x) => x);
      });
    } catch { return []; }
  };
  out.push(...globDir(path.join(home, '.local', 'share', 'claude', 'versions')));
  for (const d of globDir(path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code'), ['*'])) {
    out.push(path.join(d, 'claude.app', 'Contents', 'MacOS', 'claude'));
  }
  out.push(path.join(home, '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude');
  out.push(path.join(LOCAL_CLI_DIR, 'node_modules', '.bin', 'claude')); // installed from Administration → Claude
  return [...new Set(out)];
}
const versionOf = (bin) => new Promise((resolve) => {
  execFile(/*turbopackIgnore: true*/ bin, ['--version'], { timeout: 15000 }, (err, stdout) => {
    const m = !err && String(stdout).match(/(\d+)\.(\d+)\.(\d+)/);
    resolve(m ? { bin, version: m[0], n: [Number(m[1]), Number(m[2]), Number(m[3])] } : null);
  });
});
const newer = (a, b) => { for (let i = 0; i < 3; i++) if (a.n[i] !== b.n[i]) return a.n[i] > b.n[i]; return false; };

let cliInfoPromise = null;
export function cliInfo() {
  cliInfoPromise ??= (async () => {
    const found = (await Promise.all(candidateBins().map(versionOf))).filter(Boolean);
    if (!found.length) return { available: false };
    const best = found.reduce((a, b) => (newer(b, a) ? b : a));
    CLI_BIN = best.bin;
    const outdated = best.n[0] < 2 || (best.n[0] === 2 && best.n[1] < 1);
    return { available: true, version: `${best.version} (Claude Code)`, path: best.bin, outdated };
  })();
  return cliInfoPromise;
}

/** Which providers work. `account` says whether Claude Code is signed in (null when unknown). */
export async function providerStatus({ details = false } = {}) {
  const cli = await cliInfo();
  const api = Boolean(process.env.ANTHROPIC_API_KEY);
  const acct = cli.available ? await accountStatus() : null;
  const signedIn = Boolean(cli.available && acct?.loggedIn !== false);
  const preferred = process.env.TICKETFORGE_PROVIDER || (signedIn ? 'cli' : api ? 'api' : 'none');
  const account = acct && (details ? acct : { loggedIn: acct.loggedIn, subscriptionType: acct.subscriptionType || null });
  return { cli: { ...cli, signedIn }, api, account, defaultProvider: preferred, defaultModels: { cli: DEFAULT_CLI_MODEL, api: DEFAULT_API_MODEL } };
}

// ---------------------------------------------------------------- signing Claude Code in from the app
// Claude Code keeps its own login (in ~/.claude for the user running TicketForge, or the macOS keychain).
// TicketForge never sees or stores the token: it runs `claude auth login`, shows the sign-in link, and passes
// the code Claude displays back to it.
const G = globalThis;
G.__tfClaude ??= { status: null, statusAt: 0, login: null };
const C = G.__tfClaude;

function cliEnv() {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  if (!process.env.TICKETFORGE_CLI_USE_API_KEY) delete env.ANTHROPIC_API_KEY;
  return env;
}
// Stops Claude Code from opening a browser on the server: the person signing in uses their own browser.
function noBrowserEnv() {
  const dir = path.join(WORKDIR, 'no-browser');
  fs.mkdirSync(dir, { recursive: true });
  for (const n of ['open', 'xdg-open', 'wslview', 'sensible-browser', 'x-www-browser']) {
    const f = path.join(dir, n);
    if (!fs.existsSync(f)) fs.writeFileSync(f, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  const env = cliEnv();
  env.PATH = `${dir}${path.delimiter}${env.PATH || ''}`;
  env.BROWSER = path.join(dir, 'open');
  return env;
}
function runCli(args, { timeout = 20000, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(/*turbopackIgnore: true*/ CLI_BIN, args, { cwd: WORKDIR, env: cliEnv(), timeout, maxBuffer: 1 << 20 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

/** Signed-in state of Claude Code, cached for a minute. */
export async function accountStatus({ fresh = false } = {}) {
  if (!fresh && C.status && Date.now() - C.statusAt < 60000) return C.status;
  await cliInfo();
  const r = await runCli(['auth', 'status', '--json']);
  let st;
  try {
    const j = JSON.parse(r.stdout);
    st = { loggedIn: Boolean(j.loggedIn), authMethod: j.authMethod || null, email: j.email || null, orgName: j.orgName || null, subscriptionType: j.subscriptionType || null };
  } catch {
    st = { loggedIn: null }; // an older Claude Code without `claude auth`: unknown, so don't block it
  }
  C.status = st; C.statusAt = Date.now();
  return st;
}
/** A user-facing error (HTTP 400) rather than a server failure. */
const fail = (msg) => Object.assign(new Error(msg), { status: 400 });
const forgetStatus = () => { C.status = null; C.statusAt = 0; };

function stopLogin() {
  if (!C.login) return;
  clearTimeout(C.login.timer);
  const { child } = C.login;
  try { child.stdin.end(); child.kill('SIGTERM'); } catch { /* gone */ }
  setTimeout(() => { if (child.exitCode == null && child.signalCode == null) try { child.kill('SIGKILL'); } catch { /* gone */ } }, 3000).unref?.();
  C.login = null;
}
const clean = (t) => String(t || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/https:\/\/\S+/g, '').replace(/Paste code here if prompted >/g, '').trim();

/** Starts `claude auth login` and returns the sign-in link. Only one sign-in runs at a time. */
export async function startLogin({ console: useConsole = false } = {}) {
  const cli = await cliInfo();
  if (!cli.available) throw fail('Claude Code is not installed on the server yet. Install it first.');
  stopLogin();
  const id = crypto.randomUUID();
  const child = spawn(/*turbopackIgnore: true*/ CLI_BIN, ['auth', 'login', useConsole ? '--console' : '--claudeai'], { cwd: WORKDIR, env: noBrowserEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  const login = { id, child, out: '', exited: null, waiters: [] };
  const onData = (d) => { login.out += d.toString('utf8'); login.waiters.forEach((w) => w()); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (e) => { login.out += `\n${e.message}`; login.exited = -1; login.waiters.forEach((w) => w()); });
  child.on('close', (code) => { login.exited = code ?? -1; login.waiters.forEach((w) => w()); });
  login.timer = setTimeout(() => { if (C.login?.id === id) stopLogin(); }, 15 * 60000);
  C.login = login;
  const url = await new Promise((resolve, reject) => {
    const check = () => {
      const m = login.out.match(/https:\/\/\S*oauth\/authorize\S+/);
      if (m) return resolve(m[0]);
      if (login.exited != null) return reject(new Error(`Claude Code didn't start the sign-in: ${clean(login.out).slice(-400) || `exit code ${login.exited}`}`));
    };
    login.waiters.push(check);
    setTimeout(() => reject(new Error('Claude Code took too long to start the sign-in.')), 30000);
    check();
  }).catch((e) => { stopLogin(); throw e; });
  return { id, url };
}

/** Finishes the sign-in with the code Claude showed after the person approved it. */
export async function finishLogin(id, code) {
  const login = C.login;
  if (!login || login.id !== id) throw fail('This sign-in has expired. Start again.');
  const value = String(code || '').trim();
  if (!value || /\s/.test(value)) throw fail('Paste the code exactly as Claude shows it.');
  const before = login.out.length;
  login.child.stdin.write(`${value}\n`);
  await new Promise((resolve) => {
    const check = () => { if (login.exited != null) resolve(); };
    login.waiters.push(check);
    setTimeout(resolve, 60000);
    check();
  });
  const said = clean(login.out.slice(before));
  const exited = login.exited;
  stopLogin();
  forgetStatus();
  const st = await accountStatus({ fresh: true });
  if (!st.loggedIn) {
    const why = said.replace(/^(Login|Sign-in) failed:\s*/i, '').slice(-300);
    throw fail(why ? `Sign-in failed: ${why}` : `Claude didn't accept that code${exited == null ? ' (no answer within a minute)' : ''}. Start the sign-in again and paste the newest code.`);
  }
  return st;
}
export function cancelLogin(id) { if (!id || C.login?.id === id) stopLogin(); }

export async function logout() {
  stopLogin();
  const r = await runCli(['auth', 'logout']);
  forgetStatus();
  if (r.code !== 0) throw new Error(`Sign-out failed: ${clean(r.stderr || r.stdout).slice(-300)}`);
  return accountStatus({ fresh: true });
}

/** Installs Claude Code inside TicketForge's data folder (no admin rights needed), then uses it. */
export function installCli(onLine) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(LOCAL_CLI_DIR, { recursive: true });
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(/*turbopackIgnore: true*/ npm, ['install', '--no-audit', '--no-fund', '--prefix', LOCAL_CLI_DIR, '@anthropic-ai/claude-code@latest'], { cwd: LOCAL_CLI_DIR, env: process.env });
    const pipe = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => onLine(l));
    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);
    child.on('error', (e) => reject(new Error(`Could not run npm: ${e.message}`)));
    child.on('close', async (code) => {
      if (code !== 0) return reject(new Error(`Installing Claude Code failed (npm exit code ${code}).`));
      cliInfoPromise = null; forgetStatus();
      const info = await cliInfo();
      if (!info.available) return reject(new Error('Claude Code was installed but could not be started.'));
      resolve(info);
    });
  });
}

/**
 * Ask Claude once. Returns the full text reply.
 * opts: { system, prompt, provider, model, onText(chunkLength,totalLength), signal }
 */
export async function askClaude(opts) {
  const status = await providerStatus();
  const provider = opts.provider || status.defaultProvider;
  if (provider === 'cli') {
    if (!status.cli.available) throw new Error('Claude Code is not installed on the server. An administrator can install it and sign in under Administration → Claude, or set ANTHROPIC_API_KEY.');
    if (status.account?.loggedIn === false) throw new Error('No Claude account is signed in on the server. An administrator can sign in under Administration → Claude.');
    return askViaCli({ ...opts, model: opts.model || DEFAULT_CLI_MODEL });
  }
  if (provider === 'api') {
    if (!status.api) throw new Error('ANTHROPIC_API_KEY is not set.');
    return askViaApi({ ...opts, model: opts.model || DEFAULT_API_MODEL });
  }
  throw new Error('Claude is not connected. An administrator can sign in with a Claude account under Administration → Claude, or set ANTHROPIC_API_KEY.');
}

function askViaCli({ system, prompt, model, onText, signal }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model', model,
      '--tools', '',
      '--strict-mcp-config',
      '--system-prompt', system,
    ];
    // Keeps the CLI on the signed-in Claude account unless TICKETFORGE_CLI_USE_API_KEY is set.
    const env = cliEnv();
    const child = spawn(/*turbopackIgnore: true*/ CLI_BIN, args, { cwd: WORKDIR, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    let streamed = '';
    let finalResult = null;
    let errorText = '';
    let stderr = '';

    const onAbort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', onAbort);

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type === 'stream_event' && evt.event?.type === 'content_block_delta' && evt.event.delta?.type === 'text_delta') {
          streamed += evt.event.delta.text;
          onText?.(evt.event.delta.text.length, streamed.length);
        } else if (evt.type === 'result') {
          if (evt.is_error || evt.subtype !== 'success') errorText = evt.result || evt.subtype || 'Claude CLI returned an error';
          else finalResult = evt.result;
        }
      }
    });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new Error('Cancelled'));
      if (errorText) {
        const hint = /does not support this model|not_found_error|model:/i.test(errorText)
          ? ' Your Claude Code version may be too old for this model: run `claude update`, or pick another model in the connection settings.' : '';
        return reject(new Error(errorText + hint));
      }
      const text = finalResult ?? streamed;
      if (!text) return reject(new Error(`Claude CLI exited with code ${code}. ${stderr.slice(-800)}`.trim()));
      resolve(text);
    });
    child.stdin.end(prompt);
  });
}

let apiClient = null;
async function askViaApi({ system, prompt, model, onText, signal }) {
  apiClient ??= new Anthropic();
  const params = {
    model,
    max_tokens: 64000,
    system,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    messages: [{ role: 'user', content: prompt }],
  };
  // Server-side refusal fallback is supported on the current Opus/Sonnet models.
  const useFallback = /^claude-(opus-5|sonnet-5-5|fable-5-1)/.test(model);
  const stream = useFallback
    ? apiClient.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
    : apiClient.messages.stream(params, { signal });
  let total = 0;
  stream.on('text', (t) => { total += t.length; onText?.(t.length, total); });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') {
    throw new Error(`Claude declined this request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ''}.`);
  }
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (msg.stop_reason === 'max_tokens') throw new Error('Response hit the output limit. Try a smaller document or fewer tickets per run.');
  return text;
}

/** Extract the first JSON object/array from a model reply. */
export function extractJson(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/[[{]/);
  if (start < 0) throw new Error('No JSON found in Claude response');
  const open = t[start];
  const close = open === '{' ? '}' : ']';
  const end = t.lastIndexOf(close);
  return JSON.parse(t.slice(start, end + 1));
}

/** Ask for JSON; if parsing fails, ask Claude once to repair its own output. */
export async function askJson(opts) {
  const text = await askClaude(opts);
  try {
    return extractJson(text);
  } catch (err) {
    const repaired = await askClaude({
      ...opts,
      onText: undefined,
      system: 'You repair malformed JSON. Output only the corrected JSON, nothing else.',
      prompt: `This JSON failed to parse (${err.message}). Fix it and return valid JSON only, preserving all content:\n\n${text}`,
    });
    return extractJson(repaired);
  }
}
