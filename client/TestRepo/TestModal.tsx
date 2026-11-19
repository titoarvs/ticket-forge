'use client';
import { useState } from 'react';
import {
  type Any,
  P,
  uid,
  toast,
  api,
  aiBody,
  nowIso,
  me,
  closeModal,
  openModal,
  ago,
  can,
  isSub,
} from '../core';
import { Modal, Confirm, Ico, I, TypeIcon } from '../ui';
import { TF, SF, MenuItem, TA } from '../fields';
import { openDrawer } from '../actions';
import { repo, edit, TEST_TYPES } from './run-status';
import {
  canEdit,
  CONTENT,
  wfOf,
  snapshot,
  nextKey,
  wfAction,
  WF_CLS,
  WfLoz,
  canReview,
  RunLoz,
} from './TestManagement';

export function TestModal({
  test,
  folderId,
  issueId,
}: {
  test: Any | null;
  folderId: string | null;
  issueId?: string;
}) {
  const p = P();
  const r = repo(p);
  const [d, setD] = useState<Any>(() =>
    test
      ? JSON.parse(JSON.stringify(test))
      : {
          title: '',
          type: 'Manual',
          folderId,
          priority: 'Medium',
          labels: [],
          preconditions: '',
          steps: [{ id: uid(), action: '', data: '', expected: '' }],
          issueIds: issueId ? [issueId] : [],
        },
  );
  const [addIssue, setAddIssue] = useState('');
  const [improving, setImproving] = useState(false);
  const [ask, setAsk] = useState('');
  const ed = canEdit();
  /**
   * The AI rewrites the draft to the company's test standard (or as asked); nothing is saved until
   * Save.
   */
  const improve = async () => {
    if (!d.title.trim()) {
      toast('Give the test a title first.', 'err');
      return;
    }
    setImproving(true);
    try {
      const out = await api(`/api/projects/${p.id}/testrepo-ai`, {
        method: 'POST',
        body: aiBody({
          action: 'improve',
          test: { ...d, key: test?.key },
          instruction: ask.trim(),
        }),
      });
      setD({
        ...d,
        ...out.test,
        steps: (out.test.steps || []).map((st: Any) => ({ id: uid(), ...st })),
        labels: out.test.labels?.length ? out.test.labels : d.labels,
      });
      toast(out.changes || 'Rewritten to your test standard. Review, then save.', 'ok', {
        title: 'Test improved',
      });
      setAsk('');
    } catch (e: Any) {
      toast(`Couldn’t improve the test: ${e.message}`, 'err');
    } finally {
      setImproving(false);
    }
  };
  const set = (k: string, v: Any) => setD({ ...d, [k]: v });
  const setStep = (i: number, k: string, v: string) =>
    setD({ ...d, steps: d.steps.map((s: Any, j: number) => (j === i ? { ...s, [k]: v } : s)) });
  const move = (i: number, by: number) => {
    const st = [...d.steps];
    const [x] = st.splice(i, 1);
    st.splice(i + by, 0, x);
    set('steps', st);
  };
  const save = () => {
    if (!d.title.trim()) {
      toast('Give the test a title.', 'err');
      return;
    }
    const clean = {
      ...d,
      title: d.title.trim(),
      steps: d.steps.filter((s: Any) => s.action.trim() || s.expected.trim()),
    };
    edit((rr, pp) => {
      if (test) {
        const i = rr.tests.findIndex((x: Any) => x.id === test.id);
        if (i >= 0) {
          const old = rr.tests[i];
          const changed = CONTENT.some(
            (k) => JSON.stringify(old[k] ?? '') !== JSON.stringify(clean[k] ?? ''),
          );
          // Changing an approved test makes a new version: the approved one is kept in its history.
          const bump =
            changed && wfOf(old) === 'Approved'
              ? {
                  version: (old.version || 1) + 1,
                  versions: [...(old.versions || []), snapshot(old)].slice(-15),
                  status: 'Draft',
                }
              : {};
          rr.tests[i] = { ...old, ...clean, ...bump, updatedAt: nowIso(), updatedBy: me() };
        }
      } else
        rr.tests.push({
          ...clean,
          id: uid(),
          key: nextKey(rr, pp, 't'),
          createdAt: nowIso(),
          createdBy: me(),
          status: 'Draft',
          version: 1,
        });
    });
    closeModal();
    const after = test && repo().tests.find((x: Any) => x.id === test.id);
    toast(
      test
        ? after && after.version !== test.version
          ? `${test.key} saved as version ${after.version} (Draft): submit it for review to approve it again.`
          : `${test.key} saved`
        : 'Test created as a Draft: submit it for review when it’s ready.',
    );
  };
  const [note, setNote] = useState('');
  const act = (a: string) => {
    const err = wfAction(test.id, a, note);
    if (err) {
      toast(err, 'err');
      return;
    }
    setNote('');
    toast(
      `${test.key}: ${{ submit: 'submitted for review', approve: 'approved', changes: 'sent back for changes', deprecate: 'deprecated', restore: 'restored as a Draft' }[a]}`,
    );
    closeModal();
  };
  const live = test ? repo().tests.find((x: Any) => x.id === test.id) || test : null;
  const [showV, setShowV] = useState<number | null>(null);
  const runs = test
    ? r.executions
        .filter((e: Any) => e.runs?.[test.id])
        .sort((a: Any, b: Any) => String(b.createdAt).localeCompare(String(a.createdAt)))
    : [];
  const issues = (d.issueIds || [])
    .map((id: string) => p.tickets.find((x: Any) => x.id === id))
    .filter(Boolean);
  return (
    <Modal
      title={test ? `${test.key} · ${test.title}` : 'New test'}
      wide
      persistent
      actions={[
        ...(test && ed
          ? [
              {
                label: 'Delete',
                kind: 'danger' as const,
                onClick: () =>
                  openModal(
                    <Confirm
                      title={`Delete ${test.key}?`}
                      label="Delete test"
                      text="It’s removed from the repository, its plans and executions (their other results stay)."
                      onYes={() => {
                        edit((rr) => {
                          rr.tests = rr.tests.filter((x: Any) => x.id !== test.id);
                          rr.plans.forEach((pl: Any) => {
                            pl.testIds = pl.testIds.filter((x: string) => x !== test.id);
                          });
                          rr.executions.forEach((e: Any) => {
                            e.testIds = e.testIds.filter((x: string) => x !== test.id);
                            delete e.runs?.[test.id];
                          });
                        });
                        toast(`${test.key} deleted`);
                      }}
                    />,
                  ),
              },
            ]
          : []),
        { label: 'Cancel' },
        ...(ed
          ? [{ label: test ? 'Save' : 'Create test', kind: 'primary' as const, onClick: save }]
          : []),
      ]}
    >
      {live && (
        <div className={`wf-bar ${WF_CLS[wfOf(live)]}`}>
          <WfLoz t={live} />
          <span className="muted small">
            Version {live.version || 1}
            {live.approvedBy && wfOf(live) === 'Approved'
              ? ` · approved by ${live.approvedBy} ${ago(live.approvedAt)}`
              : ''}
          </span>
          <span className="spacer" />
          {ed && ['Draft', 'Needs update'].includes(wfOf(live)) && (
            <button className="btn sm primary" onClick={() => act('submit')}>
              Submit for review
            </button>
          )}
          {canReview() && wfOf(live) === 'Ready for review' && (
            <>
              <button className="btn sm primary" onClick={() => act('approve')}>
                Approve
              </button>
              <button className="btn sm" onClick={() => act('changes')}>
                Request changes
              </button>
            </>
          )}
          {canReview() && ['Draft', 'Needs update'].includes(wfOf(live)) && (
            <button
              className="btn sm subtle"
              onClick={() => act('approve')}
              title="Approve without a separate review"
            >
              Approve
            </button>
          )}
          {ed && wfOf(live) !== 'Deprecated' && (
            <button className="btn sm subtle" onClick={() => act('deprecate')}>
              Deprecate
            </button>
          )}
          {ed && wfOf(live) === 'Deprecated' && (
            <button className="btn sm" onClick={() => act('restore')}>
              Restore
            </button>
          )}
          {(canReview() || ed) && wfOf(live) !== 'Deprecated' && (
            <TF
              bare
              className="wf-note"
              value={note}
              placeholder={
                wfOf(live) === 'Ready for review'
                  ? 'Review comment (needed to request changes)'
                  : 'Comment (optional)'
              }
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </div>
      )}
      {live && wfOf(live) === 'Needs update' && (live.reviews || []).slice(-1)[0]?.comment && (
        <div className="warn-banner small" style={{ marginBottom: 10 }}>
          <Ico svg={I.warn} />
          <span>
            <b>{live.reviews.slice(-1)[0].by} asked for changes:</b>{' '}
            {live.reviews.slice(-1)[0].comment}
          </span>
        </div>
      )}
      <div className="grid2">
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span>Title</span>
          <TF
            autoFocus={!test}
            disabled={!ed}
            value={d.title}
            placeholder="e.g. Approve a salary proposal as the assigned approver"
            onChange={(e) => set('title', e.target.value)}
          />
        </label>
        <label className="field">
          <span>Type</span>
          <SF disabled={!ed} value={d.type} onChange={(e) => set('type', e.target.value)}>
            {TEST_TYPES.map((x) => (
              <MenuItem key={x} value={x}>
                {x}
              </MenuItem>
            ))}
          </SF>
        </label>
        <label className="field">
          <span>Folder</span>
          <SF
            disabled={!ed}
            value={d.folderId || ''}
            onChange={(e) => set('folderId', e.target.value || null)}
          >
            <MenuItem value="">Not in a folder</MenuItem>
            {r.folders.map((f: Any) => (
              <MenuItem key={f.id} value={f.id}>
                {f.name}
              </MenuItem>
            ))}
          </SF>
        </label>
        <label className="field">
          <span>Priority</span>
          <SF disabled={!ed} value={d.priority} onChange={(e) => set('priority', e.target.value)}>
            {['High', 'Medium', 'Low'].map((x) => (
              <MenuItem key={x} value={x}>
                {x}
              </MenuItem>
            ))}
          </SF>
        </label>
        <label className="field">
          <span>Labels</span>
          <TF
            disabled={!ed}
            value={(d.labels || []).join(', ')}
            placeholder="e.g. regression, smoke"
            onChange={(e) =>
              set(
                'labels',
                e.target.value
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span>Preconditions</span>
          <TA
            disabled={!ed}
            rows={2}
            value={d.preconditions}
            placeholder="e.g. Signed in as HR; a pending proposal exists"
            onChange={(e) => set('preconditions', e.target.value)}
          />
        </label>
      </div>
      {ed && can('ai.use') && (
        <div className="xr-improve">
          <TF
            value={ask}
            placeholder="✨ Improve with AI: e.g. convert to Gherkin, add the negative case, split the data out (optional)"
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e: Any) => {
              if (e.key === 'Enter') improve();
            }}
            sx={{ flex: 1 }}
          />
          <button className="btn sm ai" disabled={improving} onClick={improve}>
            {improving ? (
              'Improving…'
            ) : (
              <>
                <Ico svg={I.sparkle} />
                Improve with AI
              </>
            )}
          </button>
        </div>
      )}
      {d.type === 'Cucumber' ? (
        <>
          <h4 className="sync-h">Scenario (Gherkin)</h4>
          <TA
            disabled={!ed}
            rows={8}
            value={d.gherkin || ''}
            spellCheck={false}
            className="xr-gherkin"
            placeholder={
              'Scenario: Approver approves a salary proposal\n  Given a pending proposal assigned to me\n  When I approve it with a note\n  Then the employee is notified and the history shows "Approved"'
            }
            onChange={(e) => set('gherkin', e.target.value)}
          />
        </>
      ) : (
        <>
          <h4 className="sync-h">Steps</h4>
          <table className="tbl xr-steps">
            <thead>
              <tr>
                <th style={{ width: 28 }}>#</th>
                <th>Action</th>
                <th>Data</th>
                <th>Expected result</th>
                {ed && <th style={{ width: 80 }} />}
              </tr>
            </thead>
            <tbody>
              {d.steps.map((s: Any, i: number) => (
                <tr key={s.id}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    <TA
                      disabled={!ed}
                      rows={1}
                      value={s.action}
                      placeholder="What to do"
                      onChange={(e) => setStep(i, 'action', e.target.value)}
                    />
                  </td>
                  <td>
                    <TA
                      disabled={!ed}
                      rows={1}
                      value={s.data}
                      placeholder="Test data"
                      onChange={(e) => setStep(i, 'data', e.target.value)}
                    />
                  </td>
                  <td>
                    <TA
                      disabled={!ed}
                      rows={1}
                      value={s.expected}
                      placeholder="What should happen"
                      onChange={(e) => setStep(i, 'expected', e.target.value)}
                    />
                  </td>
                  {ed && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="icon-btn"
                        disabled={i === 0}
                        title="Move up"
                        aria-label="Move step up"
                        onClick={() => move(i, -1)}
                      >
                        <Ico svg={I.up} />
                      </button>
                      <button
                        className="icon-btn"
                        disabled={i === d.steps.length - 1}
                        title="Move down"
                        aria-label="Move step down"
                        onClick={() => move(i, 1)}
                      >
                        <Ico svg={I.down} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Remove step"
                        aria-label="Remove step"
                        onClick={() =>
                          set(
                            'steps',
                            d.steps.filter((_: Any, j: number) => j !== i),
                          )
                        }
                      >
                        <Ico svg={I.trash} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {ed && (
            <button
              className="btn sm subtle"
              onClick={() =>
                set('steps', [...d.steps, { id: uid(), action: '', data: '', expected: '' }])
              }
            >
              <Ico svg={I.plus} />
              Add step
            </button>
          )}
        </>
      )}
      <h4 className="sync-h">Covers these issues</h4>
      <div className="row" style={{ gap: 6 }}>
        {issues.map((x: Any) => (
          <span key={x.id} className="xr-issue">
            <TypeIcon type={x.type} />
            <button className="link-btn" onClick={() => openDrawer('issue', x.id)}>
              {x.key}
            </button>{' '}
            {x.title.slice(0, 40)}
            {ed && (
              <button
                className="icon-btn"
                aria-label={`Unlink ${x.key}`}
                onClick={() =>
                  set(
                    'issueIds',
                    d.issueIds.filter((id: string) => id !== x.id),
                  )
                }
              >
                <Ico svg={I.close} />
              </button>
            )}
          </span>
        ))}
        {!issues.length && <span className="muted small">Not linked to any issue yet.</span>}
        {ed && (
          <SF
            filter
            value={addIssue}
            onChange={(e) => {
              if (e.target.value)
                set('issueIds', [...new Set([...(d.issueIds || []), e.target.value])]);
              setAddIssue('');
            }}
            aria-label="Link an issue"
          >
            <MenuItem value="">+ Link an issue</MenuItem>
            {p.tickets
              .filter((x: Any) => !isSub(x) && !d.issueIds?.includes(x.id))
              .map((x: Any) => (
                <MenuItem key={x.id} value={x.id}>
                  {x.key} {x.title.slice(0, 60)}
                </MenuItem>
              ))}
          </SF>
        )}
      </div>
      {test && (
        <>
          <h4 className="sync-h">Execution history</h4>
          {runs.length ? (
            <ul className="xr-history small">
              {runs.map((e: Any) => (
                <li key={e.id}>
                  <RunLoz s={e.runs[test.id].status} /> <b>{e.key}</b> {e.title}
                  <span className="muted">
                    {' '}
                    · {e.runs[test.id].by || '—'}
                    {e.runs[test.id].at
                      ? ` · ${new Date(e.runs[test.id].at).toLocaleString()}`
                      : ''}
                  </span>
                  {e.runs[test.id].comment && (
                    <div className="muted">“{e.runs[test.id].comment}”</div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Not in any execution yet.</p>
          )}
        </>
      )}
      {live && ((live.reviews || []).length > 0 || (live.versions || []).length > 0) && (
        <>
          <h4 className="sync-h">Review and version history</h4>
          <ul className="xr-history small">
            {[
              ...(live.reviews || []).map((x: Any) => ({ ...x, kind: 'review' })),
              ...(live.versions || []).map((x: Any) => ({ ...x, kind: 'version' })),
            ]
              .sort((a: Any, b: Any) => String(b.at).localeCompare(String(a.at)))
              .map((x: Any, i: number) =>
                x.kind === 'review' ? (
                  <li key={`r${i}`}>
                    <span className={`wf-loz ${WF_CLS[x.to]}`}>{x.to}</span> <b>{x.by}</b>{' '}
                    {
                      (
                        {
                          submit: 'submitted it for review',
                          approve: 'approved',
                          changes: 'requested changes',
                          deprecate: 'deprecated it',
                          restore: 'restored it',
                        } as Any
                      )[x.action]
                    }{' '}
                    (v{x.version}) <span className="muted">· {ago(x.at)}</span>
                    {x.comment && <div className="muted">“{x.comment}”</div>}
                  </li>
                ) : (
                  <li key={`v${i}`}>
                    <b>Version {x.version}</b>{' '}
                    <span className="muted">
                      · {x.status} · {x.by || '—'} · {ago(x.at)}
                    </span>{' '}
                    <button
                      className="link-btn small"
                      onClick={() => setShowV(showV === x.version ? null : x.version)}
                    >
                      {showV === x.version ? 'Hide' : 'View'}
                    </button>
                    {showV === x.version && (
                      <div className="wf-version">
                        <b>{x.title}</b>
                        {x.preconditions && (
                          <div className="muted">Preconditions: {x.preconditions}</div>
                        )}
                        {x.gherkin ? (
                          <pre>{x.gherkin}</pre>
                        ) : (
                          <ol>
                            {(x.steps || []).map((s: Any, k: number) => (
                              <li key={k}>
                                {s.action}
                                {s.data ? ` [${s.data}]` : ''}
                                {s.expected ? <span className="muted"> → {s.expected}</span> : ''}
                              </li>
                            ))}
                          </ol>
                        )}
                        {ed && (
                          <button
                            className="btn sm subtle"
                            onClick={() => {
                              setD({
                                ...d,
                                title: x.title,
                                type: x.type,
                                preconditions: x.preconditions,
                                steps: (x.steps || []).map((s: Any) => ({ ...s, id: uid() })),
                                gherkin: x.gherkin,
                              });
                              toast(
                                `Version ${x.version} loaded into the editor: save to make it the current version.`,
                              );
                            }}
                          >
                            Restore this version
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ),
              )}
          </ul>
        </>
      )}
    </Modal>
  );
}
