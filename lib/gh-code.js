// Code jobs on GitHub Actions: how "Write code with AI" works from the deployed TicketForge (Vercel), where there is
// no repository checkout and no Claude Code. TicketForge sends the job (the agent's instructions and the issue's task,
// encrypted with the project's run key) to the TicketForge code workflow in the repository. GitHub's machine checks
// out the repository, runs Claude Code on the job's branch, commits and pushes the branch, and uploads the result
// (summary, changed files, diff), encrypted. TicketForge reads it back; the pull request is then opened through the
// GitHub API as you. Claude Code signs in with the repository's ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN secret.
import crypto from 'node:crypto';
import { gh, sealForGitHub, sealJson, fileOn, SECRET, checkRun } from './gh-actions.js';

export const CODE_WORKFLOW = 'ticketforge-code.yml';
export const CODE_SETUP_BRANCH = 'ticketforge/code-runner';
export const CODE_RUNNER_VERSION = 4;
const MAX_INPUT = 60_000;
const err = (message, status = 400) => Object.assign(new Error(message), { status });
const repoOk = (repo) => /^[\w.-]+\/[\w.-]+$/.test(String(repo || ''));

const CODE_MJS = `// TicketForge code runner for GitHub Actions (written by TicketForge; changes are overwritten on the next setup).
// Decrypts the job, runs Claude Code on the job's branch, commits and pushes, and writes the encrypted result.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const key = Buffer.from(process.env.TF_KEY || '', 'base64');
if (key.length !== 32) { console.error('The ${SECRET} secret is missing. Run the setup again from TicketForge.'); process.exit(1); }
const open = (b64) => { const b = Buffer.from(b64, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(b.subarray(28)), d.final()]))); };
const seal = (obj) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(obj)))), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]); };
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const out = process.env.TF_OUT || '/tmp/ticketforge-out';
fs.mkdirSync(out, { recursive: true });
const finish = (r) => { fs.writeFileSync(out + '/result.bin', seal(r)); console.log(r.error ? 'Finished with an error' : 'Finished: ' + (r.files || []).length + ' files changed'); };

let job;
try { job = open(process.env.TF_PAYLOAD || ''); } catch { console.error('Couldn’t read the job: the ${SECRET} secret doesn’t match TicketForge’s key. Run the setup again.'); process.exit(1); }
try {
  git('config', 'user.name', job.author?.name || 'TicketForge');
  git('config', 'user.email', job.author?.email || 'ticketforge@users.noreply.github.com');
  git('fetch', '--no-tags', 'origin', job.base);
  let existing = false;
  try { git('fetch', '--no-tags', 'origin', job.branch); existing = true; } catch { /* new branch */ }
  git('checkout', '-q', '-B', job.branch, existing ? 'origin/' + job.branch : 'origin/' + job.base);
  console.log('On ' + job.branch + (existing ? ' (continuing)' : ' (new, from ' + job.base + ')'));
  // Whose Claude subscription: the person who asked (My AI in TicketForge), else the repository's shared token.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
  if (job.oauthToken) { console.log('::add-mask::' + job.oauthToken); env.CLAUDE_CODE_OAUTH_TOKEN = job.oauthToken; }
  if (!env.CLAUDE_CODE_OAUTH_TOKEN) throw new Error('No Claude subscription for this job: add your token in TicketForge (your avatar → My AI), or a shared CLAUDE_CODE_OAUTH_TOKEN in Where code jobs run → Set up.');
  console.log(job.oauthToken ? 'Claude: the requester’s own subscription' : 'Claude: the repository’s shared subscription token');
  const args = ['-p', '--output-format', 'json', '--model', job.model || 'sonnet', '--permission-mode', 'acceptEdits',
    '--append-system-prompt', job.system || '', '--allowedTools', (job.allowedTools || []).join(' '), '--disallowedTools', (job.disallowedTools || []).join(' ')];
  if (job.effort) args.push('--effort', job.effort);
  const r = spawnSync('claude', args, { input: job.prompt, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: (job.timeoutMin || 50) * 60000 });
  let res = {};
  try { res = JSON.parse(String(r.stdout || '').trim().split('\\n').pop() || '{}'); } catch { res = { is_error: true, result: (r.stderr || r.stdout || 'Claude Code failed').slice(-2000) }; }
  if (r.status !== 0 && !res.result) res = { is_error: true, result: String(r.stderr || 'Claude Code stopped').slice(-2000) };
  git('add', '-A');
  const files = git('diff', '--cached', '--numstat').split('\\n').filter(Boolean).map((l) => { const [a, d, f] = l.split('\\t'); return { path: f, added: Number(a) || 0, removed: Number(d) || 0 }; });
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
  finish({ runId: job.runId, error: String(e.message || e).replace(/AUTHORIZATION: [^\\s]+ [^\\s]+/gi, '').slice(0, 2000), files: [] });
  process.exitCode = 1;
}
`;
const WORKFLOW_YML = `# Runs TicketForge's code agents (written by TicketForge: Project settings → Code & GitHub → Where code jobs run).
# TicketForge starts it through the API with an encrypted job; the agent's commits are pushed to the job's branch.
name: TicketForge code
run-name: TicketForge code \${{ inputs.run_id }}
on:
  workflow_dispatch:
    inputs:
      run_id:
        description: TicketForge job id
        required: true
      payload:
        description: Encrypted job (from TicketForge)
        required: true
permissions:
  contents: write
concurrency:
  group: ticketforge-code-\${{ inputs.run_id }}
jobs:
  code:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install Claude Code
        run: npm install -g @anthropic-ai/claude-code --no-audit --no-fund --loglevel=error
      - name: Install the project's dependencies
        continue-on-error: true
        run: |
          if [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile
          elif [ -f yarn.lock ]; then corepack enable && yarn install --immutable
          elif [ -f package-lock.json ]; then npm ci --no-audit --no-fund
          fi
      - name: Run the TicketForge agent
        env:
          TF_KEY: \${{ secrets.${SECRET} }}
          TF_PAYLOAD: \${{ inputs.payload }}
          TF_OUT: \${{ runner.temp }}/ticketforge
          CLAUDE_CODE_OAUTH_TOKEN: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
        run: |
          # Claude subscriptions only, never billed API usage: the requester's own token (inside the encrypted job),
          # else the repository's CLAUDE_CODE_OAUTH_TOKEN secret.
          unset ANTHROPIC_API_KEY
          cp .github/ticketforge/code.mjs "\${{ runner.temp }}/ticketforge-code.mjs"
          node "\${{ runner.temp }}/ticketforge-code.mjs"
      - name: Upload the result
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ticketforge-\${{ inputs.run_id }}
          path: \${{ runner.temp }}/ticketforge/result.bin
          retention-days: 1
          if-no-files-found: ignore
`;
export const codeRunnerFiles = () => ({
  [`.github/workflows/${CODE_WORKFLOW}`]: WORKFLOW_YML,
  '.github/ticketforge/code.mjs': CODE_MJS,
  '.github/ticketforge/code-version.json': `${JSON.stringify({ version: CODE_RUNNER_VERSION }, null, 2)}\n`,
});

