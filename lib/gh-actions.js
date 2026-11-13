// Playwright tests on GitHub Actions. TicketForge sends the run (scripts, App setup with test passwords, run settings)
// to a workflow in a repository you choose, encrypted with a key that only TicketForge and that repository's
// TICKETFORGE_RUN_KEY secret know. The workflow runs the same runner TicketForge uses locally (run-one.mjs and its
// helpers, copied into .github/ticketforge/) in Playwright's container, and uploads the encrypted results; TicketForge
// downloads them and records them like any other run (results, screenshots, comments on the issue).
// Works from the deployed TicketForge too: nothing needs to reach TicketForge, it calls GitHub's API.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFile } from 'node:child_process';
import { unzipSync } from 'fflate';
import { hsalsa, secretbox } from '@noble/ciphers/salsa';
import { blake2b } from '@noble/hashes/blake2b';

export const WORKFLOW = 'ticketforge-tests.yml';
export const SECRET = 'TICKETFORGE_RUN_KEY';
export const SETUP_BRANCH = 'ticketforge/test-runner';
export const RUNNER_VERSION = 3;
const MAX_INPUT = 60_000; // GitHub limits workflow_dispatch inputs to 65,535 characters in all
const RUNNER_SOURCES = ['run-one.mjs', 'app-helpers.mjs', 'browser.mjs', 'totp.mjs'];
const err = (message, status = 400) => Object.assign(new Error(message), { status });
// GitHub Enterprise Server: set TICKETFORGE_GITHUB_API (e.g. https://github.example.com/api/v3).
const API = String(process.env.TICKETFORGE_GITHUB_API || 'https://api.github.com').replace(/\/$/, '');

