import { api, authed, perm, body, HttpError, ndjson, appUrl } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { getProjectSecret, setProjectSecret } from '@/lib/secrets.js';
import { runnerStatus, setupRunner, newRunKey } from '@/lib/gh-actions.js';
import { followGitHubRuns } from '@/lib/automation.js';
import { reportRun } from '@/lib/notify.js';
import { githubRunner } from '@/lib/server/gh-runner';

// Test automation → Settings → GitHub Actions: status of the runner in a repository, setting it up (repository
// secret + a pull request with the workflow), and collecting the results of runs that outlived their request.
export const maxDuration = 300;

export const GET = api(async (req) => {
  const user = await authed();
  const sp = new URL(req.url).searchParams;
  const projectId = String(sp.get('projectId') || '');
  store.requireAccess(user, projectId);
  const repo = String(sp.get('repo') || '').trim();
  const [token, key] = await Promise.all([getProjectSecret(projectId, 'githubToken'), getProjectSecret(projectId, 'ghRunnerKey')]);
  try { return await runnerStatus({ repo, token: token || '', hasKey: Boolean(key) }); }
  catch (e: any) { throw new HttpError(e.status || 400, e.message); }
});

export const POST = api(async (req) => {
  const b = await body(req);
  const projectId = String(b.projectId || '');
  if (b.action === 'setup') {
    const user = await perm('project.settings');
    store.requireAccess(user, projectId);
    const repo = String(b.repo || '').trim();
    let key = await getProjectSecret(projectId, 'ghRunnerKey');
    if (!key) { key = newRunKey(); await setProjectSecret(projectId, 'ghRunnerKey', key, user); }
    try { return await setupRunner({ repo, token: (await getProjectSecret(projectId, 'githubToken')) || '', key }); }
    catch (e: any) { throw new HttpError(e.status || 400, e.message); }
  }
  if (b.action === 'collect') {
    const user = await perm('test.run');
    store.requireAccess(user, projectId);
    const github = await githubRunner(projectId, { deadlineMs: 260_000 });
    const pending = b.pending || {};
    if (!Array.isArray(pending.runs) || !pending.runs.length) throw new HttpError(400, 'Nothing to collect.');
    const origin = appUrl(req);
    return ndjson(req, async (send, signal) => {
      const results = new Map<string, any[]>();
      const emit = (ev: any) => {
        if (ev.type === 'result' && ev.ticketId && ev.result) { if (!results.has(ev.ticketId)) results.set(ev.ticketId, []); results.get(ev.ticketId)!.push({ tcId: ev.tcId, result: ev.result }); }
        send(ev);
      };
      try { await followGitHubRuns({ runs: pending.runs, github: { ...github, repo: pending.repo || github.repo, tickets: pending.tickets || {} }, project: { id: projectId }, user, emit, signal }); }
      finally {
        if (results.size) {
          try { send({ type: 'reported', ...(await reportRun({ projectId, results, runner: user, baseUrl: String(pending.baseUrl || ''), appUrl: origin, analyze: null, say: (message: string) => send({ type: 'phase', message }) })) }); }
          catch (e: any) { send({ type: 'phase', level: 'warn', message: `Could not post test result comments: ${e.message}` }); }
        }
      }
      send({ type: 'done' });
    });
  }
  throw new HttpError(400, 'Unknown action');
});
