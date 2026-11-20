'use client';
import { type Any, can, P, nowIso, me, S, emit, isSub, openModal } from '../core';
import { I, Ico } from '../ui';
import { Header } from '../views';
import { repo, edit, STATUS_LABEL, RUN_STATUS } from './run-status';
import { openTest, WorkflowModal, Reviews } from './open-test';
import { AiPlanModal, NewExecutionModal, Executions } from './open-execution';
import { PlanModal } from './PlanModal';
import { Repository } from './Repository';
import { Plans } from './Plans';
import { Coverage } from './TestsSection';

export const nextKey = (r: Any, p: Any, kind: 't' | 'tp' | 'te') => {
  r.seq[kind] = (r.seq[kind] || 0) + 1;
  return `${p.key}-${kind.toUpperCase()}${r.seq[kind]}`;
};
export const canEdit = () => can('test.run') || can('issue.edit');
// ---------------------------------------------------------------- review workflow (Xray /
// BrowserStack style) Draft → Ready for review → Approved (or Needs update) · Deprecated. Editing
// an Approved test makes a new version (the old one is kept) and sends it back to Draft. Settings
// (Test management → Workflow): only Approved tests in plans and executions; the approver must not
// be the person who last changed the test.
export const WF = ['Draft', 'Ready for review', 'Approved', 'Needs update', 'Deprecated'];
export const WF_CLS: Record<string, string> = {
  Draft: 'wf-draft',
  'Ready for review': 'wf-review',
  Approved: 'wf-approved',
  'Needs update': 'wf-changes',
  Deprecated: 'wf-deprecated',
};
/** Tests from before the workflow existed count as Approved. */
export const wfOf = (t: Any) => (WF.includes(t?.status) ? t.status : 'Approved');
export const WfLoz = ({ t }: { t: Any }) => (
  <span className={`wf-loz ${WF_CLS[wfOf(t)]}`}>{wfOf(t)}</span>
);
export const wfSettings = (p: Any = P()) => ({
  requireApproval: false,
  fourEyes: true,
  ...(repo(p).settings || {}),
});
export const canReview = () => can('issue.edit');
/** Tests that may go into plans and executions under the current settings. */
export const plannable = (t: Any, p: Any = P()) =>
  wfOf(t) !== 'Deprecated' && (!wfSettings(p).requireApproval || wfOf(t) === 'Approved');
export const CONTENT = ['title', 'type', 'preconditions', 'steps', 'gherkin'];
export const snapshot = (t: Any) => ({
  version: t.version || 1,
  at: t.updatedAt || t.createdAt || nowIso(),
  by: t.updatedBy || t.createdBy || null,
  title: t.title,
  type: t.type,
  preconditions: t.preconditions || '',
  steps: (t.steps || []).map((s: Any) => ({ ...s })),
  gherkin: t.gherkin || '',
  status: wfOf(t),
});
/**
 * Workflow actions: submit · approve · changes · deprecate · restore. Returns an error message when
 * not allowed.
 */