// ---------------------------------------------------------------- GitHub API
const execBuf = (cmd, args, input) => new Promise((resolve, reject) => {
  const child = execFile(cmd, args, { timeout: 60000, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (e, stdout, stderr) => (e ? reject(Object.assign(e, { stderr: String(stderr || '') })) : resolve(stdout)));
  if (input != null) child.stdin.end(input); else child.stdin.end();
});
/**
 * One GitHub REST call. With a token (the project's GitHub token, or GITHUB_TOKEN) it uses fetch; without one, the
 * signed-in `gh` CLI on this computer. { raw: true } returns the body as a Buffer (artifact downloads).
 */
export async function gh(method, apiPath, { token = '', body, raw = false } = {}) {
  const tok = token || process.env.GITHUB_TOKEN || '';
  if (!tok) {
    try {
      const args = ['api', '-X', method, apiPath, '-H', 'Accept: application/vnd.github+json', ...(body !== undefined ? ['--input', '-'] : [])];
      const out = await execBuf('gh', args, body !== undefined ? JSON.stringify(body) : null);
      if (raw) return out;
      const text = out.toString('utf8').trim();
      return text ? JSON.parse(text) : null;
    } catch (e) {
      const msg = String(e.stderr || e.message || '');
      if (/ENOENT/.test(String(e.code || e.message))) throw err('Save a GitHub token for this project (Project settings → Code & GitHub) to run tests on GitHub Actions.');
      throw err(ghMessage(msg.match(/HTTP (\d+)/)?.[1], msg.split('\n')[0]));
    }
  }
  const res = await fetch(`${API}/${apiPath.replace(/^\//, '')}`, {
    method, redirect: 'follow',
    headers: { 'User-Agent': 'TicketForge', Accept: 'application/vnd.github+json', Authorization: `Bearer ${tok}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw err(ghMessage(res.status, (() => { try { return JSON.parse(t).message; } catch { return t.slice(0, 200); } })())); }
  if (raw) return Buffer.from(await res.arrayBuffer());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
function ghMessage(status, detail = '') {
  const s = Number(status);
  if (s === 401) return 'GitHub rejected the token. Save a new one in Project settings → Code & GitHub.';
  if (s === 403) return `GitHub refused (${detail || 'permission'}). The token needs Actions (read and write), Contents (read and write), Pull requests (write), Secrets (read and write) and Workflows (write) on the repository.`;
  if (s === 404) return `GitHub couldn’t find it (${detail || 'not found'}). Check the repository name and that the token can see it.`;
  if (s === 422) return `GitHub didn’t accept the request: ${detail}`;
  return `GitHub said ${status || 'an error'}${detail ? `: ${detail}` : ''}`;
}
const repoOk = (repo) => /^[\w.-]+\/[\w.-]+$/.test(String(repo || ''));

// ---------------------------------------------------------------- crypto
/** libsodium's crypto_box_seal, which GitHub requires for secrets (X25519 + XSalsa20-Poly1305, blake2b nonce). */
export function sealForGitHub(publicKeyB64, message) {
  const pk = Buffer.from(publicKeyB64, 'base64');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const epk = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const shared = crypto.diffieHellman({ privateKey, publicKey: crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), pk]), format: 'der', type: 'spki' }) });
  const u32 = (b) => new Uint32Array(new Uint8Array(b).buffer.slice(0));
  const k32 = new Uint32Array(8);
  hsalsa(u32(Buffer.from('expand 32-byte k')), u32(shared), new Uint32Array(4), k32);
  const nonce = blake2b(new Uint8Array(Buffer.concat([epk, pk])), { dkLen: 24 });
  const box = secretbox(new Uint8Array(Buffer.from(k32.buffer)), nonce).seal(new Uint8Array(Buffer.from(message)));
  return Buffer.concat([epk, Buffer.from(box)]).toString('base64');
}
/** AES-256-GCM over gzipped JSON: iv(12) | tag(16) | ciphertext, base64. The runner does the reverse. */
export function sealJson(keyB64, obj) {
  const key = Buffer.from(keyB64, 'base64');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 9 })), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function openJson(keyB64, data) {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(b.subarray(28)), d.final()])).toString('utf8'));
}
export const newRunKey = () => crypto.randomBytes(32).toString('base64');

// ---------------------------------------------------------------- the files put in the repository
function playwrightVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), 'node_modules', '@playwright', 'test', 'package.json'), 'utf8')).version; }
  catch { return '1.65.0'; }
}
const RUN_MJS = `// TicketForge test runner for GitHub Actions (written by TicketForge; changes are overwritten on the next setup).
// Reads the encrypted run from TF_PAYLOAD, runs each Playwright script with the same runner TicketForge uses,
// and writes the encrypted results to out/results.bin for TicketForge to download. Only pass/fail lines are logged.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { runOne } from './run-one.mjs';

const key = Buffer.from(process.env.TF_KEY || '', 'base64');
if (key.length !== 32) { console.error('The ${SECRET} secret is missing. Run the setup again from TicketForge (Test automation → Settings → GitHub Actions).'); process.exit(1); }
const open = (b64) => { const b = Buffer.from(b64, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(b.subarray(28)), d.final()]))); };
const seal = (obj) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(obj)))), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]); };

let job;
try { job = open(process.env.TF_PAYLOAD || ''); } catch { console.error('Couldn’t read the run: the ${SECRET} secret doesn’t match TicketForge’s key. Run the setup again from TicketForge.'); process.exit(1); }
fs.mkdirSync('out', { recursive: true });
const results = [];
for (const t of job.tests) {
  let r, attempt = 0;
  do {
    attempt++;
    r = await runOne({ code: t.code, baseUrl: job.baseUrl, screenshotPath: path.resolve('out', t.tcId + '.jpg'), timeoutMs: job.timeoutMs, headless: true, app: job.app, browser: { kind: 'bundled' } });
  } while (r.status !== 'Pass' && attempt <= job.retries);
  console.log((r.status === 'Pass' ? '✓ ' : '✗ ') + t.label + ' (' + Math.round(r.durationMs / 1000) + 's' + (attempt > 1 ? ', ' + attempt + ' attempts' : '') + ')');
  const shot = r.status !== 'Pass' && r.screenshot && fs.existsSync(r.screenshot) ? fs.readFileSync(r.screenshot).toString('base64') : null;
  results.push({ tcId: t.tcId, ticketId: t.ticketId, status: r.status, error: r.error, durationMs: r.durationMs, logs: r.logs, page: r.page, attempts: attempt, flaky: r.status === 'Pass' && attempt > 1, shot });
}
fs.writeFileSync('out/results.bin', seal({ runId: job.runId, results, finishedAt: new Date().toISOString() }));
console.log(results.filter((x) => x.status === 'Pass').length + ' of ' + results.length + ' passed');
`;
function workflowYaml(pw) {
  return `# Runs TicketForge's Playwright tests (written by TicketForge: Test automation → Settings → GitHub Actions).
