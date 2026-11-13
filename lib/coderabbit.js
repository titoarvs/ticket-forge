// CodeRabbit (https://coderabbit.ai) reviews of the code an AI job wrote, run with the CodeRabbit CLI on this computer.
// `coderabbit review --agent` prints NDJSON events; each "finding" has a severity, file, line range, title, comment and
// fix instructions for an agent. TicketForge keeps the findings on the job (and the browser saves them on the issue),
// so they can be fixed by the Build agent, filed as Bug issues, and counted in Reports.
// The CLI signs in with `coderabbit auth login` (in a terminal) or an Agentic API key saved for the project (encrypted).
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const SEVERITIES = ['critical', 'major', 'minor', 'trivial', 'info'];
const TIMEOUT_MS = 45 * 60 * 1000; // reviews can take 7–30+ minutes

function candidates() {
  const home = os.homedir();
  return [process.env.CODERABBIT_BIN, path.join(home, '.local', 'bin', 'coderabbit'), '/opt/homebrew/bin/coderabbit', '/usr/local/bin/coderabbit', 'coderabbit']
    .filter(Boolean);
}
const run = (bin, args, { timeout = 20000, cwd } = {}) => new Promise((resolve) => {
  execFile(/*turbopackIgnore: true*/ bin, args, { timeout, cwd, env: process.env, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});
const jsonLines = (text) => String(text).split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

let cache = null;
/** Is the CLI installed and signed in? Cached for a minute ({ fresh: true } to re-check). */
export async function codeRabbitStatus({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.value;
  let value = { installed: false };
  for (const bin of candidates()) {
    if (bin.includes('/') && !fs.existsSync(/*turbopackIgnore: true*/ bin)) continue;
    const v = await run(bin, ['--version']);
    if (v.err) continue;
    const auth = await run(bin, ['auth', 'status', '--agent']);
    const ev = jsonLines(auth.stdout);
    const blob = JSON.stringify(ev).toLowerCase() + auth.stdout.toLowerCase();
    const signedIn = !auth.err && !/not (logged|signed|authenticated)|unauthenticated|"authenticated":\s*false|"loggedin":\s*false/.test(blob);
    value = { installed: true, bin, version: (v.stdout.match(/\d+\.\d+\.\d+/) || [v.stdout.trim()])[0], signedIn };
    break;
  }
  cache = { at: Date.now(), value };
  return value;
}

const sev = (s) => (SEVERITIES.includes(String(s).toLowerCase()) ? String(s).toLowerCase() : 'info');
/** One CodeRabbit finding in TicketForge's shape (stable id, so its status survives re-reads). */
export function normFinding(f) {
  const file = String(f.fileName || f.file || '');
  const title = String(f.title || '').trim() || String(f.comment || f.codegenInstructions || '').split('\n')[0].slice(0, 140);
  const id = crypto.createHash('sha1').update([file, f.startLine, title].join('|')).digest('hex').slice(0, 12);
  return {
    id, severity: sev(f.severity), file, startLine: Number(f.startLine) || null, endLine: Number(f.endLine) || null, title,
    comment: String(f.comment || '').slice(0, 8000), fix: String(f.codegenInstructions || '').slice(0, 8000),
    suggestions: (Array.isArray(f.suggestions) ? f.suggestions : f.suggestions ? [f.suggestions] : []).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).slice(0, 5),
  };
}

/**
 * Reviews the job's uncommitted changes (TicketForge stages them in the worktree) with `coderabbit review --agent`.
 * `onEvent(kind, data)` is called for status lines and findings as they arrive. Resolves with { findings, complete }.
 */
export async function reviewWorktree({ dir, apiKey = '', onEvent = () => {}, register = () => {} }) {
  const st = await codeRabbitStatus();
  if (!st.installed) throw Object.assign(new Error('The CodeRabbit CLI isn’t installed on this computer. Install it (brew install coderabbit, or curl -fsSL https://cli.coderabbit.ai/install.sh | sh), then run `coderabbit auth login` once.'), { status: 400 });
  if (!st.signedIn && !apiKey) throw Object.assign(new Error('CodeRabbit isn’t signed in. Run `coderabbit auth login` in a terminal, or save an Agentic API key in Project settings → Code & GitHub.'), { status: 400 });
  const args = ['review', '--agent', '--uncommitted', '--include-untracked', '--dir', dir, ...(apiKey ? ['--api-key', apiKey] : [])];
  return new Promise((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ st.bin, args, { cwd: dir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    register(child);
    const findings = [];
    let buf = '', stderr = '', complete = null, error = null;
    const timer = setTimeout(() => { error = 'CodeRabbit took longer than 45 minutes and was stopped.'; child.kill('SIGTERM'); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'finding') { const f = normFinding(ev); if (!findings.some((x) => x.id === f.id)) { findings.push(f); onEvent('finding', f); } }
        else if (ev.type === 'status') onEvent('status', String(ev.message || ev.status || ev.phase || '').slice(0, 300));
        else if (ev.type === 'review_context') onEvent('status', `Reviewing ${ev.currentBranch || 'the changes'}${ev.expectedDuration ? ` (expected ${ev.expectedDuration})` : ''}…`);
        else if (ev.type === 'complete') complete = ev;
        else if (ev.type === 'error') error = String(ev.message || ev.error || ev.errorType || 'CodeRabbit reported an error.');
      }
    });
    child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-20000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !findings.length && !complete) return reject(new Error(error || stderr.trim().split('\n').slice(-2).join(' ') || `CodeRabbit stopped (exit ${code}).`));
      resolve({ findings, complete: complete ? { status: complete.status || '', outcome: complete.outcome || '', message: complete.message || '', unreviewedFileCount: complete.unreviewedFileCount || 0 } : null, error });
    });
  });
}