export function wfAction(testId: string, action: string, comment = ''): string | null {
  const p = P();
  const t0 = repo(p).tests.find((x: Any) => x.id === testId);
  if (!t0) return 'That test is gone.';
  const st = wfOf(t0);
  if ((action === 'approve' || action === 'changes') && !canReview())
    return 'Approving tests needs the Edit issues permission.';
  if (
    action === 'approve' &&
    wfSettings(p).fourEyes &&
    (t0.updatedBy || t0.createdBy) === me() &&
    !S.user?.isOwner
  )
    return 'Someone other than the last editor must approve it (four-eyes rule in Test management → Workflow).';
  if (action === 'changes' && !comment.trim()) return 'Say what needs to change.';
  const next: Record<string, string> = {
    submit: 'Ready for review',
    approve: 'Approved',
    changes: 'Needs update',
    deprecate: 'Deprecated',
    restore: 'Draft',
  };
  const allowed: Record<string, string[]> = {
    submit: ['Draft', 'Needs update'],
    approve: ['Ready for review', 'Draft', 'Needs update'],
    changes: ['Ready for review'],
    deprecate: ['Draft', 'Ready for review', 'Approved', 'Needs update'],
    restore: ['Deprecated'],
  };
  if (!allowed[action]?.includes(st))
    return `A test that is ${st} can’t be ${action === 'changes' ? 'sent back' : action === 'submit' ? 'submitted' : `${action}d`}.`;
  edit((rr) => {
    const t = rr.tests.find((x: Any) => x.id === testId);
    t.status = next[action];
    t.reviews = [
      ...(t.reviews || []),
      {
        at: nowIso(),
        by: me(),
        action,
        from: st,
        to: next[action],
        comment: comment.trim().slice(0, 1000),
        version: t.version || 1,
      },
    ];
    if (action === 'approve') {
      t.approvedBy = me();
      t.approvedAt = nowIso();
    }
  });
  return null;
}
/** A test's latest result across executions: the newest run that isn't To do. */
export function latestRun(testId: string, p: Any = P(), env = ''): Any | null {
  const runs = repo(p)
    .executions.filter((e: Any) => !env || (e.environment || '') === env)
    .map((e: Any) => ({ e, run: e.runs?.[testId] }))
    .filter((x: Any) => x.run && x.run.status !== 'TODO')
    .sort((a: Any, b: Any) =>
      String(b.run.at || b.e.createdAt).localeCompare(String(a.run.at || a.e.createdAt)),
    );
  return runs[0] ? { ...runs[0].run, execution: runs[0].e } : null;
}
export const latestStatus = (testId: string, p?: Any, env = '') =>
  latestRun(testId, p, env)?.status || 'TODO';
/**
 * The environments executions ran in (staging, production, Chrome…), for per-environment status.
 */
export const environmentsOf = (p: Any = P()) =>
  [
    ...new Set(
      repo(p)
        .executions.map((e: Any) => String(e.environment || '').trim())
        .filter(Boolean),
    ),
  ].sort() as string[];