# TicketForge starts it through the API with an encrypted run; the results go back as an encrypted artifact.
name: TicketForge tests
run-name: TicketForge \${{ inputs.run_id }}
on:
  workflow_dispatch:
    inputs:
      run_id:
        description: TicketForge run id
        required: true
      payload:
        description: Encrypted test run (from TicketForge)
        required: true
permissions:
  contents: read
concurrency:
  group: ticketforge-\${{ inputs.run_id }}
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    container:
      image: mcr.microsoft.com/playwright:v${pw}-noble
    env:
      HOME: /root
    steps:
      - uses: actions/checkout@v4
        with:
          sparse-checkout: .github/ticketforge
      - name: Install Playwright Test
        working-directory: .github/ticketforge
        run: npm install --no-save --no-audit --no-fund --loglevel=error @playwright/test@${pw}
      - name: Run the tests
        working-directory: .github/ticketforge
        env:
          TF_KEY: \${{ secrets.${SECRET} }}
          TF_PAYLOAD: \${{ inputs.payload }}
        run: node run.mjs
      - name: Upload the results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ticketforge-\${{ inputs.run_id }}
          path: .github/ticketforge/out/results.bin
          retention-days: 1
          if-no-files-found: ignore
`;
}
/** The files the setup pull request adds: path → content. */
export function runnerFiles() {
  const pw = playwrightVersion();
  const lib = path.join(/*turbopackIgnore: true*/ process.cwd(), 'lib');
  const files = {
    [`.github/workflows/${WORKFLOW}`]: workflowYaml(pw),
    '.github/ticketforge/run.mjs': RUN_MJS,
    '.github/ticketforge/package.json': `${JSON.stringify({ name: 'ticketforge-runner', private: true, type: 'module' }, null, 2)}\n`,
    '.github/ticketforge/version.json': `${JSON.stringify({ version: RUNNER_VERSION, playwright: pw }, null, 2)}\n`,
    '.github/ticketforge/README.md': '# TicketForge test runner\n\nUsed by the **TicketForge tests** workflow to run Playwright tests sent by TicketForge. Written by TicketForge; run the setup again from TicketForge to update it.\n',
  };
  for (const f of RUNNER_SOURCES) files[`.github/ticketforge/${f}`] = fs.readFileSync(path.join(/*turbopackIgnore: true*/ lib, f), 'utf8');
  return files;
}

// ---------------------------------------------------------------- status and setup
export async function fileOn(repo, ref, p, token) {
  try { return await gh('GET', `repos/${repo}/contents/${p}?ref=${encodeURIComponent(ref)}`, { token }); } catch (e) { if (/couldn’t find/.test(e.message)) return null; throw e; }
}
/** What's ready for running tests on GitHub Actions in `repo`. */
export async function runnerStatus({ repo, token, hasKey }) {
  if (!repoOk(repo)) return { ready: false, checks: [{ ok: false, label: 'Repository', detail: 'Enter the repository as owner/name.' }] };
  const info = await gh('GET', `repos/${repo}`, { token });
  const def = info.default_branch;
  const [wf, ver, secret, pr] = await Promise.all([
    fileOn(repo, def, `.github/workflows/${WORKFLOW}`, token),
    fileOn(repo, def, '.github/ticketforge/version.json', token).then((f) => (f?.content ? JSON.parse(Buffer.from(f.content, 'base64').toString('utf8')) : null)).catch(() => null),
    gh('GET', `repos/${repo}/actions/secrets/${SECRET}`, { token }).then(() => true).catch((e) => (/couldn’t find/.test(e.message) ? false : null)),
    gh('GET', `repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${repo.split('/')[0]}:${SETUP_BRANCH}`)}`, { token }).then((l) => l?.[0] || null).catch(() => null),
  ]);
  const checks = [
    { ok: true, label: 'Repository', detail: `${info.full_name} (${info.private ? 'private' : 'public'}), default branch ${def}` },
    { ok: Boolean(wf), label: 'Workflow', detail: wf ? `${WORKFLOW} is on ${def}` : pr ? `Waiting for the setup pull request #${pr.number} to be merged` : `Not on ${def} yet` },
    { ok: Boolean(ver && ver.version >= RUNNER_VERSION), label: 'Runner', detail: ver ? (ver.version >= RUNNER_VERSION ? `Version ${ver.version}, Playwright ${ver.playwright}` : `Version ${ver.version} is out of date: run the setup again`) : 'Not installed' },
    { ok: secret === true && hasKey, label: 'Run key', detail: secret === null ? 'Couldn’t check the repository secret (the token needs Secrets: read)' : !hasKey ? 'TicketForge has no key yet: run the setup' : secret ? `${SECRET} is set` : `${SECRET} is missing: run the setup` },
  ];
  return { ready: checks.every((c) => c.ok), defaultBranch: def, setupPr: pr ? { number: pr.number, url: pr.html_url } : null, checks, private: info.private };
}