/** What's ready for code jobs on GitHub Actions in `repo`. */
export async function codeRunnerStatus({ repo, token, hasKey }) {
  if (!repoOk(repo)) return { ready: false, checks: [{ ok: false, label: 'Repository', detail: 'Choose the repository first.' }] };
  const info = await gh('GET', `repos/${repo}`, { token });
  const def = info.default_branch;
  const secret = async (name) => gh('GET', `repos/${repo}/actions/secrets/${name}`, { token }).then(() => true).catch((e) => (/couldn’t find/.test(e.message) ? false : null));
  const [wf, ver, runKey, apiKey, oauth, pr] = await Promise.all([
    fileOn(repo, def, `.github/workflows/${CODE_WORKFLOW}`, token),
    fileOn(repo, def, '.github/ticketforge/code-version.json', token).then((f) => (f?.content ? JSON.parse(Buffer.from(f.content, 'base64').toString('utf8')) : null)).catch(() => null),
    secret(SECRET), secret('ANTHROPIC_API_KEY'), secret('CLAUDE_CODE_OAUTH_TOKEN'),
    gh('GET', `repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${repo.split('/')[0]}:${CODE_SETUP_BRANCH}`)}`, { token }).then((l) => l?.[0] || null).catch(() => null),
  ]);
  const checks = [
    { ok: true, label: 'Repository', detail: `${info.full_name} (${info.private ? 'private' : 'public'}), default branch ${def}` },
    { ok: Boolean(wf && ver && ver.version >= CODE_RUNNER_VERSION), label: 'Workflow', detail: wf ? (ver?.version >= CODE_RUNNER_VERSION ? `${CODE_WORKFLOW} is on ${def}` : 'Out of date: run the setup again') : pr ? `Waiting for setup pull request #${pr.number} to be merged` : `Not on ${def} yet` },
    { ok: runKey === true && hasKey, label: 'Run key', detail: runKey === null ? 'Couldn’t check the repository secrets (the token needs Secrets: read)' : !hasKey ? 'TicketForge has no key yet: run the setup' : runKey ? `${SECRET} is set` : `${SECRET} is missing: run the setup` },
    { ok: true, label: 'Claude', detail: `Each job uses the requester’s own Claude subscription (My AI)${oauth ? '; people without one use the repository’s shared CLAUDE_CODE_OAUTH_TOKEN' : '; there’s no shared token, so people need their own'}${apiKey ? '. The repository’s ANTHROPIC_API_KEY is never used' : ''}.` },
  ];
  return { ready: checks.every((c) => c.ok), defaultBranch: def, setupPr: pr ? { number: pr.number, url: pr.html_url } : null, checks };
}

