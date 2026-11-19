'use client';
import { useState } from 'react';
import {
  P,
  mutate,
  uid,
  toast,
  type Any,
  openModal,
  setField,
  closeModal,
  runPlace,
  tcKey,
  nowIso,
  logEvent,
  emit,
  saveNow,
  pullRemote,
  loadNotifs,
  S,
  api,
  readNdjson,
  withBusy,
  setBusy,
} from '../core';
import { recordAutomationResult } from '../TestRepo';
import { Confirm, Modal } from '../ui';
import { TF } from '../fields';
import { findTc, loadEngine } from './move-ticket';

export function createSprint() {
  const n = P().sprints.length + 1;
  mutate((p) =>
    p.sprints.push({
      id: uid(),
      name: `${p.key} Sprint ${n}`,
      goal: '',
      state: 'future',
      startDate: '',
      endDate: '',
    }),
  );
  toast(`Created ${P().key} Sprint ${n}`);
}
export function deleteSprint(s: Any) {
  const n = P().tickets.filter((x: Any) => x.sprintId === s.id).length;
  openModal(
    <Confirm
      title={`Delete ${s.name}?`}
      label="Delete sprint"
      text={`${n ? `Its ${n} issues move back to the backlog. ` : ''}You can undo with ⌘Z.`}
      onYes={() =>
        mutate((p) => {
          p.tickets.forEach((x: Any) => {
            if (x.sprintId === s.id) setField(x, 'sprintId', null);
          });
          p.sprints = p.sprints.filter((x: Any) => x.id !== s.id);
        })
      }
    />,
  );
}
// ---------------------------------------------------------------- test automation
function BaseUrlModal({ resolve }: { resolve: (v: string | null) => void }) {
  const [v, setV] = useState(P().automation.baseUrl || '');
  return (
    <Modal
      title="Where should the tests run?"
      actions={[
        {
          label: 'Cancel',
          onClick: () => {
            closeModal();
            resolve(null);
          },
        },
        {
          label: 'Save and run',
          kind: 'primary',
          onClick: () => {
            if (!/^https?:\/\/\S+$/i.test(v.trim()))
              return toast('Enter a full URL starting with http:// or https://', 'err');
            mutate((p) => {
              p.automation.baseUrl = v.trim();
            });
            closeModal();
            resolve(v.trim());
          },
        },
      ]}
    >
      <p style={{ marginTop: 0 }}>
        Enter the URL of the application under test. Claude writes Playwright scripts against it and
        they run in a headless browser on this machine.
      </p>
      <label className="field">
        <span>
          Application URL <span className="req">*</span>
        </span>
        <TF
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="http://localhost:3000"
        />
      </label>
    </Modal>
  );
}
const askBaseUrl = () =>
  new Promise<string | null>((resolve) => openModal(<BaseUrlModal resolve={resolve} />));
/**
 * Tests run on GitHub Actions when it's set up for the project and you run on GitHub (always, on
 * the deployed app).
 */