/**
 * Sets the repository secret and opens a pull request with the workflow and runner (or updates the open one).
 * Returns { pr: { number, url }, created }.
 */
export async function setupRunner({ repo, token, key }) {
  if (!repoOk(repo)) throw err('Enter the repository as owner/name.');
  const info = await gh('GET', `repos/${repo}`, { token });
  const def = info.default_branch;
  // 1. The run key, sealed with the repository's public key (only GitHub Actions can read it).
  const pub = await gh('GET', `repos/${repo}/actions/secrets/public-key`, { token });
  await gh('PUT', `repos/${repo}/actions/secrets/${SECRET}`, { token, body: { encrypted_value: sealForGitHub(pub.key, key), key_id: pub.key_id } });
  // 2. A branch with the files.
  const base = await gh('GET', `repos/${repo}/git/ref/heads/${encodeURIComponent(def)}`, { token });
  const exists = await gh('GET', `repos/${repo}/git/ref/heads/${SETUP_BRANCH}`, { token }).catch(() => null);
  if (!exists) await gh('POST', `repos/${repo}/git/refs`, { token, body: { ref: `refs/heads/${SETUP_BRANCH}`, sha: base.object.sha } });
  for (const [p, content] of Object.entries(runnerFiles())) {
    const cur = await fileOn(repo, SETUP_BRANCH, p, token);
    const b64 = Buffer.from(content).toString('base64');
    if (cur?.content && cur.content.replace(/\n/g, '') === b64) continue;
    await gh('PUT', `repos/${repo}/contents/${p}`, { token, body: { message: `TicketForge test runner: ${p.split('/').pop()}`, content: b64, branch: SETUP_BRANCH, ...(cur?.sha ? { sha: cur.sha } : {}) } });
  }
  // 3. The pull request (one stays open until it is merged).
  const open = await gh('GET', `repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${repo.split('/')[0]}:${SETUP_BRANCH}`)}`, { token });
  if (open?.[0]) return { pr: { number: open[0].number, url: open[0].html_url }, created: false };
  const pr = await gh('POST', `repos/${repo}/pulls`, { token, body: { title: 'Add the TicketForge test runner (GitHub Actions)', head: SETUP_BRANCH, base: def,
    body: `Adds the **TicketForge tests** workflow so TicketForge can run its Playwright tests on GitHub Actions.\n\n- \`.github/workflows/${WORKFLOW}\`: started by TicketForge through the API (manual dispatch only), runs in Playwright's container, uploads encrypted results (kept 1 day).\n- \`.github/ticketforge/\`: the runner (the same code TicketForge uses to run tests locally).\n\nTest runs are encrypted with the \`${SECRET}\` secret, which TicketForge has set on this repository. The workflow only reads this repository's \`.github/ticketforge\` folder.` } });
  return { pr: { number: pr.number, url: pr.html_url }, created: true };
}

