// GitHub Copilot as the local AI (Administration → AI → Local AI), through the GitHub Copilot CLI (`copilot`,
// npm @github/copilot). Like Claude Code for your Claude account: it runs on this computer with your own Copilot
// subscription, signed in once with `copilot` → /login (or COPILOT_GITHUB_TOKEN / GH_TOKEN with Copilot access).
// It only answers prompts: no tools are allowed and it runs in an empty folder, so it can't read or change files.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const G = globalThis;
G.__tfCopilot ??= { info: null, at: 0, dropFlags: new Set() };
const C = G.__tfCopilot;
const WORKDIR = path.join(os.tmpdir(), 'ticketforge-copilot');

/** Models the Copilot CLI offers (it accepts others your plan allows). '' = the CLI's default. */
export const COPILOT_MODELS = ['', 'claude-sonnet-4.5', 'claude-opus-4.1', 'gpt-5', 'gpt-5-mini', 'gpt-4.1'];

function candidates() {
  if (process.env.COPILOT_BIN) return [process.env.COPILOT_BIN];
  const home = os.homedir();
  const out = ['copilot', '/opt/homebrew/bin/copilot', '/usr/local/bin/copilot', path.join(home, '.npm-global/bin/copilot'), path.join(home, '.local/bin/copilot'), path.join(home, '.volta/bin/copilot')];
  try { for (const v of fs.readdirSync(path.join(home, '.nvm/versions/node'))) out.push(path.join(home, '.nvm/versions/node', v, 'bin/copilot')); } catch { /* no nvm */ }
  return [...new Set(out)];
}
const versionOf = (bin) => new Promise((resolve) => {
  execFile(bin, ['--version'], { timeout: 8000, env: { ...process.env, NO_COLOR: '1' } }, (err, out) => {
    const v = String(out || '').match(/\d+\.\d+\.\d+/);
    resolve(err || !v ? null : { bin, version: v[0] });
  });
});
/** { available, version, path } — cached for a minute (install it, then press "Check again"). */
export async function copilotInfo({ fresh = false } = {}) {
  if (!fresh && C.info && Date.now() - C.at < 60000) return C.info;
  const found = (await Promise.all(candidates().map(versionOf))).filter(Boolean);
  C.info = found.length ? { available: true, version: found[0].version, path: found[0].bin } : { available: false };
  C.at = Date.now();
  return C.info;
}

const SIGNIN_RE = /not (logged|signed) in|no authentication|please (run )?\/?login|authenticate|unauthori[sz]ed|\b401\b|bad credentials|token (is )?(invalid|expired)/i;
const QUOTA_RE = /quota|premium requests?|rate.?limit|limit (reached|exceeded)|too many requests|\b429\b/i;
const OPTIONAL_FLAGS = ['--silent', '--no-color', '--no-custom-instructions'];

/**
 * Asks Copilot once and returns its text. opts: { system, prompt, model, signal }. Errors carry httpStatus 401 (sign in)
 * or 429 (quota/limit) so TicketForge can switch to the next AI.
 */
export async function askViaCopilot({ system, prompt, model, signal }) {
  const info = await copilotInfo();
  if (!info.available) throw Object.assign(new Error('The GitHub Copilot CLI isn’t installed on this computer. Install it with `npm install -g @github/copilot`, run `copilot` once and sign in with /login.'), { code: 'ENOENT' });
  fs.mkdirSync(WORKDIR, { recursive: true });
  const text = `${system ? `Follow these instructions exactly:\n${system}\n\n---\n\n` : ''}${prompt}\n\nAnswer directly. Do not use any tools, do not read or write files, and do not ask questions.`;
  const run = (flags) => new Promise((resolve, reject) => {
    const args = ['-p', text, ...flags, ...(model ? ['--model', model] : [])];
    const child = spawn(info.path, args, { cwd: WORKDIR, env: { ...process.env, NO_COLOR: '1', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const onAbort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', onAbort);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new Error('Cancelled'));
      const msg = `${err}\n${code ? out : ''}`.trim();
      const unknown = msg.match(/unknown option ['"]?(--[\w-]+)/i);
      if (code && unknown) return reject(Object.assign(new Error(msg), { unknownFlag: unknown[1] }));
      if (code || (!out.trim() && msg)) {
        if (SIGNIN_RE.test(msg)) return reject(Object.assign(new Error('GitHub Copilot isn’t signed in on this computer. Run `copilot` in a terminal and sign in with /login.'), { httpStatus: 401 }));
        if (QUOTA_RE.test(msg)) return reject(Object.assign(new Error(`GitHub Copilot: ${msg.split('\n').find((l) => QUOTA_RE.test(l)) || 'usage limit reached'}`), { httpStatus: 429, retryAfterMs: 30 * 6e4 }));
        return reject(new Error(`GitHub Copilot exited with code ${code}: ${msg.slice(-800)}`));
      }
      // --silent leaves only the answer; older versions print usage stats after it.
      resolve(out.replace(/\u001b\[[0-9;]*m/g, '').replace(/\n+(Total usage est|Total duration|Usage by model|Total code changes)[\s\S]*$/i, '').trim());
    });
  });
  // Versions that don't know an optional flag: drop it and try again (remembered for next time).
  for (let i = 0; i <= OPTIONAL_FLAGS.length; i++) {
    try { return await run(OPTIONAL_FLAGS.filter((f) => !C.dropFlags.has(f))); }
    catch (e) { if (e.unknownFlag && OPTIONAL_FLAGS.includes(e.unknownFlag) && !C.dropFlags.has(e.unknownFlag)) { C.dropFlags.add(e.unknownFlag); continue; } throw e; }
  }
  throw new Error('GitHub Copilot couldn’t be run.');
}
