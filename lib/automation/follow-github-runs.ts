import fs from 'node:fs';
import path from 'node:path';
import { saveFailureShot } from '../shots';
import { dispatchRuns, checkRun } from '../gh-actions';
import { RUN_DIR, runPrefix } from './snapshot-app';

/**
 * The run on GitHub Actions: sends the scripts (encrypted), follows the workflow run, then records
 * the results like a local run. When `github.deadline` (serverless request limit) comes first,
 * emits { type: 'pending' } with what's needed to collect the results later (POST
 * /api/automation/github { action: 'collect' }).
 */
export async function runOnGitHub({
  items,
  baseUrl,
  project,
  emit,
  signal,
  app,
  user,
  rs,
  github,
}: any) {
  const ready = items.filter((it) => it.tc.script?.trim());
  for (const it of items) {
    if (!it.tc.script?.trim())
      emit({
        type: 'result',
        ticketId: it.ticket.id,
        tcId: it.tc.id,
        result: {
          status: 'Fail',
          error:
            it.noScriptReason ||
            'No automation script: the AI couldn’t write one (see the run log).',
          durationMs: 0,
          at: new Date().toISOString(),
          logs: [],
        },
      });
  }
  if (!ready.length || signal?.aborted) return;
  const tests = ready.map((it) => ({
    tcId: it.tc.id,
    ticketId: it.ticket.id,
    code: it.tc.script,
    label: `${it.ticket.key} ${String(it.tc.title || '').slice(0, 90)}`,
  }));
  emit({
    type: 'phase',
    message: `Sending ${tests.length} test${tests.length === 1 ? '' : 's'} to GitHub Actions (${github.repo})…`,
  });
  const runs = await dispatchRuns({
    repo: github.repo,
    ref: github.ref,
    token: github.token,
    key: github.key,
    baseUrl,
    app,
    retries: rs.retries,
    timeoutMs: rs.testTimeoutSec * 1000,
    tests,
  });
  for (const it of ready)
    emit({ type: 'start', ticketId: it.ticket.id, tcId: it.tc.id, queued: true });
  emit({
    type: 'phase',
    message:
      runs.length > 1
        ? `Started ${runs.length} GitHub Actions runs (the tests were split to fit GitHub’s size limit).`
        : 'Started the GitHub Actions run. It takes about a minute to start the browser container.',
  });
  await followGitHubRuns({ runs, github, project, user, emit, signal, items: ready, baseUrl });
}
/** Polls the runs until each is done (or the deadline / stop), recording results as they arrive. */
export async function followGitHubRuns({
  runs,
  github,
  project,
  user,
  emit,
  signal,
  items = [],
  baseUrl = '',
}: any) {
  const byTc: any = new Map(items.map((it) => [it.tc.id, it]));
  const said: Map<any, any> = new Map();
  const left = new Set(runs.map((r) => r.runId));
  while (left.size && !signal?.aborted) {
    for (const run of runs.filter((r) => left.has(r.runId))) {
      let st;
      try {
        st = await checkRun({ repo: github.repo, token: github.token, key: github.key, run });
      } catch (e) {
        st = { state: 'error', message: e.message };
      }
      const note =
        st.state === 'queued'
          ? 'Waiting for a GitHub runner…'
          : st.state === 'in_progress'
            ? 'Running on GitHub Actions…'
            : st.state === 'waiting'
              ? 'GitHub is starting the run…'
              : '';
      if (note && said.get(run.runId) !== note) {
        said.set(run.runId, note);
        emit({ type: 'phase', message: `${note}${st.url ? ` ${st.url}` : ''}`, url: st.url });
      }
      if (st.state === 'error') {
        emit({
          type: 'phase',
          level: 'warn',
          message: `Couldn’t check the GitHub run: ${st.message}`,
        });
        continue;
      }
      if (st.state === 'failed') {
        left.delete(run.runId);
        emit({ type: 'phase', level: 'err', message: st.message, url: st.url });
        for (const tcId of run.tcIds) {
          const it: any = byTc.get(tcId);
          emit({
            type: 'result',
            ticketId: it?.ticket.id || github.tickets?.[tcId],
            tcId,
            result: {
              status: 'Fail',
              error: `GitHub Actions: ${st.message}`,
              durationMs: 0,
              at: new Date().toISOString(),
              logs: [],
              runner: 'github',
              runUrl: st.url,
            },
          });
        }
        continue;
      }
      if (st.state !== 'done') continue;
      left.delete(run.runId);
      for (const r of st.results) {
        const result = {
          status: r.status,
          error: r.error || '',
          durationMs: r.durationMs || 0,
          logs: r.logs || [],
          page: r.page,
          attempts: r.attempts || 1,
          flaky: Boolean(r.flaky),
          at: new Date().toISOString(),
          runner: 'github',
          runUrl: st.url,
          screenshot: null,
        };
        if (r.status !== 'Pass' && r.shot && project?.id) {
          const file = path.join(RUN_DIR, `${runPrefix()}${r.tcId}-gh-${Date.now()}.jpg`);
          try {
            fs.writeFileSync(file, Buffer.from(r.shot, 'base64'));
            result.screenshot = await saveFailureShot({
              file,
              projectId: project.id,
              issueId: r.ticketId,
              tcId: r.tcId,
              error: r.error,
              user,
            });
          } catch (e) {
            emit({
              type: 'phase',
              level: 'warn',
              message: `Couldn’t save the screenshot: ${e.message}`,
            });
          }
        }
        if (result.flaky)
          emit({
            type: 'phase',
            level: 'warn',
            message: `${byTc.get(r.tcId)?.ticket.key || ''}: passed on attempt ${result.attempts} — flaky, worth a look.`,
          });
        emit({ type: 'result', ticketId: r.ticketId, tcId: r.tcId, result });
      }
      emit({
        type: 'phase',
        level: 'pass',
        message: `GitHub Actions finished: ${st.results.filter((x) => x.status === 'Pass').length} of ${st.results.length} passed.`,
        url: st.url,
      });
    }
    if (!left.size || signal?.aborted) break;
    if (github.deadline && Date.now() > github.deadline) {
      emit({
        type: 'pending',
        github: {
          repo: github.repo,
          baseUrl,
          runs: runs.filter((r) => left.has(r.runId)),
          tickets: Object.fromEntries(items.map((it) => [it.tc.id, it.ticket.id])),
        },
      });
      emit({
        type: 'phase',
        level: 'warn',
        message:
          'Still running on GitHub Actions. TicketForge collects the results when it finishes (keep this page open, or press “Collect results” on Test automation later).',
      });
      return;
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
}