// ---------------------------------------------------------------- runs
/** Starts the workflow for some tests; splits into several runs when the encrypted run is too big for one. */
export async function dispatchRuns({ repo, ref, token, key, baseUrl, app, retries, timeoutMs, tests }) {
  const tag = () => `tf${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const chunks = [];
  let cur = [];
  const fits = (list) => sealJson(key, { runId: 'x', baseUrl, app, retries, timeoutMs, tests: list }).length <= MAX_INPUT;
  for (const t of tests) {
    if (fits([...cur, t])) { cur.push(t); continue; }
    if (!cur.length) throw err(`The script for “${t.label}” is too big to send to GitHub Actions.`);
    chunks.push(cur); cur = [t];
  }
  if (cur.length) chunks.push(cur);
  const runs = [];
  for (const list of chunks) {
    const runId = tag();
    const payload = sealJson(key, { runId, baseUrl, app, retries, timeoutMs, tests: list });
    const since = new Date(Date.now() - 60_000).toISOString();
    await gh('POST', `repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`, { token, body: { ref, inputs: { run_id: runId, payload } } });
    runs.push({ runId, since, tcIds: list.map((t) => t.tcId), ghRunId: null, url: null });
  }
  return runs;
}
/** Finds the GitHub run for a TicketForge run id (its name is "TicketForge <id>"). */
async function findRun(repo, token, r, workflow = WORKFLOW) {
  const list = await gh('GET', `repos/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=30&created=${encodeURIComponent(`>=${r.since}`)}`, { token });
  return (list?.workflow_runs || []).find((x) => String(x.display_title || x.name || '').includes(r.runId)) || null;
}
/**
 * Checks one dispatched run once: { state: 'waiting'|'queued'|'in_progress'|'done'|'failed', url, results?, message? }.
 * When done, downloads and decrypts the results.
 */
export async function checkRun({ repo, token, key, run, workflow = WORKFLOW, file = 'results.bin' }) {
  let gr = run.ghRunId ? await gh('GET', `repos/${repo}/actions/runs/${run.ghRunId}`, { token }) : await findRun(repo, token, run, workflow);
  if (!gr) return { state: 'waiting' };
  run.ghRunId = gr.id; run.url = gr.html_url;
  if (gr.status !== 'completed') return { state: gr.status === 'in_progress' ? 'in_progress' : 'queued', url: gr.html_url };
  const arts = await gh('GET', `repos/${repo}/actions/runs/${gr.id}/artifacts`, { token });
  const art = (arts?.artifacts || []).find((a) => a.name === `ticketforge-${run.runId}` && !a.expired);
  if (!art) return { state: 'failed', url: gr.html_url, message: `The GitHub Actions run ${gr.conclusion === 'cancelled' ? 'was cancelled' : 'ended without results'} (${gr.conclusion}). Open it on GitHub for the log.` };
  const zip = await gh('GET', `repos/${repo}/actions/artifacts/${art.id}/zip`, { token, raw: true });
  const files = unzipSync(new Uint8Array(zip));
  const bin = files[file];
  if (!bin) return { state: 'failed', url: gr.html_url, message: 'The results file is missing from the GitHub Actions run.' };
  let data;
  try { data = openJson(key, Buffer.from(bin)); } catch { return { state: 'failed', url: gr.html_url, message: 'Couldn’t read the results: the repository’s run key doesn’t match. Run the setup again.' }; }
  return { state: 'done', url: gr.html_url, results: data.results || [], data, conclusion: gr.conclusion };
}
