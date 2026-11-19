'use client';
import { useState } from 'react';
import {
  useStore,
  P,
  type Any,
  nowIso,
  me,
  toast,
  mutate,
  newTicket,
  addLink,
  logEvent,
  openModal,
  peopleNames,
  can,
} from '../core';
import { Modal, Confirm, Ico, I, TypeIcon, StatusLoz } from '../ui';
import { SF, MenuItem, TA } from '../fields';
import { openDrawer } from '../actions';
import { repo, edit, RUN_STATUS, STATUS_LABEL } from './run-status';
import { canEdit, runStatusFromSteps, StatusBar, counts, RunLoz } from './TestManagement';
import { importJunit } from './CsvImportModal';

export function ExecutionModal({ id, startAt }: { id: string; startAt?: string }) {
  useStore(); // a dialog doesn't redraw with the page: follow the project so results show as they're marked
  const p = P();
  const r = repo(p);
  const e = r.executions.find((x: Any) => x.id === id);
  const [cur, setCur] = useState<string | null>(
    startAt ||
      e?.testIds.find((t: string) => e.runs?.[t]?.status !== 'PASSED') ||
      e?.testIds[0] ||
      null,
  );
  const [picked, setPicked] = useState<string[]>([]);
  /** Bulk update of the selected runs (result and/or assignee). */
  const bulk = (patch: Any) => {
    edit((rr) => {
      const ex = rr.executions.find((x: Any) => x.id === id);
      if (!ex) return;
      ex.runs = ex.runs || {};
      for (const tid of picked)
        ex.runs[tid] = {
          status: 'TODO',
          steps: {},
          comment: '',
          defectIds: [],
          ...(ex.runs[tid] || {}),
          ...patch,
          ...(patch.status ? { at: nowIso(), by: me() } : {}),
        };
    });
    toast(`${picked.length} test run${picked.length === 1 ? '' : 's'} updated`);
  };
  if (!e)
    return (
      <Modal title="Execution not found">
        <p>It may have been deleted.</p>
      </Modal>
    );
  const ed = canEdit();
  const test = r.tests.find((t: Any) => t.id === cur);
  const run = cur
    ? e.runs?.[cur] || { status: 'TODO', steps: {}, comment: '', defectIds: [] }
    : null;
  const setRun = (patch: Any, tag?: string) =>
    edit((rr) => {
      const ex = rr.executions.find((x: Any) => x.id === id);
      if (!ex || !cur) return;
      ex.runs = ex.runs || {};
      ex.runs[cur] = {
        status: 'TODO',
        steps: {},
        comment: '',
        defectIds: [],
        ...(ex.runs[cur] || {}),
        ...patch,
        at: nowIso(),
        by: me(),
      };
    }, tag);
  const setStep = (stepId: string, st: string) => {
    const steps = { ...(run.steps || {}), [stepId]: st };
    setRun({ steps, status: runStatusFromSteps(steps, test?.steps?.length || 0) });
  };
  const createDefect = () => {
    if (!test) return;
    const failed = (test.steps || [])
      .map((s: Any, i: number) => ({ s, i, st: run.steps?.[s.id] }))
      .filter((x: Any) => x.st === 'FAILED');
    const linked = (test.issueIds || [])
      .map((x: string) => p.tickets.find((t: Any) => t.id === x))
      .filter(Boolean);
    let bug: Any = null;
    mutate((pp: Any) => {
      bug = newTicket({
        type: 'Bug',
        priority: test.priority === 'High' ? 'High' : 'Medium',
        epicId: linked[0]?.epicId || null,
        labels: ['defect'],
        title: `${test.title}: fails${failed[0] ? ` at step ${failed[0].i + 1}` : ''}`.slice(
          0,
          120,
        ),
        description: [
          `Found while running ${test.key} in ${e.key} (${e.title})${e.environment ? ` on ${e.environment}` : ''}.`,
          test.preconditions && `Preconditions: ${test.preconditions}`,
          `Steps:\n${(test.steps || []).map((s: Any, i: number) => `${i + 1}. ${s.action}${s.data ? ` (${s.data})` : ''} → expected: ${s.expected || '—'}${run.steps?.[s.id] === 'FAILED' ? '  ✗ FAILED' : ''}`).join('\n')}`,
          run.comment && `Tester’s note: ${run.comment}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      });
      pp.tickets.push(bug);
      for (const l of linked) {
        const t = pp.tickets.find((x: Any) => x.id === l.id);
        if (t) addLink(t, 'is blocked by', bug);
      }
      logEvent(bug, `defect from ${test.key} in ${e.key}`, 'Test management');
      const ex = pp.testRepo.executions.find((x: Any) => x.id === id);
      ex.runs[cur!] = {
        ...ex.runs[cur!],
        defectIds: [...(ex.runs[cur!]?.defectIds || []), bug.id],
      };
    });
    toast(
      `${bug.key} created and linked to the run${linked.length ? ` and to ${linked.map((x: Any) => x.key).join(', ')}` : ''}.`,
      'ok',
      {
        title: 'Defect created',
        action: { label: 'Open', onClick: () => openDrawer('issue', bug.id) },
      },
    );
  };
  const st = e.testIds.map((t: string) => e.runs?.[t]?.status || 'TODO');
  const idx = e.testIds.indexOf(cur || '');
  return (
    <Modal
      title={`${e.key} · ${e.title}`}
      wide
      persistent
      actions={[
        ...(ed
          ? [
              {
                label: 'Delete execution',
                kind: 'danger' as const,
                onClick: () =>
                  openModal(
                    <Confirm
                      title={`Delete ${e.key}?`}
                      label="Delete"
                      text="Its results are removed. Defects created from it stay."
                      onYes={() =>
                        edit((rr) => {
                          rr.executions = rr.executions.filter((x: Any) => x.id !== id);
                        })
                      }
                    />,
                  ),
              },
            ]
          : []),
        { label: 'Close' },
      ]}
    >
      <div className="xr-exec-head">
        <StatusBar statuses={st} />
        <span className="small muted">
          {counts(st).PASSED} passed · {counts(st).FAILED} failed · {counts(st).BLOCKED} blocked ·{' '}
          {counts(st).TODO + counts(st).EXECUTING} to do{e.environment ? ` · ${e.environment}` : ''}
        </span>
        <span className="spacer" />
        {ed && (
          <label
            className="btn sm subtle xr-file"
            title="Import automated results from a JUnit XML report (Playwright, Jest, pytest, Cypress, JUnit…)"
          >
            <Ico svg={I.upload} />
            Import JUnit XML
            <input
              type="file"
              accept=".xml,text/xml"
              hidden
              onChange={async (ev) => {
                const f = ev.target.files?.[0];
                ev.target.value = '';
                if (f) importJunit(id, await f.text(), f.name);
              }}
            />
          </label>
        )}
      </div>
      {ed && picked.length > 0 && (
        <div className="xr-bulk small">
          <b>{picked.length} selected</b>
          <SF
            filter
            value=""
            onChange={(ev) => {
              if (ev.target.value) bulk({ status: ev.target.value });
            }}
            aria-label="Set result"
          >
            <MenuItem value="">Set result…</MenuItem>
            {RUN_STATUS.map((x) => (
              <MenuItem key={x} value={x}>
                {STATUS_LABEL[x]}
              </MenuItem>
            ))}
          </SF>
          <SF
            filter
            value=""
            onChange={(ev) => {
              if (ev.target.value)
                bulk({ assignee: ev.target.value === '-' ? '' : ev.target.value });
            }}
            aria-label="Assign"
          >
            <MenuItem value="">Assign to…</MenuItem>
            <MenuItem value="-">Unassigned</MenuItem>
            {peopleNames().map((n: string) => (
              <MenuItem key={n} value={n}>
                {n}
              </MenuItem>
            ))}
          </SF>
          <button className="link-btn small" onClick={() => setPicked([])}>
            Clear
          </button>
        </div>
      )}
      <div className="xr-exec">
        <ul className="xr-exec-list">
          {e.testIds.map((tid: string) => {
            const t = r.tests.find((x: Any) => x.id === tid);
            const rr = e.runs?.[tid] || {};
            return (
              t && (
                <li key={tid} className={cur === tid ? 'on' : ''}>
                  {ed && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${t.key}`}
                      checked={picked.includes(tid)}
                      onChange={() =>
                        setPicked(
                          picked.includes(tid) ? picked.filter((x) => x !== tid) : [...picked, tid],
                        )
                      }
                    />
                  )}
                  <button onClick={() => setCur(tid)}>
                    <RunLoz s={rr.status || 'TODO'} />
                    <span className="key">{t.key}</span>
                    <span className="split-title">{t.title}</span>
                    {rr.assignee && (
                      <span className="xr-who" title={`Assigned to ${rr.assignee}`}>
                        {rr.assignee
                          .split(/\s+/)
                          .map((w: string) => w[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                    )}
                    {rr.automated && (
                      <span className="xr-auto" title="Result from automation">
                        ⚙
                      </span>
                    )}
                  </button>
                </li>
              )
            );
          })}
          {ed && e.testIds.length > 1 && (
            <li className="xr-selall">
              <button
                onClick={() => setPicked(picked.length === e.testIds.length ? [] : [...e.testIds])}
              >
                {picked.length === e.testIds.length ? 'Select none' : 'Select all'}
              </button>
            </li>
          )}
        </ul>
        <div className="xr-exec-run">
          {!test ? (
            <p className="muted">Pick a test.</p>
          ) : (
            <>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="key">{test.key}</span>
                <b style={{ flex: 1 }}>{test.title}</b>
                <SF
                  disabled={!ed}
                  filter
                  value={run.assignee || ''}
                  displayEmpty
                  onChange={(ev) => setRun({ assignee: ev.target.value })}
                  aria-label="Assignee"
                >
                  <MenuItem value="">Unassigned</MenuItem>
                  {peopleNames().map((n: string) => (
                    <MenuItem key={n} value={n}>
                      {n}
                    </MenuItem>
                  ))}
                </SF>
                <SF
                  disabled={!ed}
                  value={run.status}
                  onChange={(ev) => setRun({ status: ev.target.value })}
                  aria-label="Result"
                >
                  {RUN_STATUS.map((s) => (
                    <MenuItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </MenuItem>
                  ))}
                </SF>
              </div>
              {test.preconditions && (
                <p className="small">
                  <b>Preconditions:</b> {test.preconditions}
                </p>
              )}
              {test.type === 'Cucumber' ? (
                <pre className="xr-gherkin-view">{test.gherkin || '(no scenario written)'}</pre>
              ) : (
                <table className="tbl xr-steps">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Action</th>
                      <th>Data</th>
                      <th>Expected</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(test.steps || []).map((s: Any, i: number) => {
                      const v = run.steps?.[s.id] || 'TODO';
                      return (
                        <tr key={s.id} className={`xr-step-${v.toLowerCase()}`}>
                          <td className="muted">{i + 1}</td>
                          <td>{s.action}</td>
                          <td className="muted">{s.data}</td>
                          <td>{s.expected}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {ed ? (
                              (['PASSED', 'FAILED', 'BLOCKED'] as const).map((x) => (
                                <button
                                  key={x}
                                  className={`xr-stepbtn ${v === x ? `on xr-${x.toLowerCase()}` : ''}`}
                                  title={STATUS_LABEL[x]}
                                  aria-pressed={v === x}
                                  onClick={() => setStep(s.id, v === x ? 'TODO' : x)}
                                >
                                  {x === 'PASSED' ? '✓' : x === 'FAILED' ? '✗' : '⦸'}
                                </button>
                              ))
                            ) : (
                              <RunLoz s={v} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {!(test.steps || []).length && (
                      <tr>
                        <td colSpan={5} className="muted small">
                          This test has no steps: set its result above.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
              <label className="field">
                <span>Comment / evidence</span>
                <TA
                  disabled={!ed}
                  rows={2}
                  value={run.comment || ''}
                  placeholder="What you saw, links to screenshots or logs"
                  onChange={(ev) => setRun({ comment: ev.target.value }, `xr-c-${id}-${cur}`)}
                />
              </label>
              <div className="row" style={{ gap: 8 }}>
                {(run.defectIds || []).map((did: string) => {
                  const b = p.tickets.find((x: Any) => x.id === did);
                  return (
                    b && (
                      <span key={did} className="xr-issue">
                        <TypeIcon type="Bug" />
                        <button className="link-btn" onClick={() => openDrawer('issue', b.id)}>
                          {b.key}
                        </button>
                        <StatusLoz s={b.status} />
                      </span>
                    )
                  );
                })}
                {ed && can('issue.create') && ['FAILED', 'BLOCKED'].includes(run.status) && (
                  <button className="btn sm" onClick={createDefect}>
                    <Ico svg={I.plus} />
                    Create defect
                  </button>
                )}
                <span className="spacer" />
                <button
                  className="btn sm subtle"
                  disabled={idx <= 0}
                  onClick={() => setCur(e.testIds[idx - 1])}
                >
                  Previous
                </button>
                <button
                  className="btn sm primary"
                  disabled={idx >= e.testIds.length - 1}
                  onClick={() => setCur(e.testIds[idx + 1])}
                >
                  Next test
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
