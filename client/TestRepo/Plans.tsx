'use client';
import { P, can, openModal, type Any } from '../core';
import { EmptyState, I, Ico } from '../ui';
import { repo } from './run-status';
import { canEdit, counts, StatusBar } from './TestManagement';
import { AiPlanModal } from './open-execution';
import { PlanModal } from './PlanModal';

// ---------------------------------------------------------------- plans
export function Plans() {
  const p = P();
  const r = repo(p);
  if (!r.plans.length)
    return (
      <EmptyState
        icon={I.epic}
        tone="neutral"
        title="No test plans yet"
        actions={
          canEdit() && (
            <>
              {can('ai.use') && r.tests.length > 0 && (
                <button className="btn ai" onClick={() => openModal(<AiPlanModal />)}>
                  <Ico svg={I.sparkle} />
                  Build plan with AI
                </button>
              )}
              <button className="btn primary" onClick={() => openModal(<PlanModal plan={null} />)}>
                <Ico svg={I.plus} />
                New test plan
              </button>
            </>
          )
        }
      >
        <p>
          A test plan groups the tests for a goal (an epic, a sprint, a release) and shows how far
          its executions got.
        </p>
      </EmptyState>
    );
  return (
    <div className="xr-cards">
      {r.plans.map((pl: Any) => {
        const st = pl.testIds.map((id: string) => latestPlanStatus(pl, id));
        const c = counts(st);
        const ex = r.executions.filter((e: Any) => e.planId === pl.id);
        const epic = p.epics.find((e: Any) => e.id === pl.epicId);
        return (
          <div
            key={pl.id}
            className="xr-card"
            role="button"
            tabIndex={0}
            onClick={() => openModal(<PlanModal plan={pl} />)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') openModal(<PlanModal plan={pl} />);
            }}
          >
            <div className="xr-card-h">
              <span className="key">{pl.key}</span>
              <b>{pl.title}</b>
            </div>
            <div className="muted small">
              {pl.testIds.length} tests · {ex.length} execution{ex.length === 1 ? '' : 's'}
              {epic ? ` · ${epic.key} ${epic.title}` : ''}
            </div>
            <StatusBar statuses={st} />
            <div className="small">
              {c.PASSED} passed · {c.FAILED} failed · {c.BLOCKED} blocked · {c.TODO + c.EXECUTING}{' '}
              to do
            </div>
          </div>
        );
      })}
    </div>
  );
}
/** A test's latest result within a plan's executions. */
export function latestPlanStatus(pl: Any, testId: string) {
  const runs = repo()
    .executions.filter(
      (e: Any) => e.planId === pl.id && e.runs?.[testId] && e.runs[testId].status !== 'TODO',
    )
    .sort((a: Any, b: Any) =>
      String(b.runs[testId].at || b.createdAt).localeCompare(
        String(a.runs[testId].at || a.createdAt),
      ),
    );
  return runs[0]?.runs[testId].status || 'TODO';
}
