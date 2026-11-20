'use client';
import { useState } from 'react';
import {
  type Any,
  uid,
  nowIso,
  P,
  isSub,
  closeModal,
  startTask,
  api,
  aiBody,
  readNdjson,
  openModal,
  toast,
  me,
} from '../core';
import { Modal, TypeIcon } from '../ui';
import { SF, MenuItem, CB, TA } from '../fields';
import { nextKey, CovLoz, coverageOf } from './TestManagement';
import { repo, edit } from './run-status';

/**
 * TicketForge's own Playwright runs feed the repository: a result for an issue test case that was
 * imported as a repository test lands in that day's "Automated runs" execution (per environment),
 * like BrowserStack Automate → TM.
 * Call inside a mutate with the project being changed.
 */
export function recordAutomationResult(pp: Any, ticket: Any, tc: Any, result: Any, baseUrl = '') {
  const rr = pp.testRepo;
  if (!rr?.tests?.length) return;
  const tests = rr.tests.filter((x: Any) => x.source?.tcId === tc.id);
  if (!tests.length) return;
  let env = '';
  try {
    env = new URL(baseUrl).host;
  } catch {
    /* no URL */
  }
  const day = new Date().toISOString().slice(0, 10);
  let ex = rr.executions.find(
    (x: Any) => x.automation && x.day === day && (x.environment || '') === env,
  );
  if (!ex) {
    rr.seq = { t: 0, tp: 0, te: 0, ...(rr.seq || {}) };
    ex = {
      id: uid(),
      key: nextKey(rr, pp, 'te'),
      title: `Automated runs — ${day}`,
      planId: null,
      testIds: [],
      environment: env,
      automation: true,
      day,
      runs: {},
      createdAt: nowIso(),
      createdBy: 'Automation',
    };
    rr.executions.push(ex);
  }
  for (const x of tests) {
    if (!ex.testIds.includes(x.id)) ex.testIds.push(x.id);
    ex.runs[x.id] = {
      steps: {},
      defectIds: [],
      ...(ex.runs[x.id] || {}),
      status: result.status === 'Pass' ? 'PASSED' : 'FAILED',
      automated: true,
      comment:
        result.status === 'Pass'
          ? `Passed in ${((result.durationMs || 0) / 1000).toFixed(1)}s (${ticket.key})`
          : String(result.error || 'Failed').slice(0, 1500),
      evidence: result.screenshot || null,
      at: nowIso(),
      by: 'Automation',
    };
  }
}
// ---------------------------------------------------------------- AI: write repository tests for
// issues
export function AiWriteModal({ scope, folderId }: { scope: string; folderId: string | null }) {
  const p = P();
  const r = repo(p);
  const covered = (id: string) => r.tests.some((t: Any) => t.issueIds?.includes(id));
  const initEpic = scope.startsWith('epic:')
    ? scope.slice(5)
    : scope.startsWith('issue:')
      ? p.tickets.find((x: Any) => x.id === scope.slice(6))?.epicId || ''
      : '';
  const [epic, setEpic] = useState(initEpic);
  const pool = p.tickets.filter(
    (t: Any) => !isSub(t) && (!epic || (epic === 'none' ? !t.epicId : t.epicId === epic)),
  );
  const [pick, setPick] = useState<Record<string, boolean>>(() =>
    scope.startsWith('issue:')
      ? { [scope.slice(6)]: true }
      : Object.fromEntries(pool.map((t: Any) => [t.id, !covered(t.id)])),
  );
  const [text, setText] = useState('');
  const chosen = pool.filter((t: Any) => pick[t.id]);
  const go = async () => {
    closeModal();
    const ctrl = new AbortController();
    const task = startTask(
      `Writing tests for ${chosen.length} issue${chosen.length === 1 ? '' : 's'}`,
      {
        total: chosen.length,
        kind: 'ai',
        cancel: () => ctrl.abort(),
      },
    );
    try {
      const res = await api(`/api/projects/${p.id}/testrepo-ai`, {
        method: 'POST',
        raw: true,
        signal: ctrl.signal,
        body: aiBody({
          action: 'write',
          issueIds: chosen.map((t: Any) => t.id),
          instruction: text.trim(),
        }),
      });
      let out: Any = null;
      await readNdjson(res, (ev) => {
        if (ev.type === 'progress')
          task.update({ detail: ev.message, done: ev.done, total: ev.total });
        else if (ev.type === 'done') out = ev;
        else if (ev.type === 'error') throw new Error(ev.error);
      });
      if (!out) throw new Error('Nothing came back.');
      task.finish(
        `${out.results.reduce((n: number, x: Any) => n + x.tests.length, 0)} tests written`,
      );
      openModal(<AiTestsReview results={out.results} folderId={folderId} />);
    } catch (e: Any) {
      if (e.name === 'AbortError') {
        task.fail('');
        toast('Nothing was added.', 'info', { title: 'Stopped' });
      } else task.fail(`Couldn’t write the tests: ${e.message}`);
    }
  };
  return (
    <Modal
      title="Write tests with AI"
      wide
      actions={[
        { label: 'Cancel' },
        {
          label: `Write tests for ${chosen.length} issue${chosen.length === 1 ? '' : 's'}`,
          kind: 'ai',
          disabled: !chosen.length || chosen.length > 40,
          onClick: go,
        },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        The AI writes reusable repository tests for each issue from its story and acceptance
        criteria, following your company’s test standard (Administration → Generation → Test
        management), and skips what existing tests already cover. Issues without tests are ticked.
        You review before anything is added.
      </p>
      <div className="row split-tools">
        <SF filter value={epic} onChange={(e) => setEpic(e.target.value)} aria-label="Epic">
          <MenuItem value="">All epics</MenuItem>
          {p.epics.map((e: Any) => (
            <MenuItem key={e.id} value={e.id}>
              {e.key} {e.title}
            </MenuItem>
          ))}
          <MenuItem value="none">No epic</MenuItem>
        </SF>
        <button
          className="btn sm subtle"
          onClick={() =>
            setPick({
              ...pick,
              ...Object.fromEntries(pool.map((t: Any) => [t.id, !covered(t.id)])),
            })
          }
        >
          Tick uncovered ({pool.filter((t: Any) => !covered(t.id)).length})
        </button>
        <button
          className="btn sm subtle"
          onClick={() =>
            setPick({ ...pick, ...Object.fromEntries(pool.map((t: Any) => [t.id, false])) })
          }
        >
          None
        </button>
        <span className="spacer" />
        <span className="muted small">
          {chosen.length} picked{chosen.length > 40 ? ' · 40 at a time' : ''}
        </span>
      </div>
      <div className="split-list">
        {pool.map((t: Any) => (
          <label key={t.id} className={`split-row ${pick[t.id] ? '' : 'off'}`}>
            <CB
              checked={Boolean(pick[t.id])}
              onChange={() => setPick({ ...pick, [t.id]: !pick[t.id] })}
              aria-label={`Write tests for ${t.key}`}
            />
            <TypeIcon type={t.type} />
            <span className="key">{t.key}</span>
            <span className="split-title">{t.title}</span>
            <CovLoz s={coverageOf(t.id).status} />
            <span className="muted small">{t.acceptanceCriteria?.length || 0} AC</span>
          </label>
        ))}
      </div>
      <label className="field" style={{ marginTop: 10 }}>
        <span>Instructions for this run (optional)</span>
        <TA
          rows={2}
          value={text}
          placeholder="e.g. Focus on permissions for HR vs Employee; include one Gherkin scenario per issue for the demo."
          onChange={(e) => setText(e.target.value)}
        />
      </label>
    </Modal>
  );
}
function AiTestsReview({ results, folderId }: { results: Any[]; folderId: string | null }) {
  const [pick, setPick] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      results.flatMap((x) => x.tests.map((_: Any, i: number) => [`${x.ticketId}:${i}`, true])),
    ),
  );
  const [open, setOpen] = useState<string | null>(null);
  const n = Object.values(pick).filter(Boolean).length;
  const apply = () => {
    let made = 0;
    edit((rr, pp) => {
      for (const x of results) {
        const t = pp.tickets.find((y: Any) => y.id === x.ticketId);
        const ep = pp.epics.find((e: Any) => e.id === t?.epicId);
        const epicFolder = ep
          ? rr.folders.find((f: Any) => f.name === `${ep.key} ${ep.title}`)?.id
          : null;
        x.tests.forEach((tc: Any, i: number) => {
          if (!pick[`${x.ticketId}:${i}`]) return;
          rr.tests.push({
            id: uid(),
            key: nextKey(rr, pp, 't'),
            status: 'Draft',
            version: 1,
            ...tc,
            steps: (tc.steps || []).map((st: Any) => ({ id: uid(), ...st })),
            folderId: folderId || epicFolder || null,
            issueIds: [x.ticketId],
            createdAt: nowIso(),
            createdBy: me(),
            source: { ai: true },
          });
          made++;
        });
      }
    });
    closeModal();
    toast(
      `${made} test${made === 1 ? '' : 's'} added to the repository, linked to their issues.`,
      'ok',
      { title: 'Tests added' },
    );
  };
  return (
    <Modal
      title="Review the AI’s tests"
      wide
      persistent
      actions={[
        { label: 'Cancel' },
        {
          label: `Add ${n} test${n === 1 ? '' : 's'}`,
          kind: 'primary',
          disabled: !n,
          onClick: apply,
        },
      ]}
    >
      <div className="sync-pane">
        {results.map((x) => (
          <div key={x.ticketId} className="pt-page">
            <div className="pt-head">
              <span className="key">{x.key}</span>
              <b className="split-title">{x.title}</b>
              <span className="muted small">
                {x.error ? <span className="warn-text">{x.error}</span> : `${x.tests.length} tests`}
              </span>
            </div>
            {x.tests.map((tc: Any, i: number) => {
              const k = `${x.ticketId}:${i}`;
              return (
                <div key={k} className={`sync-item pt-tc ${pick[k] ? '' : 'off'}`}>
                  <CB
                    checked={Boolean(pick[k])}
                    onChange={() => setPick({ ...pick, [k]: !pick[k] })}
                    aria-label="Include"
                  />
                  <div className="sync-body">
                    <div>
                      <span className="loz">{tc.type}</span> <b>{tc.title}</b>{' '}
                      <span className="muted small">
                        · {tc.priority}
                        {tc.labels?.length ? ` · ${tc.labels.join(', ')}` : ''}
                      </span>
                    </div>
                    <button
                      className="link-btn small"
                      onClick={() => setOpen(open === k ? null : k)}
                    >
                      {open === k
                        ? 'Hide'
                        : tc.type === 'Cucumber'
                          ? 'Show scenario'
                          : `${tc.steps.length} steps`}
                    </button>
                    {open === k &&
                      (tc.type === 'Cucumber' ? (
                        <pre className="xr-gherkin-view">{tc.gherkin}</pre>
                      ) : (
                        <div className="pt-steps small">
                          {tc.preconditions && (
                            <p>
                              <b>Preconditions:</b> {tc.preconditions}
                            </p>
                          )}
                          <ol>
                            {tc.steps.map((st: Any, j: number) => (
                              <li key={j}>
                                {st.action}
                                {st.data ? <span className="muted"> [{st.data}]</span> : null}
                                {st.expected ? (
                                  <>
                                    {' '}
                                    → <i>{st.expected}</i>
                                  </>
                                ) : null}
                              </li>
                            ))}
                          </ol>
                        </div>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Modal>
  );
}