/** Sets the secrets and opens (or updates) the pull request that adds the code workflow. */
export async function setupCodeRunner({ repo, token, key, claudeSecrets = [] }) {
  if (!repoOk(repo)) throw err('Choose the repository first.');
  const info = await gh('GET', `repos/${repo}`, { token });
  const def = info.default_branch;
  const pub = await gh('GET', `repos/${repo}/actions/secrets/public-key`, { token });
  const put = (name, value) => gh('PUT', `repos/${repo}/actions/secrets/${name}`, { token, body: { encrypted_value: sealForGitHub(pub.key, value), key_id: pub.key_id } });
  await put(SECRET, key);
  for (const c of claudeSecrets) if (c?.value && c.name === 'CLAUDE_CODE_OAUTH_TOKEN') await put(c.name, c.value);
  const base = await gh('GET', `repos/${repo}/git/ref/heads/${encodeURIComponent(def)}`, { token });
  const exists = await gh('GET', `repos/${repo}/git/ref/heads/${CODE_SETUP_BRANCH}`, { token }).catch(() => null);
  if (!exists) await gh('POST', `repos/${repo}/git/refs`, { token, body: { ref: `refs/heads/${CODE_SETUP_BRANCH}`, sha: base.object.sha } });
  for (const [p, content] of Object.entries(codeRunnerFiles())) {
    const cur = await fileOn(repo, CODE_SETUP_BRANCH, p, token);
    const b64 = Buffer.from(content).toString('base64');
    if (cur?.content && cur.content.replace(/\n/g, '') === b64) continue;
    await gh('PUT', `repos/${repo}/contents/${p}`, { token, body: { message: `TicketForge code runner: ${p.split('/').pop()}`, content: b64, branch: CODE_SETUP_BRANCH, ...(cur?.sha ? { sha: cur.sha } : {}) } });
  }
  const open = await gh('GET', `repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${repo.split('/')[0]}:${CODE_SETUP_BRANCH}`)}`, { token });
  if (open?.[0]) return { pr: { number: open[0].number, url: open[0].html_url }, created: false };
  const pr = await gh('POST', `repos/${repo}/pulls`, { token, body: { title: 'Add the TicketForge code runner (GitHub Actions)', head: CODE_SETUP_BRANCH, base: def,
    body: `Adds the **TicketForge code** workflow so TicketForge (also when it's deployed) can run its code agents here.\n\n- \`.github/workflows/${CODE_WORKFLOW}\`: started by TicketForge through the API (manual dispatch only). It checks out the repository, runs Claude Code on the issue's branch, then commits and pushes that branch. Pull requests are opened by TicketForge as the person who asked.\n- \`.github/ticketforge/code.mjs\`: the runner.\n\nJobs are encrypted with the \`${SECRET}\` secret. Claude Code signs in only with the \`CLAUDE_CODE_OAUTH_TOKEN\` secret (your Claude subscription); it never uses an API key.` } });
  return { pr: { number: pr.number, url: pr.html_url }, created: true };
}

/** Starts one code round. Returns { runId, since }. */
export async function dispatchCode({ repo, ref, token, key, job }) {
  const runId = `tfc${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const payload = sealJson(key, { ...job, runId });
  if (payload.length > MAX_INPUT) throw err('This job is too big to send to GitHub Actions (the issue, its context and the repository profile together). Shorten the extra instructions or the profile.');
  const since = new Date(Date.now() - 60_000).toISOString();
  await gh('POST', `repos/${repo}/actions/workflows/${CODE_WORKFLOW}/dispatches`, { token, body: { ref, inputs: { run_id: runId, payload } } });
  return { runId, since, ghRunId: null, url: null };
}
/** One check of a code round: like checkRun, with the job's result. */
export const checkCode = ({ repo, token, key, run }) => checkRun({ repo, token, key, run, workflow: CODE_WORKFLOW, file: 'result.bin' });
/** Stops a running round. */
export async function cancelCode({ repo, token, run }) {
  if (run?.ghRunId) await gh('POST', `repos/${repo}/actions/runs/${run.ghRunId}/cancel`, { token }).catch(() => {});
}
/** Opens the pull request for a pushed branch. */
export async function openCodePr({ repo, token, head, base, title, body, draft }) {
  const pr = await gh('POST', `repos/${repo}/pulls`, { token, body: { title, head, base, body, draft: Boolean(draft) } });
  return { number: pr.number, url: pr.html_url, title: pr.title, draft: pr.draft };
}
export async function deleteBranch({ repo, token, branch }) {
  await gh('DELETE', `repos/${repo}/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`, { token }).catch(() => {});
}