/** Xray coverage of an issue from its linked tests, optionally in one environment. */
export function coverageOf(ticketId: string, p: Any = P(), env = '') {
  const tests = repo(p).tests.filter((t: Any) => t.issueIds?.includes(ticketId));
  if (!tests.length) return { status: 'UNCOVERED', tests };
  const st = tests.map((t: Any) => latestStatus(t.id, p, env));
  return {
    status: st.includes('FAILED')
      ? 'NOK'
      : st.includes('BLOCKED')
        ? 'NOK'
        : st.every((x: string) => x === 'PASSED')
          ? 'OK'
          : 'NOTRUN',
    tests,
  };
}
export const COV_LABEL: Record<string, string> = {
  OK: 'OK',
  NOK: 'NOK',
  NOTRUN: 'Not run',
  UNCOVERED: 'Uncovered',
};
export const RunLoz = ({ s }: { s: string }) => (
  <span className={`xr-st xr-${String(s).toLowerCase()}`}>{STATUS_LABEL[s] || s}</span>
);
export const CovLoz = ({ s }: { s: string }) => (
  <span className={`xr-cov xr-cov-${s.toLowerCase()}`}>{COV_LABEL[s]}</span>
);
export function counts(statuses: string[]) {
  const c: Record<string, number> = { PASSED: 0, FAILED: 0, BLOCKED: 0, EXECUTING: 0, TODO: 0 };
  for (const s of statuses) c[s] = (c[s] || 0) + 1;
  return c;
}
/** A stacked bar of run statuses. */
export function StatusBar({ statuses }: { statuses: string[] }) {
  const c = counts(statuses);
  const n = statuses.length || 1;
  return (
    <span
      className="xr-bar"
      title={RUN_STATUS.map((s) => `${STATUS_LABEL[s]}: ${c[s] || 0}`).join(' · ')}
    >
      {(['PASSED', 'FAILED', 'BLOCKED', 'EXECUTING', 'TODO'] as const).map((s) =>
        c[s] ? (
          <i
            key={s}
            className={`xr-${s.toLowerCase()}`}
            style={{ width: `${(c[s] / n) * 100}%` }}
          />
        ) : null,
      )}
    </span>
  );
}
export const runStatusFromSteps = (steps: Record<string, string>, total: number) => {
  const v = Object.values(steps || {});
  if (v.includes('FAILED')) return 'FAILED';
  if (v.includes('BLOCKED')) return 'BLOCKED';
  if (total && v.filter((x) => x === 'PASSED').length === total) return 'PASSED';
  return v.some((x) => x && x !== 'TODO') ? 'EXECUTING' : 'TODO';
};
// ---------------------------------------------------------------- page
const TABS: [string, string, string][] = [
  ['repository', 'Test repository', I.folder],
  ['reviews', 'Reviews', I.check],
  ['plans', 'Test plans', I.epic],
  ['executions', 'Test executions', I.play],
  ['coverage', 'Coverage', I.check],
];
export function TestManagement() {
  const p = P();
  const r = repo(p);
  const tab = TABS.some(([k]) => k === S.trTab) ? S.trTab : 'repository';
  const setTab = (k: string) => {
    S.trTab = k;
    emit();
  };
  const allSt = r.tests.map((t: Any) => latestStatus(t.id));
  const c = counts(allSt);
  const issues = p.tickets.filter((t: Any) => !isSub(t));
  const covered = issues.filter((t: Any) =>
    r.tests.some((x: Any) => x.issueIds?.includes(t.id)),
  ).length;
  return (
    <>
      <Header
        title="Test management"
        sub={
          <span className="muted small">
            Reusable tests, plans and executions, linked to your issues
          </span>
        }
        right={
          canEdit() && (
            <>
              {tab === 'repository' && (
                <button className="btn primary" onClick={() => openTest(null)}>
                  <Ico svg={I.plus} />
                  New test
                </button>
              )}
              {tab === 'plans' && can('ai.use') && (
                <button
                  className="btn ai"
                  disabled={!repo(p).tests.length}
                  title={
                    repo(p).tests.length
                      ? 'The AI picks the tests for a goal from the repository'
                      : 'Add or import tests first'
                  }
                  onClick={() => openModal(<AiPlanModal />)}
                >
                  <Ico svg={I.sparkle} />
                  Build plan with AI
                </button>
              )}
              {tab === 'plans' && (
                <button
                  className="btn primary"
                  onClick={() => openModal(<PlanModal plan={null} />)}
                >
                  <Ico svg={I.plus} />
                  New test plan
                </button>
              )}
              {tab === 'executions' && (
                <button className="btn primary" onClick={() => openModal(<NewExecutionModal />)}>
                  <Ico svg={I.plus} />
                  New execution
                </button>
              )}
              {can('project.settings') && (
                <button
                  className="btn subtle"
                  onClick={() => openModal(<WorkflowModal />)}
                  title="Review workflow rules"
                >
                  <Ico svg={I.settings} />
                  Workflow
                </button>
              )}
            </>
          )
        }
      />
      <div className="tiles">
        <div className="tile">
          <span className="ic">
            <Ico svg={I.test} />
          </span>
          <div>
            <b>{r.tests.length}</b>
            <span>
              tests in {r.folders.length} folder{r.folders.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <div className="tile">
          <span className="ic" style={{ color: '#22a06b' }}>
            <Ico svg={I.check} />
          </span>
          <div>
            <b>{c.PASSED}</b>
            <span>
              passing · {c.FAILED} failing · {c.BLOCKED} blocked
            </span>
          </div>
        </div>
        <div className="tile">
          <span className="ic">
            <Ico svg={I.play} />
          </span>
          <div>
            <b>{r.executions.length}</b>
            <span>
              executions in {r.plans.length} plan{r.plans.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <div className="tile">
          <span className="ic">
            <Ico svg={I.backlog} />
          </span>
          <div>
            <b>{issues.length ? Math.round((covered / issues.length) * 100) : 0}%</b>
            <span>
              issues covered ({covered} of {issues.length})
            </span>
          </div>
        </div>
      </div>
      <div className="tabbar auto-tabs" role="tablist" aria-label="Test management">
        {TABS.map(([k, l, icon]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`tab ${tab === k ? 'active' : ''}`}
            onClick={() => setTab(k)}
          >
            <Ico svg={icon} />
            {l}
            {k === 'reviews' &&
              r.tests.filter((t: Any) => wfOf(t) === 'Ready for review').length > 0 && (
                <span className="count bad">
                  {r.tests.filter((t: Any) => wfOf(t) === 'Ready for review').length}
                </span>
              )}
          </button>
        ))}
      </div>
      {tab === 'repository' && <Repository />}
      {tab === 'reviews' && <Reviews />}
      {tab === 'plans' && <Plans />}
      {tab === 'executions' && <Executions />}
      {tab === 'coverage' && <Coverage />}
    </>
  );
}
