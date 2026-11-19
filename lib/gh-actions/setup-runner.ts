import crypto from 'node:crypto';
import { unzipSync } from 'fflate';
import { err } from '../errors';
import {
  repoOk,
  gh,
  SECRET,
  sealForGitHub,
  SETUP_BRANCH,
  runnerFiles,
  fileOn,
  WORKFLOW,
  sealJson,
  MAX_INPUT,
  openJson,
} from './runner-status';

/**
 * Sets the repository secret and opens a pull request with the workflow and runner (or updates the
 * open one).
 * Returns { pr: { number, url }, created }.
 */
export async function setupRunner({ repo, token, key }: any) {
  if (!repoOk(repo)) throw err('Enter the repository as owner/name.');
  const info = await gh('GET', `repos/${repo}`, { token });
  const def = info.default_branch;
  // 1. The run key, sealed with the repository's public key (only GitHub Actions can read it).
  const pub = await gh('GET', `repos/${repo}/actions/secrets/public-key`, { token });
  await gh('PUT', `repos/${repo}/actions/secrets/${SECRET}`, {
    token,
    body: { encrypted_value: sealForGitHub(pub.key, key), key_id: pub.key_id },
  });
  // 2. A branch with the files.
  const base = await gh('GET', `repos/${repo}/git/ref/heads/${encodeURIComponent(def)}`, { token });
  const exists = await gh('GET', `repos/${repo}/git/ref/heads/${SETUP_BRANCH}`, { token }).catch(
    () => null,
  );
  if (!exists)
    await gh('POST', `repos/${repo}/git/refs`, {
      token,
      body: { ref: `refs/heads/${SETUP_BRANCH}`, sha: base.object.sha },
    });
  for (const [p, content] of Object.entries<any>(runnerFiles())) {
    const cur = await fileOn(repo, SETUP_BRANCH, p, token);
    const b64 = Buffer.from(content).toString('base64');
    if (cur?.content && cur.content.replace(/\n/g, '') === b64) continue;
    await gh('PUT', `repos/${repo}/contents/${p}`, {
      token,
      body: {
        message: `TicketForge test runner: ${p.split('/').pop()}`,
        content: b64,
        branch: SETUP_BRANCH,
        ...(cur?.sha ? { sha: cur.sha } : {}),
      },
    });
  }
  // 3. The pull request (one stays open until it is merged).
  const open = await gh(
    'GET',
    `repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${repo.split('/')[0]}:${SETUP_BRANCH}`)}`,
    {
      token,
    },
  );
  if (open?.[0]) return { pr: { number: open[0].number, url: open[0].html_url }, created: false };
  const pr = await gh('POST', `repos/${repo}/pulls`, {
    token,
    body: {
      title: 'Add the TicketForge test runner (GitHub Actions)',
      head: SETUP_BRANCH,
      base: def,
      body: `Adds the **TicketForge tests** workflow so TicketForge can run its Playwright tests on GitHub Actions.\n\n- \`.github/workflows/${WORKFLOW}\`: started by TicketForge through the API (manual dispatch only), runs in Playwright's container, uploads encrypted results (kept 1 day).\n- \`.github/ticketforge/\`: the runner (the same code TicketForge uses to run tests locally).\n\nTest runs are encrypted with the \`${SECRET}\` secret, which TicketForge has set on this repository. The workflow only reads this repository's \`.github/ticketforge\` folder.`,
    },
  });
  return { pr: { number: pr.number, url: pr.html_url }, created: true };
}
// ---------------------------------------------------------------- runs
/**
 * Starts the workflow for some tests; splits into several runs when the encrypted run is too big
 * for one.
 */
export async function dispatchRuns({
  repo,
  ref,
  token,
  key,
  baseUrl,
  app,
  retries,
  timeoutMs,
  tests,
}: any) {
  const tag = () => `tf${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const chunks: any[] = [];
  let cur: any[] = [];
  const fits = (list) =>
    sealJson(key, { runId: 'x', baseUrl, app, retries, timeoutMs, tests: list }).length <=
    MAX_INPUT;
  for (const t of tests) {
    if (fits([...cur, t])) {
      cur.push(t);
      continue;
    }
    if (!cur.length) throw err(`The script for “${t.label}” is too big to send to GitHub Actions.`);
    chunks.push(cur);
    cur = [t];
  }
  if (cur.length) chunks.push(cur);
  const runs: any[] = [];
  for (const list of chunks) {
    const runId = tag();
    const payload = sealJson(key, { runId, baseUrl, app, retries, timeoutMs, tests: list });
    const since = new Date(Date.now() - 60_000).toISOString();
    await gh('POST', `repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`, {
      token,
      body: { ref, inputs: { run_id: runId, payload } },
    });
    runs.push({ runId, since, tcIds: list.map((t) => t.tcId), ghRunId: null, url: null });
  }
  return runs;
}
/** Finds the GitHub run for a TicketForge run id (its name is "TicketForge <id>"). */
async function findRun(repo, token, r, workflow = WORKFLOW) {
  const list = await gh(
    'GET',
    `repos/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=30&created=${encodeURIComponent(`>=${r.since}`)}`,
    { token },
  );
  return (
    (list?.workflow_runs || []).find((x) =>
      String(x.display_title || x.name || '').includes(r.runId),
    ) || null
  );
}
/**
 * Checks one dispatched run once: { state: 'waiting'|'queued'|'in_progress'|'done'|'failed', url,
 * results?, message? }.
 * When done, downloads and decrypts the results.
 */
export async function checkRun({
  repo,
  token,
  key,
  run,
  workflow = WORKFLOW,
  file = 'results.bin',
}: any) {
  const gr = run.ghRunId
    ? await gh('GET', `repos/${repo}/actions/runs/${run.ghRunId}`, { token })
    : await findRun(repo, token, run, workflow);
  if (!gr) return { state: 'waiting' };
  run.ghRunId = gr.id;
  run.url = gr.html_url;
  if (gr.status !== 'completed')
    return { state: gr.status === 'in_progress' ? 'in_progress' : 'queued', url: gr.html_url };
  const arts = await gh('GET', `repos/${repo}/actions/runs/${gr.id}/artifacts`, { token });
  const art = (arts?.artifacts || []).find(
    (a) => a.name === `ticketforge-${run.runId}` && !a.expired,
  );
  if (!art)
    return {
      state: 'failed',
      url: gr.html_url,
      message: `The GitHub Actions run ${gr.conclusion === 'cancelled' ? 'was cancelled' : 'ended without results'} (${gr.conclusion}). Open it on GitHub for the log.`,
    };
  const zip = await gh('GET', `repos/${repo}/actions/artifacts/${art.id}/zip`, {
    token,
    raw: true,
  });
  const files = unzipSync(new Uint8Array(zip));
  const bin = files[file];
  if (!bin)
    return {
      state: 'failed',
      url: gr.html_url,
      message: 'The results file is missing from the GitHub Actions run.',
    };
  let data;
  try {
    data = openJson(key, Buffer.from(bin));
  } catch {
    return {
      state: 'failed',
      url: gr.html_url,
      message:
        'Couldn’t read the results: the repository’s run key doesn’t match. Run the setup again.',
    };
  }
  return {
    state: 'done',
    url: gr.html_url,
    results: data.results || [],
    data,
    conclusion: gr.conclusion,
  };
}