export const runsOnGitHub = () => runPlace() === 'github' && Boolean(P().automation?.github?.repo);
/** One event of a test run stream (also used when collecting a GitHub Actions run later). */
function runEvent(ev: Any, run: Any, push: (m: string, l?: string) => void, baseUrl: string) {
  const { t, tc } = ev.ticketId ? findTc(ev.ticketId, ev.tcId) : ({} as Any);
  const label = t && tc ? `${tcKey(t, t.testCases.indexOf(tc))} ${tc.title}` : '';
  if (ev.type === 'phase') {
    push(ev.message, ev.level);
    if (ev.url) run.url = ev.url;
  } else if (ev.type === 'error') push(ev.message || ev.error, 'err');
  else if (ev.type === 'script' && tc)
    mutate(() => {
      tc.script = ev.code;
    });
  else if (ev.type === 'start') {
    if (!ev.queued) {
      run.current = ev.tcId;
      push(`Running ${label}`);
    }
  } else if (ev.type === 'reported') run.report = ev;
  else if (ev.type === 'pending') {
    run.pending = ev.github;
    mutate((pp: Any) => {
      pp.automation.ghPending = { ...ev.github, at: nowIso() };
    });
  } else if (ev.type === 'result' && tc) {
    run.done += 1;
    run.current = null;
    if (ev.result.status === 'Pass') run.pass += 1;
    else run.fail += 1;
    const msg = {
      message: `${label} — ${ev.result.status}${ev.result.durationMs ? ` (${(ev.result.durationMs / 1000).toFixed(1)}s)` : ''}${ev.result.runner === 'github' ? ' · GitHub Actions' : ''}`,
      level: ev.result.status === 'Pass' ? 'pass' : 'fail',
    };
    if (run.log[run.log.length - 1]?.message.startsWith('Running '))
      run.log[run.log.length - 1] = msg;
    else run.log.push(msg);
    mutate((pp: Any) => {
      if (ev.result.healed) {
        tc.healed = ev.result.healed;
        logEvent(
          t,
          `Self-healing agent repaired the script of ${tcKey(t, t.testCases.indexOf(tc))}: ${ev.result.healed.reason}`,
          'Automation',
        );
      }
      tc.lastRun = ev.result;
      tc.status = ev.result.status;
      logEvent(
        t,
        `automated test ${tcKey(t, t.testCases.indexOf(tc))}: ${ev.result.status}${ev.result.runner === 'github' ? ' (GitHub Actions)' : ''}`,
        'Automation',
      );
      recordAutomationResult(pp, t, tc, ev.result, baseUrl);
    });
  }
}
async function finishRun(run: Any, push: (m: string, l?: string) => void) {
  run.running = false;
  run.current = null;
  emit();
  if (run.pending)
    toast('Still running on GitHub Actions: results are collected when it finishes.', 'warn');
  else
    toast(`Test run finished · ${run.pass} passed · ${run.fail} failed`, run.fail ? 'err' : 'ok');
  if (run.report) {
    // The server added automated comments: save our results, then pull them in.
    await saveNow();
    await pullRemote({ quiet: true });
    const r = run.report;
    const bits = [
      r.commented.length && `commented on ${r.commented.join(', ')}`,
      r.notified.length && `notified ${[...new Set(r.notified)].join(', ')}`,
      r.emailed.length && `emailed ${r.emailed.length}`,
    ].filter(Boolean);
    if (bits.length) {
      push(`Test report: ${bits.join(' · ')}`, 'info');
      toast(`Test report: ${bits.join(' · ')}`);
    }
    if (r.skipped.length) push(`Not notified: ${r.skipped.join(', ')}`, 'warn');
    loadNotifs();
  }
}
function newRun(total: number, first: string) {
  const run: Any = {
    running: true,
    ctrl: new AbortController(),
    total,
    done: 0,
    pass: 0,
    fail: 0,
    current: null,
    log: [{ message: first }],
  };
  S.autoRun = run;
  emit();
  const push = (message: string, level?: string) => {
    run.log.forEach((l: Any) => {
      if (!l.level) l.level = 'info';
    });
    run.log.push({ message, level });
    emit();
  };
  return { run, push };
}
export async function runTests(list: { t: Any; tc: Any }[], { regenerate = false } = {}) {
  if (!list.length) return toast('No test cases to run.', 'err');
  if (S.autoRun?.running) return toast('Tests are already running.', 'err');
  const github = runsOnGitHub();
  if (!github && !S.engine?.browser) {
    await loadEngine();
    if (!S.engine?.browser) {
      toast(
        S.engine?.serverless
          ? 'This server can’t run a browser. Run tests on GitHub Actions, or connect a remote browser, in Test automation → Settings.'
          : 'No test browser yet. See Test automation → Settings.',
        'err',
      );
      S.autoTab = 'settings';
      S.nav(`/p/${P().id}/automation`);
      return;
    }
  }
  if (github && P().automation.ghPending)
    return toast(
      'A GitHub Actions run is still being collected. Wait for it, or collect it on Test automation.',
      'err',
    );
  const baseUrl = P().automation.baseUrl || (await askBaseUrl());
  if (!baseUrl) return;
  // Running tests starts straight away: no questions first (scripts that are missing are written
  // from the App setup).
  const { run, push } = newRun(
    list.length,
    `Running ${list.length} test${list.length > 1 ? 's' : ''} against ${baseUrl}${github ? ` on GitHub Actions (${P().automation.github.repo})` : ''}`,
  );
  try {
    const res = await api('/api/automation/run', {
      method: 'POST',
      raw: true,
      signal: run.ctrl.signal,
      body: {
        baseUrl,
        regenerate,
        provider: S.settings.provider || undefined,
        model: S.settings.model || undefined,
        run: S.aiRun || undefined,
        heal: P().automation.selfHeal !== false,
        runOn: github ? 'github' : undefined,
        project: { id: P().id, name: P().name, summary: P().summary },
        items: list.map(({ t, tc }) => ({
          ticket: {
            id: t.id,
            key: t.key,
            title: t.title,
            userStory: t.userStory,
            acceptanceCriteria: t.acceptanceCriteria,
          },
          tc: {
            id: tc.id,
            title: tc.title,
            steps: tc.steps,
            expected: tc.expected,
            preconditions: tc.preconditions,
            script: regenerate ? '' : tc.script,
          },
        })),
      },
    });
    await readNdjson(res, (ev) => runEvent(ev, run, push, baseUrl));
  } catch (e: Any) {
    push(
      e.name === 'AbortError' ? 'Run stopped' : e.message,
      e.name === 'AbortError' ? 'warn' : 'err',
    );
  } finally {
    await finishRun(run, push);
  }
  if (run.pending) collectGitHubRun();
}
/**
 * Collects a GitHub Actions run that outlived its request (the server waits up to ~4 minutes per
 * call).
 */
