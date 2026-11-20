'use client';
import { useState } from 'react';
import { type Any, P, toast, uid, nowIso, me, closeModal, openModal } from '../core';
import { Modal, Confirm } from '../ui';
import { TF, SF, MenuItem, TA, CB } from '../fields';
import { openDrawer } from '../actions';
import { repo, edit } from './run-status';
import { canEdit, plannable, nextKey, RunLoz, latestStatus } from './TestManagement';
import { createExecution } from './open-execution';
import { latestPlanStatus } from './Plans';
import { openTest } from './open-test';

export function PlanModal({ plan, draft }: { plan: Any | null; draft?: Any }) {
  const p = P();
  const r = repo(p);
  const [d, setD] = useState<Any>(() =>
    plan
      ? { ...plan, testIds: [...plan.testIds] }
      : draft
        ? {
            title: draft.title,
            description: draft.description,
            epicId: draft.epicId || '',
            sprintId: draft.sprintId || '',
            testIds: draft.tests.map((x: Any) => x.id),
          }
        : { title: '', description: '', epicId: '', sprintId: '', testIds: [] },
  );
  const why: Record<string, string> = Object.fromEntries(
    (draft?.tests || []).map((x: Any) => [x.id, x.why]),
  );
  const [folder, setFolder] = useState(draft ? 'picked' : 'all');
  const ed = canEdit();
  // With an AI draft, its picks come first, in its order (most important first).
  const order = new Map<string, number>(
    (draft?.tests || []).map((x: Any, i: number) => [x.id, i] as [string, number]),
  );
  const pool0 = r.tests
    .filter((t: Any) => plannable(t, p) || d.testIds.includes(t.id))
    .filter(
      (t: Any) =>
        folder === 'all' ||
        (folder === 'epic'
          ? (t.issueIds || []).some(
              (id: string) => p.tickets.find((x: Any) => x.id === id)?.epicId === d.epicId,
            )
          : t.folderId === folder),
    );
  const pool =
    draft && folder === 'picked'
      ? r.tests
          .filter((t: Any) => d.testIds.includes(t.id) || why[t.id])
          .sort((a: Any, b: Any) => (order.get(a.id) ?? 1e6) - (order.get(b.id) ?? 1e6))
      : [...pool0].sort((a: Any, b: Any) => (order.get(a.id) ?? 1e6) - (order.get(b.id) ?? 1e6));
  const toggle = (id: string) =>
    setD({
      ...d,
      testIds: d.testIds.includes(id)
        ? d.testIds.filter((x: string) => x !== id)
        : [...d.testIds, id],
    });
  const save = (thenRun = false) => {
    if (!d.title.trim()) {
      toast('Give the plan a title.', 'err');
      return;
    }
    let saved: Any = null;
    edit((rr, pp) => {
      if (plan) {
        const i = rr.plans.findIndex((x: Any) => x.id === plan.id);
        rr.plans[i] = { ...rr.plans[i], ...d, title: d.title.trim() };
        saved = rr.plans[i];
      } else {
        saved = {
          ...d,
          title: d.title.trim(),
          id: uid(),
          key: nextKey(rr, pp, 'tp'),
          createdAt: nowIso(),
          createdBy: me(),
        };
        rr.plans.push(saved);
      }
    });
    closeModal();
    if (thenRun && saved)
      createExecution({
        title: `${saved.title} — run ${repo().executions.filter((e: Any) => e.planId === saved.id).length + 1}`,
        planId: saved.id,
        testIds: saved.testIds,
      });
    else toast(plan ? `${plan.key} saved` : 'Test plan created');
  };
  return (
    <Modal
      title={plan ? `${plan.key} · ${plan.title}` : 'New test plan'}
      wide
      persistent
      actions={[
        ...(plan && ed
          ? [
              {
                label: 'Delete',
                kind: 'danger' as const,
                onClick: () =>
                  openModal(
                    <Confirm
                      title={`Delete ${plan.key}?`}
                      label="Delete plan"
                      text="The plan is removed. Its executions and their results stay."
                      onYes={() => {
                        edit((rr) => {
                          rr.plans = rr.plans.filter((x: Any) => x.id !== plan.id);
                          rr.executions.forEach((e: Any) => {
                            if (e.planId === plan.id) e.planId = null;
                          });
                        });
                      }}
                    />,
                  ),
              },
            ]
          : []),
        { label: 'Cancel' },
        ...(ed
          ? [
              { label: 'Save', onClick: () => save(false) },
              {
                label: 'Save and run',
                kind: 'primary' as const,
                disabled: !d.testIds.length,
                onClick: () => save(true),
              },
            ]
          : []),
      ]}
    >
      <div className="grid2">
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span>Title</span>
          <TF
            autoFocus={!plan}
            disabled={!ed}
            value={d.title}
            placeholder="e.g. Salary management — release 1.7 regression"
            onChange={(e) => setD({ ...d, title: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Epic (optional)</span>
          <SF
            disabled={!ed}
            value={d.epicId || ''}
            onChange={(e) => setD({ ...d, epicId: e.target.value })}
          >
            <MenuItem value="">None</MenuItem>
            {p.epics.map((e: Any) => (
              <MenuItem key={e.id} value={e.id}>
                {e.key} {e.title}
              </MenuItem>
            ))}
          </SF>
        </label>
        <label className="field">
          <span>Sprint (optional)</span>
          <SF
            disabled={!ed}
            value={d.sprintId || ''}
            onChange={(e) => setD({ ...d, sprintId: e.target.value })}
          >
            <MenuItem value="">None</MenuItem>
            {p.sprints.map((s: Any) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </SF>
        </label>
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span>Description</span>
          <TA
            disabled={!ed}
            rows={2}
            value={d.description || ''}
            onChange={(e) => setD({ ...d, description: e.target.value })}
          />
        </label>
      </div>
      <div className="row split-tools">
        <b className="small">Tests in the plan ({d.testIds.length})</b>
        <span className="spacer" />
        <SF
          filter
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          aria-label="Show tests from"
        >
          {draft && <MenuItem value="picked">Picked by the AI ({draft.tests.length})</MenuItem>}
          <MenuItem value="all">All tests</MenuItem>
          {d.epicId && <MenuItem value="epic">Tests covering the epic’s issues</MenuItem>}
          {r.folders.map((f: Any) => (
            <MenuItem key={f.id} value={f.id}>
              {f.name}
            </MenuItem>
          ))}
        </SF>
        {ed && (
          <button
            className="btn sm subtle"
            onClick={() =>
              setD({ ...d, testIds: [...new Set([...d.testIds, ...pool.map((t: Any) => t.id)])] })
            }
          >
            Add all shown ({pool.length})
          </button>
        )}
      </div>
      <div className="split-list">
        {pool.map((t: Any) => (
          <label key={t.id} className={`split-row ${d.testIds.includes(t.id) ? '' : 'off'}`}>
            <CB
              disabled={!ed}
              checked={d.testIds.includes(t.id)}
              onChange={() => toggle(t.id)}
              aria-label={`Include ${t.key}`}
            />
            <span className="key">{t.key}</span>
            <span className="split-title">
              {t.title}
              {why[t.id] && <span className="xr-why">{why[t.id]}</span>}
            </span>
            <RunLoz s={plan ? latestPlanStatus(plan, t.id) : latestStatus(t.id)} />
          </label>
        ))}
        {!pool.length && (
          <p className="muted small" style={{ padding: 10 }}>
            No tests here.
          </p>
        )}
      </div>
      {draft?.gaps?.length > 0 && (
        <div className="xr-gaps">
          <b className="small">Gaps: issues in scope that no test covers ({draft.gaps.length})</b>
          <ul className="small">
            {draft.gaps.map((g: Any) => (
              <li key={g.id}>
                <button className="link-btn key" onClick={() => openDrawer('issue', g.id)}>
                  {g.key}
                </button>{' '}
                {g.title} <span className="muted">— {g.why}</span>
                {canEdit() && (
                  <>
                    {' '}
                    <button className="link-btn small" onClick={() => openTest(null, null, g.id)}>
                      Write a test
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
// ---------------------------------------------------------------- build a plan with AI
export const PLAN_KINDS: [string, string, string][] = [
  ['smoke', 'Smoke', 'The few tests that prove the main flows still work.'],
  ['regression', 'Regression', 'Broad coverage of the scope, riskiest first.'],
  ['feature', 'Feature / epic', 'Everything that proves the chosen epics work.'],
  ['sprint', 'Sprint', 'Tests for the issues in a sprint.'],
  ['retest', 'Retest failures', 'What failed or was blocked last time, and its neighbours.'],
  ['custom', 'Custom', 'Describe the goal yourself.'],
];
