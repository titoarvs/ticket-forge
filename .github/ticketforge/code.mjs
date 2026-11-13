// TicketForge code runner for GitHub Actions (written by TicketForge; changes are overwritten on the next setup).
// Decrypts the job, runs Claude Code on the job's branch, commits and pushes, and writes the encrypted result.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const key = Buffer.from(process.env.TF_KEY || '', 'base64');
if (key.length !== 32) { console.error('The TICKETFORGE_RUN_KEY secret is missing. Run the setup again from TicketForge.'); process.exit(1); }
const open = (b64) => { const b = Buffer.from(b64, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(b.subarray(28)), d.final()]))); };
const seal = (obj) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(obj)))), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]); };
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const out = process.env.TF_OUT || '/tmp/ticketforge-out';
fs.mkdirSync(out, { recursive: true });
const finish = (r) => { fs.writeFileSync(out + '/result.bin', seal(r)); console.log(r.error ? 'Finished with an error' : 'Finished: ' + (r.files || []).length + ' files changed'); };

let job;
try { job = open(process.env.TF_PAYLOAD || ''); } catch { console.error('Couldn’t read the job: the TICKETFORGE_RUN_KEY secret doesn’t match TicketForge’s key. Run the setup again.'); process.exit(1); }
try {
  git('config', 'user.name', job.author?.name || 'TicketForge');
  git('config', 'user.email', job.author?.email || 'ticketforge@users.noreply.github.com');
  git('fetch', '--no-tags', 'origin', job.base);
  let existing = false;
  try { git('fetch', '--no-tags', 'origin', job.branch); existing = true; } catch { /* new branch */ }
  git('checkout', '-q', '-B', job.branch, existing ? 'origin/' + job.branch : 'origin/' + job.base);
  console.log('On ' + job.branch + (existing ? ' (continuing)' : ' (new, from ' + job.base + ')'));
  const args = ['-p', '--output-format', 'json', '--model', job.model || 'sonnet', '--permission-mode', 'acceptEdits',
    '--append-system-prompt', job.system || '', '--allowedTools', (job.allowedTools || []).join(' '), '--disallowedTools', (job.disallowedTools || []).join(' ')];
  if (job.effort) args.push('--effort', job.effort);
  const r = spawnSync('claude', args, { input: job.prompt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: (job.timeoutMin || 50) * 60000 });
  let res = {};
  try { res = JSON.parse(String(r.stdout || '').trim().split('\n').pop() || '{}'); } catch { res = { is_error: true, result: (r.stderr || r.stdout || 'Claude Code failed').slice(-2000) }; }
  if (r.status !== 0 && !res.result) res = { is_error: true, result: String(r.stderr || 'Claude Code stopped').slice(-2000) };
  git('add', '-A');
  const files = git('diff', '--cached', '--numstat').split('\n').filter(Boolean).map((l) => { const [a, d, f] = l.split('\t'); return { path: f, added: Number(a) || 0, removed: Number(d) || 0 }; });
  const diff = files.length ? git('diff', '--cached', '--no-color').slice(0, 400000) : '';
  let sha = '';
  if (files.length) {
    git('commit', '-q', '--no-verify', '-m', job.commitMessage || 'TicketForge: changes');
    git('push', '-q', 'origin', 'HEAD:refs/heads/' + job.branch);
    sha = git('rev-parse', '--short', 'HEAD');
    console.log('Pushed ' + sha + ' to ' + job.branch);
  }
  finish({ runId: job.runId, summary: String(res.result || '').slice(0, 60000), error: res.is_error ? String(res.result || 'Claude Code failed').slice(0, 2000) : '', costUsd: res.total_cost_usd || 0, files, diff, sha, branch: job.branch });
} catch (e) {
  finish({ runId: job.runId, error: String(e.message || e).replace(/AUTHORIZATION: [^\s]+ [^\s]+/gi, '').slice(0, 2000), files: [] });
  process.exitCode = 1;
}