export async function collectGitHubRun() {
  const pending = P().automation?.ghPending;
  if (!pending || S.autoRun?.running) return;
  const n = pending.runs.reduce((k: number, r: Any) => k + (r.tcIds?.length || 0), 0);
  const { run, push } = newRun(
    n,
    `Collecting ${n} test result${n === 1 ? '' : 's'} from GitHub Actions (${pending.repo})…`,
  );
  try {
    const res = await api('/api/automation/github', {
      method: 'POST',
      raw: true,
      signal: run.ctrl.signal,
      body: { action: 'collect', projectId: P().id, pending },
    });
    run.pending = null;
    await readNdjson(res, (ev) =>
      runEvent(ev, run, push, pending.baseUrl || P().automation.baseUrl),
    );
    if (!run.pending)
      mutate((pp: Any) => {
        delete pp.automation.ghPending;
      });
  } catch (e: Any) {
    push(
      e.name === 'AbortError'
        ? 'Stopped collecting (the run keeps going on GitHub; collect it later).'
        : e.message,
      e.name === 'AbortError' ? 'warn' : 'err',
    );
  } finally {
    await finishRun(run, push);
  }
  if (run.pending && !run.ctrl.signal.aborted) setTimeout(collectGitHubRun, 2000);
}
export async function installBrowser() {
  await withBusy('Installing Chromium for test automation…', async () => {
    const res = await api('/api/automation/install', { method: 'POST', raw: true, body: {} });
    await readNdjson(res, (ev) => {
      if (ev.type === 'log') setBusy(`Installing Chromium… ${ev.line.slice(0, 60)}`);
      if (ev.type === 'error') throw new Error(ev.message || ev.error);
    });
  });
  await loadEngine();
  if (S.engine?.browser) toast('Chromium installed — ready to run tests');
}
