'use client';
import { useState } from 'react';
import {
  P,
  startTask,
  api,
  aiBody,
  openModal,
  toast,
  type Any,
  uid,
  me,
  nowIso,
  S,
  emit,
  closeModal,
} from '../core';
import { Modal, EmptyState, I, Ico } from '../ui';
import { SF, MenuItem, TA, TF } from '../fields';
import { PLAN_KINDS, PlanModal } from './PlanModal';
import { repo, edit } from './run-status';
import { plannable, nextKey, environmentsOf, canEdit, counts, StatusBar } from './TestManagement';
import { ExecutionModal } from './ExecutionModal';

export function AiPlanModal() {
  const p = P();
  const [kind, setKind] = useState('regression');
  const [epicIds, setEpicIds] = useState<string[]>([]);
  const [sprintId, setSprintId] = useState('');
  const [goal, setGoal] = useState('');
  const [max, setMax] = useState(30);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const task = startTask('Building a test plan with AI', {
      detail: PLAN_KINDS.find(([k]) => k === kind)?.[1],
      kind: 'ai',
    });
    try {
      const out = await api(`/api/projects/${p.id}/testplan`, {
        method: 'POST',
        body: aiBody({ kind, goal, epicIds, sprintId, maxTests: max }),
      });
      task.finish(`${out.tests.length} tests picked`);
      openModal(
        <PlanModal
          plan={null}
          draft={{ ...out, epicId: epicIds.length === 1 ? epicIds[0] : '', sprintId }}
        />,
      );
      toast(
        `The AI picked ${out.tests.length} of ${out.considered} tests${out.gaps.length ? ` and found ${out.gaps.length} gap${out.gaps.length > 1 ? 's' : ''}` : ''}. Review, then save.`,
        'ok',
        { title: 'Plan drafted' },
      );
    } catch (e: Any) {
      task.fail(`Couldn’t build the plan: ${e.message}`);
      setBusy(false);
    }
  };
  const blocked =
    (kind === 'custom' && !goal.trim()) ||
    (kind === 'sprint' && !sprintId) ||
    (kind === 'feature' && !epicIds.length);
  return (
    <Modal
      title="Build a test plan with AI"
      wide
      actions={[
        { label: 'Cancel' },
        {
          label: busy ? 'Building…' : 'Build plan',
          kind: 'ai',
          disabled: busy || blocked,
          onClick: go,
        },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        The AI reads your {repo(p).tests.length} tests: what they check, their priority, the issues
        they cover and those issues’ status, and their latest results. It picks the ones that fit,
        riskiest first, says why for each, and lists issues in scope that no test covers. You review
        it in the plan editor before anything is saved.
      </p>
      <div className="upd-modes" role="radiogroup" aria-label="Kind of plan">
        {PLAN_KINDS.map(([k, l, dsc]) => (
          <button
            key={k}
            role="radio"
            aria-checked={kind === k}
            className={kind === k ? 'on' : ''}
            onClick={() => setKind(k)}
          >
            <b>{l}</b>
            <span className="muted small">{dsc}</span>
          </button>
        ))}
      </div>
      <div className="grid2" style={{ marginTop: 12 }}>
        <label className="field">
          <span>Epics{kind === 'feature' ? '' : ' (optional)'}</span>
          <SF
            value={epicIds}
            multiple
            displayEmpty
            renderValue={(v: Any) =>
              v.length
                ? v.map((id: string) => p.epics.find((e: Any) => e.id === id)?.key).join(', ')
                : 'All epics'
            }
            onChange={(e: Any) =>
              setEpicIds(
                typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value,
              )
            }
          >
            {p.epics.map((e: Any) => (
              <MenuItem key={e.id} value={e.id}>
                {e.key} {e.title}
              </MenuItem>
            ))}
          </SF>
        </label>
        <label className="field">
          <span>Sprint{kind === 'sprint' ? '' : ' (optional)'}</span>
          <SF value={sprintId} displayEmpty onChange={(e) => setSprintId(e.target.value)}>
            <MenuItem value="">Any sprint</MenuItem>
            {(p.sprints || []).map((sp: Any) => (
              <MenuItem key={sp.id} value={sp.id}>
                {sp.name}
                {sp.state === 'active' ? ' (active)' : ''}
              </MenuItem>
            ))}
          </SF>
        </label>
        <label className="field">
          <span>At most</span>
          <SF value={max} onChange={(e) => setMax(Number(e.target.value))}>
            {[10, 20, 30, 50, 80, 120].map((n) => (
              <MenuItem key={n} value={n}>
                {n} tests
              </MenuItem>
            ))}
          </SF>
        </label>
      </div>
      <label className="field">
        <span>{kind === 'custom' ? 'Goal' : 'Anything else (optional)'}</span>
        <TA
          rows={2}
          value={goal}
          placeholder={
            kind === 'custom'
              ? 'e.g. Everything a payroll officer touches on cutoff day, before the 1.7 release'
              : 'e.g. Focus on approval rules and permissions; skip UI-only checks'
          }
          onChange={(e) => setGoal(e.target.value)}
        />
      </label>
    </Modal>
  );
}
// ---------------------------------------------------------------- executions
export function createExecution({
  title,
  planId,
  testIds,
  environment = '',
}: {
  title: string;
  planId: string | null;
  testIds: string[];
  environment?: string;
}) {
  let created: Any = null;
  edit((rr, pp) => {
    testIds = testIds.filter((id) => {
      const t = rr.tests.find((x: Any) => x.id === id);
      return t && plannable(t, pp);
    });
    created = {
      id: uid(),
      key: nextKey(rr, pp, 'te'),
      title,
      planId,
      testIds: [...testIds],
      environment,
      assignee: me(),
      runs: Object.fromEntries(
        testIds.map((id) => [
          id,
          {
            status: 'TODO',
            version: rr.tests.find((x: Any) => x.id === id)?.version || 1,
            steps: {},
            comment: '',
            defectIds: [],
          },
        ]),
      ),
      createdAt: nowIso(),
      createdBy: me(),
    };
    rr.executions.push(created);
  });
  S.trTab = 'executions';
  emit();
  if (created) openExecution(created.id);
}
export function NewExecutionModal() {
  const r = repo();
  const [planId, setPlanId] = useState(r.plans[0]?.id || '');
  const [title, setTitle] = useState('');
  const [env, setEnv] = useState('');
  const pl = r.plans.find((x: Any) => x.id === planId);
  const ids = pl ? pl.testIds : r.tests.map((t: Any) => t.id);
  return (
    <Modal
      title="New test execution"
      actions={[
        { label: 'Cancel' },
        {
          label: `Start with ${ids.length} test${ids.length === 1 ? '' : 's'}`,
          kind: 'primary',
          disabled: !ids.length,
          onClick: () => {
            closeModal();
            createExecution({
              title:
                title.trim() ||
                `${pl ? pl.title : 'All tests'} — ${new Date().toLocaleDateString()}`,
              planId: pl?.id || null,
              testIds: ids,
              environment: env.trim(),
            });
          },
        },
      ]}
    >
      <label className="field">
        <span>From</span>
        <SF value={planId} onChange={(e) => setPlanId(e.target.value)}>
          {r.plans.map((x: Any) => (
            <MenuItem key={x.id} value={x.id}>
              {x.key} {x.title} ({x.testIds.length})
            </MenuItem>
          ))}
          <MenuItem value="">All tests in the repository ({r.tests.length})</MenuItem>
        </SF>
      </label>
      <label className="field">
        <span>Title (optional)</span>
        <TF
          value={title}
          placeholder={`${pl ? pl.title : 'All tests'} — ${new Date().toLocaleDateString()}`}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Test environment (optional)</span>
        <TF
          value={env}
          placeholder="e.g. staging, production, Chrome"
          onChange={(e) => setEnv(e.target.value)}
        />
        {environmentsOf().length > 0 && (
          <div className="row" style={{ gap: 4, marginTop: 4 }}>
            {environmentsOf().map((x) => (
              <button
                key={x}
                type="button"
                className={`chip-btn ${env === x ? 'on' : ''}`}
                onClick={() => setEnv(x)}
              >
                {x}
              </button>
            ))}
          </div>
        )}
        <small className="muted">
          Results are also tracked per environment (Coverage → environment).
        </small>
      </label>
    </Modal>
  );
}
export function Executions() {
  const r = repo();
  if (!r.executions.length)
    return (
      <EmptyState
        icon={I.play}
        tone="neutral"
        title="No test executions yet"
        actions={
          canEdit() &&
          r.tests.length > 0 && (
            <button className="btn primary" onClick={() => openModal(<NewExecutionModal />)}>
              <Ico svg={I.plus} />
              New execution
            </button>
          )
        }
      >
        <p>
          An execution runs a set of tests (usually a plan’s) and records each one as Passed, Failed
          or Blocked, step by step, with defects.
        </p>
      </EmptyState>
    );
  const list = [...r.executions].sort((a: Any, b: Any) =>
    String(b.createdAt).localeCompare(String(a.createdAt)),
  );
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Key</th>
          <th>Execution</th>
          <th>Plan</th>
          <th>Environment</th>
          <th>Progress</th>
          <th>Results</th>
          <th>By</th>
        </tr>
      </thead>
      <tbody>
        {list.map((e: Any) => {
          const st = e.testIds.map((id: string) => e.runs?.[id]?.status || 'TODO');
          const c = counts(st);
          const pl = r.plans.find((x: Any) => x.id === e.planId);
          return (
            <tr key={e.id} className="click" onClick={() => openExecution(e.id)}>
              <td className="key">{e.key}</td>
              <td>{e.title}</td>
              <td className="muted">{pl ? pl.key : '—'}</td>
              <td className="muted">{e.environment || '—'}</td>
              <td style={{ width: 180 }}>
                <StatusBar statuses={st} />
              </td>
              <td className="small">
                {c.PASSED} ✓ · {c.FAILED} ✗ · {c.BLOCKED} ⦸ · {c.TODO + c.EXECUTING} to do
              </td>
              <td className="muted small">{e.assignee || e.createdBy}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
export const openExecution = (id: string, testId?: string) =>
  openModal(<ExecutionModal id={id} startAt={testId} />);
