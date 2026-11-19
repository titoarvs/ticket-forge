'use client';
// Test management, in the style of Xray for Jira. Saved on the project as `testRepo`:
//   Tests reusable test definitions (steps: action / data / expected), in folders, linked to any
//   number of issues Test Plans sets of tests for a goal (an epic, a sprint, a release), with
//   progress Executions runs of tests: each test and each step Passed / Failed / Blocked, with
//   comments, evidence and defects Coverage per issue: OK (all its tests pass), NOK (one fails),
//   Not run, Uncovered
// Issues show their tests in the issue panel (TestsSection). Existing test cases on issues can be
// imported.
import { useState, type ReactNode } from 'react';
import {
  S,
  P,
  api,
  aiBody,
  startTask,
  readNdjson,
  emit,
  useStore,
  peopleNames,
  mutate,
  toast,
  openModal,
  closeModal,
  can,
  uid,
  nowIso,
  me,
  newTicket,
  addLink,
  logEvent,
  isSub,
  ago,
  type Any,
} from './core';
import { Ico, I, Modal, Confirm, TypeIcon, StatusLoz, EmptyState } from './ui';
import { TF, TA, SF, CB, MenuItem } from './fields';
import { Header } from './views';
import { openDrawer } from './actions';

// ---------------------------------------------------------------- model
export const RUN_STATUS = ['TODO', 'EXECUTING', 'PASSED', 'FAILED', 'BLOCKED'] as const;
const STATUS_LABEL: Record<string, string> = {
  TODO: 'To do',
  EXECUTING: 'Executing',
  PASSED: 'Passed',
  FAILED: 'Failed',
  BLOCKED: 'Blocked',
};
const TEST_TYPES = ['Manual', 'Automated', 'Cucumber', 'Exploratory'];
export const repo = (p: Any = P()) =>
  p.testRepo || { seq: { t: 0, tp: 0, te: 0 }, folders: [], tests: [], plans: [], executions: [] };
/** Changes the repository inside one undo step and save. */
const edit = (fn: (r: Any, p: Any) => void, tag?: string) =>
  mutate(
    (pp: Any) => {
      pp.testRepo = {
        seq: { t: 0, tp: 0, te: 0 },
        folders: [],
        tests: [],
        plans: [],
        executions: [],
        ...(pp.testRepo || {}),
      };
      pp.testRepo.seq = { t: 0, tp: 0, te: 0, ...(pp.testRepo.seq || {}) };
      fn(pp.testRepo, pp);
    },
    tag ? { tag } : undefined,
  );
const nextKey = (r: Any, p: Any, kind: 't' | 'tp' | 'te') => {
  r.seq[kind] = (r.seq[kind] || 0) + 1;
  return `${p.key}-${kind.toUpperCase()}${r.seq[kind]}`;
};
const canEdit = () => can('test.run') || can('issue.edit');

// ---------------------------------------------------------------- review workflow (Xray /
// BrowserStack style) Draft → Ready for review → Approved (or Needs update) · Deprecated. Editing
// an Approved test makes a new version (the old one is kept) and sends it back to Draft. Settings
// (Test management → Workflow): only Approved tests in plans and executions; the approver must not
// be the person who last changed the test.
export const WF = ['Draft', 'Ready for review', 'Approved', 'Needs update', 'Deprecated'];
const WF_CLS: Record<string, string> = {
  Draft: 'wf-draft',
  'Ready for review': 'wf-review',
  Approved: 'wf-approved',
  'Needs update': 'wf-changes',
  Deprecated: 'wf-deprecated',
};
/** Tests from before the workflow existed count as Approved. */
const wfOf = (t: Any) => (WF.includes(t?.status) ? t.status : 'Approved');
export const WfLoz = ({ t }: { t: Any }) => (
  <span className={`wf-loz ${WF_CLS[wfOf(t)]}`}>{wfOf(t)}</span>
);
const wfSettings = (p: Any = P()) => ({
  requireApproval: false,
  fourEyes: true,
  ...(repo(p).settings || {}),
});
const canReview = () => can('issue.edit');
/** Tests that may go into plans and executions under the current settings. */
const plannable = (t: Any, p: Any = P()) =>
  wfOf(t) !== 'Deprecated' && (!wfSettings(p).requireApproval || wfOf(t) === 'Approved');
const CONTENT = ['title', 'type', 'preconditions', 'steps', 'gherkin'];
const snapshot = (t: Any) => ({
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
const latestStatus = (testId: string, p?: Any, env = '') =>
  latestRun(testId, p, env)?.status || 'TODO';
/**
 * The environments executions ran in (staging, production, Chrome…), for per-environment status.
 */
const environmentsOf = (p: Any = P()) =>
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
const COV_LABEL: Record<string, string> = {
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
function counts(statuses: string[]) {
  const c: Record<string, number> = { PASSED: 0, FAILED: 0, BLOCKED: 0, EXECUTING: 0, TODO: 0 };
  for (const s of statuses) c[s] = (c[s] || 0) + 1;
  return c;
}
/** A stacked bar of run statuses. */
function StatusBar({ statuses }: { statuses: string[] }) {
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
const runStatusFromSteps = (steps: Record<string, string>, total: number) => {
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

// ---------------------------------------------------------------- repository
function Repository() {
  const p = P();
  const r = repo(p);
  const [folder, setFolder] = useState<string>('all');
  const [q, setQ] = useState('');
  const [newFolder, setNewFolder] = useState<string | null>(null);
  // Epics view (default): the tree follows the backlog — epic → its issues — from the issues each
  // test covers.
  const [mode, setModeState] = useState<string>(() => {
    try {
      return localStorage.getItem('tf.repoMode') || 'epics';
    } catch {
      return 'epics';
    }
  });
  const setMode = (m: string) => {
    setModeState(m);
    setFolder('all');
    try {
      localStorage.setItem('tf.repoMode', m);
    } catch {
      /* private mode */
    }
  };
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const issueOf = (id: string) => p.tickets.find((x: Any) => x.id === id);
  const epicsOf = (t: Any) => {
    const ids = new Set((t.issueIds || []).map((id: string) => issueOf(id)?.epicId || 'none'));
    if (!ids.size) ids.add('none');
    return ids;
  };
  const inFolder = (t: Any) => {
    if (folder === 'all') return true;
    if (mode === 'epics') {
      if (folder.startsWith('epic:')) return epicsOf(t).has(folder.slice(5));
      if (folder.startsWith('issue:')) return (t.issueIds || []).includes(folder.slice(6));
      if (folder === 'unlinked') return !(t.issueIds || []).length;
      return true;
    }
    return folder === 'none' ? !t.folderId : t.folderId === folder;
  };
  const [wf, setWf] = useState('');
  const list = r.tests
    .filter(inFolder)
    .filter((t: Any) => (!wf ? wfOf(t) !== 'Deprecated' : wf === 'all' || wfOf(t) === wf))
    .filter(
      (t: Any) =>
        !q.trim() ||
        `${t.key} ${t.title} ${t.labels?.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()),
    );
  const tree = (parentId: string | null, depth: number): ReactNode =>
    r.folders
      .filter((f: Any) => (f.parentId || null) === parentId)
      .map((f: Any) => (
        <div key={f.id}>
          <button
            className={`xr-folder ${folder === f.id ? 'on' : ''}`}
            style={{ paddingLeft: 10 + depth * 14 }}
            title={f.name}
            onClick={() => setFolder(f.id)}
          >
            <Ico svg={I.folder} />
            <span>{f.name}</span>
            <span className="count">{r.tests.filter((t: Any) => t.folderId === f.id).length}</span>
          </button>
          {tree(f.id, depth + 1)}
        </div>
      ));
  const addFolder = () => {
    const name = String(newFolder || '').trim();
    if (!name) {
      setNewFolder(null);
      return;
    }
    const parentId = folder !== 'all' && folder !== 'none' ? folder : null;
    edit((rr) => {
      rr.folders.push({ id: uid(), name, parentId });
    });
    setNewFolder(null);
  };
  const cur = mode === 'folders' ? r.folders.find((f: Any) => f.id === folder) : null;
  const selIssue = folder.startsWith('issue:') ? issueOf(folder.slice(6)) : null;
  const epicTree = () => {
    const rows = [
      ...p.epics.map((e: Any) => ({ id: e.id, label: `${e.key} ${e.title}`, color: e.color })),
      { id: 'none', label: 'No epic', color: '' },
    ]
      .map((e: Any) => ({
        ...e,
        tests: r.tests.filter((t: Any) => (t.issueIds || []).length && epicsOf(t).has(e.id)),
      }))
      .filter((e: Any) => e.tests.length);
    return rows.map((e: Any) => {
      const issues = p.tickets.filter(
        (x: Any) =>
          (e.id === 'none' ? !x.epicId : x.epicId === e.id) &&
          r.tests.some((t: Any) => t.issueIds?.includes(x.id)),
      );
      const isOpen = open[e.id] ?? folder === `epic:${e.id}`;
      return (
        <div key={e.id}>
          <div className="xr-epicrow">
            <button
              className="xr-caret"
              aria-label={isOpen ? 'Collapse' : 'Expand'}
              aria-expanded={isOpen}
              onClick={() => setOpen({ ...open, [e.id]: !isOpen })}
            >
              <Ico svg={I.chevron} className={isOpen ? '' : 'closed'} />
            </button>
            <button
              className={`xr-folder ${folder === `epic:${e.id}` ? 'on' : ''}`}
              title={e.label}
              onClick={() => {
                setFolder(`epic:${e.id}`);
                setOpen({ ...open, [e.id]: true });
              }}
            >
              {e.color ? (
                <span className="xr-swatch" style={{ background: e.color }} />
              ) : (
                <Ico svg={I.epic} />
              )}
              <span>{e.label}</span>
              <span className="count">{e.tests.length}</span>
            </button>
          </div>
          {isOpen &&
            issues.map((x: Any) => (
              <button
                key={x.id}
                className={`xr-folder xr-issuerow ${folder === `issue:${x.id}` ? 'on' : ''}`}
                title={`${x.key} ${x.title}`}
                onClick={() => setFolder(`issue:${x.id}`)}
              >
                <TypeIcon type={x.type} />
                <span>
                  <b className="key">{x.key}</b> {x.title}
                </span>
                <span className="count">
                  {r.tests.filter((t: Any) => t.issueIds?.includes(x.id)).length}
                </span>
              </button>
            ))}
        </div>
      );
    });
  };
  /**
   * Rebuilds the folders to match the epics: one folder per epic, each test in the folder of its
   * (first) issue's epic.
   */
  const sortIntoEpicFolders = () =>
    openModal(
      <Confirm
        title="Sort tests into epic folders?"
        label="Sort into epic folders"
        text="Each test moves to a folder named after its epic (created when missing). Tests with no issue or no epic go to “No epic”. Other folders stay, possibly empty."
        onYes={() => {
          let moved = 0;
          edit((rr, pp) => {
            const folderFor = (name: string) => {
              let f = rr.folders.find((x: Any) => x.name === name && !x.parentId);
              if (!f) {
                f = { id: uid(), name, parentId: null };
                rr.folders.push(f);
              }
              return f.id;
            };
            for (const t of rr.tests) {
              const ep = pp.epics.find(
                (e: Any) =>
                  e.id === pp.tickets.find((x: Any) => x.id === (t.issueIds || [])[0])?.epicId,
              );
              const id = folderFor(ep ? `${ep.key} ${ep.title}` : 'No epic');
              if (t.folderId !== id) {
                t.folderId = id;
                moved++;
              }
            }
            // epic folders in backlog order, then the rest
            const order = new Map<string, number>(
              pp.epics.map((e: Any, i: number) => [`${e.key} ${e.title}`, i] as [string, number]),
            );
            rr.folders.sort(
              (a: Any, b: Any) => (order.get(a.name) ?? 1e6) - (order.get(b.name) ?? 1e6),
            );
          });
          toast(`${moved} test${moved === 1 ? '' : 's'} moved into epic folders.`, 'ok', {
            title: 'Repository organized',
          });
        }}
      />,
    );
  return (
    <div className="xr-repo">
      <aside className="xr-tree">
        <div className="xr-mode" role="tablist" aria-label="Organize by">
          <button
            role="tab"
            aria-selected={mode === 'epics'}
            className={mode === 'epics' ? 'on' : ''}
            onClick={() => setMode('epics')}
          >
            Epics
          </button>
          <button
            role="tab"
            aria-selected={mode === 'folders'}
            className={mode === 'folders' ? 'on' : ''}
            onClick={() => setMode('folders')}
          >
            Folders
          </button>
        </div>
        <button
          className={`xr-folder ${folder === 'all' ? 'on' : ''}`}
          onClick={() => setFolder('all')}
        >
          <Ico svg={I.test} />
          <span>All tests</span>
          <span className="count">{r.tests.length}</span>
        </button>
        {mode === 'epics' && (
          <>
            {epicTree()}
            {r.tests.some((t: Any) => !(t.issueIds || []).length) && (
              <button
                className={`xr-folder ${folder === 'unlinked' ? 'on' : ''}`}
                onClick={() => setFolder('unlinked')}
              >
                <Ico svg={I.doc} />
                <span>Not linked to an issue</span>
                <span className="count">
                  {r.tests.filter((t: Any) => !(t.issueIds || []).length).length}
                </span>
              </button>
            )}
            {canEdit() && r.tests.length > 0 && (
              <button
                className="btn sm subtle"
                onClick={sortIntoEpicFolders}
                title="Make the folders match the epics"
              >
                <Ico svg={I.folder} />
                Sort into epic folders
              </button>
            )}
          </>
        )}
        {mode === 'folders' && tree(null, 0)}
        {mode === 'folders' && (
          <button
            className={`xr-folder ${folder === 'none' ? 'on' : ''}`}
            onClick={() => setFolder('none')}
          >
            <Ico svg={I.doc} />
            <span>Not in a folder</span>
            <span className="count">{r.tests.filter((t: Any) => !t.folderId).length}</span>
          </button>
        )}
        {mode === 'folders' &&
          canEdit() &&
          (newFolder !== null ? (
            <div className="xr-newfolder">
              <TF
                autoFocus
                value={newFolder}
                placeholder={cur ? `Folder inside ${cur.name}` : 'Folder name'}
                onChange={(e) => setNewFolder(e.target.value)}
                onKeyDown={(e: Any) => {
                  if (e.key === 'Enter') addFolder();
                  if (e.key === 'Escape') setNewFolder(null);
                }}
                onBlur={addFolder}
              />
            </div>
          ) : (
            <button className="btn sm subtle" onClick={() => setNewFolder('')}>
              <Ico svg={I.plus} />
              New folder{cur ? ' here' : ''}
            </button>
          ))}
        {cur && canEdit() && (
          <button
            className="btn sm subtle"
            onClick={() =>
              openModal(
                <Confirm
                  title={`Delete the folder “${cur.name}”?`}
                  label="Delete folder"
                  text="Its tests and sub-folders move up to the parent folder. No test is deleted."
                  onYes={() => {
                    edit((rr) => {
                      rr.tests.forEach((t: Any) => {
                        if (t.folderId === cur.id) t.folderId = cur.parentId || null;
                      });
                      rr.folders.forEach((f: Any) => {
                        if (f.parentId === cur.id) f.parentId = cur.parentId || null;
                      });
                      rr.folders = rr.folders.filter((f: Any) => f.id !== cur.id);
                    });
                    setFolder('all');
                  }}
                />,
              )
            }
          >
            <Ico svg={I.trash} />
            Delete folder
          </button>
        )}
      </aside>
      <section className="xr-list">
        <div className="toolbar">
          <TF
            search
            sx={{ width: 260, maxWidth: '100%' }}
            placeholder="Search tests"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <SF
            filter
            value={wf}
            onChange={(e) => setWf(e.target.value)}
            aria-label="Workflow status"
          >
            <MenuItem value="">Active (not deprecated)</MenuItem>
            {WF.map((x) => (
              <MenuItem key={x} value={x}>
                {x} ({r.tests.filter((t: Any) => wfOf(t) === x).length})
              </MenuItem>
            ))}
            <MenuItem value="all">All</MenuItem>
          </SF>
          <span className="spacer" />
          {canEdit() && can('ai.use') && (
            <button
              className="btn sm ai"
              onClick={() => openModal(<AiWriteModal scope={folder} folderId={cur?.id || null} />)}
              title="The AI writes repository tests for issues, following your test standard (Administration → Generation)"
            >
              <Ico svg={I.sparkle} />
              Write tests with AI
            </button>
          )}
          {selIssue && canEdit() && (
            <button className="btn sm" onClick={() => openTest(null, null, selIssue.id)}>
              <Ico svg={I.plus} />
              New test for {selIssue.key}
            </button>
          )}
          <button
            className="btn sm subtle"
            onClick={() => exportTestsCsv(list)}
            title="Export these tests as CSV (one row per step: Xray / BrowserStack style)"
          >
            <Ico svg={I.download} />
            Export CSV
          </button>
          {canEdit() && (
            <button
              className="btn sm subtle"
              onClick={() => openModal(<CsvImportModal folderId={cur?.id || null} />)}
            >
              <Ico svg={I.upload} />
              Import CSV
            </button>
          )}
          {canEdit() && (
            <button
              className="btn sm"
              onClick={() => openModal(<ImportModal folderId={cur?.id || null} />)}
            >
              <Ico svg={I.upload} />
              Import from issues
            </button>
          )}
        </div>
        {list.length ? (
          <table className="tbl xr-tests">
            <thead>
              <tr>
                <th>Key</th>
                <th>Test</th>
                <th>Status</th>
                <th>Type</th>
                <th>Steps</th>
                <th>Issues</th>
                <th>Latest result</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t: Any) => {
                const lr = latestRun(t.id);
                return (
                  <tr key={t.id} className="click" onClick={() => openTest(t)}>
                    <td className="key">{t.key}</td>
                    <td>
                      {t.title}
                      {t.labels?.length ? (
                        <span className="lbls">
                          {t.labels.slice(0, 2).map((l: string) => (
                            <span key={l} className="label-chip">
                              {l}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <WfLoz t={t} />
                      {(t.version || 1) > 1 && <span className="muted small"> v{t.version}</span>}
                    </td>
                    <td className="muted">{t.type}</td>
                    <td className="num muted">{t.steps?.length || 0}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {(t.issueIds || [])
                        .map((id: string) => p.tickets.find((x: Any) => x.id === id))
                        .filter(Boolean)
                        .slice(0, 3)
                        .map((x: Any) => (
                          <button
                            key={x.id}
                            className="link-btn key small"
                            onClick={() => openDrawer('issue', x.id)}
                          >
                            {x.key}
                          </button>
                        ))}
                      {(t.issueIds || []).length > 3 ? (
                        <span className="muted small"> +{t.issueIds.length - 3}</span>
                      ) : null}
                    </td>
                    <td>
                      {lr ? (
                        <>
                          <RunLoz s={lr.status} />{' '}
                          <span className="muted small">{lr.execution.key}</span>
                        </>
                      ) : (
                        <span className="muted small">Not run</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState
            compact
            icon={I.test}
            tone="neutral"
            title={r.tests.length ? 'No tests here' : 'No tests yet'}
            actions={
              canEdit() && (
                <>
                  <button className="btn primary" onClick={() => openTest(null, cur?.id)}>
                    <Ico svg={I.plus} />
                    New test
                  </button>
                  {!r.tests.length && (
                    <button
                      className="btn"
                      onClick={() => openModal(<ImportModal folderId={null} />)}
                    >
                      <Ico svg={I.upload} />
                      Import from issues
                    </button>
                  )}
                </>
              )
            }
          >
            <p>
              {r.tests.length
                ? 'Pick another folder, or clear the search.'
                : 'Create reusable tests, or import the test cases your issues already have. Each test can cover several issues.'}
            </p>
          </EmptyState>
        )}
      </section>
    </div>
  );
}

/** Test cases already on issues → repository tests, linked to their issue, one folder per epic. */
function ImportModal({ folderId }: { folderId: string | null }) {
  const p = P();
  const r = repo(p);
  const done = new Set(r.tests.map((t: Any) => t.source?.tcId).filter(Boolean));
  const issues = p.tickets.filter((t: Any) =>
    (t.testCases || []).some((c: Any) => !done.has(c.id)),
  );
  const [pick, setPick] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(issues.map((t: Any) => [t.id, true])),
  );
  const [byEpic, setByEpic] = useState(!folderId);
  const n = issues
    .filter((t: Any) => pick[t.id])
    .reduce((x: number, t: Any) => x + t.testCases.filter((c: Any) => !done.has(c.id)).length, 0);
  const go = () => {
    let made = 0;
    edit((rr, pp) => {
      const folderFor = (epicId: string | null) => {
        if (!byEpic) return folderId;
        const e = pp.epics.find((x: Any) => x.id === epicId);
        const name = e ? `${e.key} ${e.title}` : 'No epic';
        let f = rr.folders.find((x: Any) => x.name === name && !x.parentId);
        if (!f) {
          f = { id: uid(), name, parentId: null };
          rr.folders.push(f);
        }
        return f.id;
      };
      for (const t of pp.tickets.filter((x: Any) => pick[x.id])) {
        for (const c of t.testCases || []) {
          if (done.has(c.id)) continue;
          const steps = (Array.isArray(c.steps) ? c.steps : c.steps ? [c.steps] : []).map(
            (s: string, i: number, all: string[]) => ({
              id: uid(),
              action: s,
              data: '',
              expected: i === all.length - 1 ? c.expected || '' : '',
            }),
          );
          rr.tests.push({
            id: uid(),
            key: nextKey(rr, pp, 't'),
            title: c.title,
            type: c.script ? 'Automated' : 'Manual',
            folderId: folderFor(t.epicId || null),
            priority: c.priority || 'Medium',
            labels: [c.type].filter(Boolean),
            preconditions: c.preconditions || '',
            steps,
            issueIds: [t.id],
            source: { ticketId: t.id, tcId: c.id },
            createdAt: nowIso(),
            createdBy: me(),
          });
          made++;
        }
      }
    });
    closeModal();
    toast(
      `${made} test${made === 1 ? '' : 's'} added to the repository, each linked to its issue.`,
      'ok',
      { title: 'Tests imported' },
    );
  };
  return (
    <Modal
      title="Import test cases from issues"
      wide
      actions={[
        { label: 'Cancel' },
        {
          label: `Import ${n} test${n === 1 ? '' : 's'}`,
          kind: 'primary',
          disabled: !n,
          onClick: go,
        },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Each test case on the picked issues becomes a reusable test in the repository, linked to its
        issue (its steps and expected result carry over). The issues keep their own test cases. Test
        cases imported before are skipped.
      </p>
      <CB
        label="One folder per epic"
        checked={byEpic}
        onChange={(e: Any) => setByEpic(e.target.checked)}
      />
      <div className="split-list">
        {issues.map((t: Any) => (
          <label key={t.id} className={`split-row ${pick[t.id] ? '' : 'off'}`}>
            <CB
              checked={Boolean(pick[t.id])}
              onChange={() => setPick({ ...pick, [t.id]: !pick[t.id] })}
              aria-label={`Import ${t.key}`}
            />
            <TypeIcon type={t.type} />
            <span className="key">{t.key}</span>
            <span className="split-title">{t.title}</span>
            <span className="muted small">
              {t.testCases.filter((c: Any) => !done.has(c.id)).length} test cases
            </span>
          </label>
        ))}
        {!issues.length && (
          <p className="muted small" style={{ padding: 10 }}>
            Every test case is already in the repository.
          </p>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- reviews (the approval queue)
function Reviews() {
  useStore();
  const p = P();
  const r = repo(p);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const waiting = r.tests.filter((t: Any) => wfOf(t) === 'Ready for review');
  const back = r.tests.filter((t: Any) => wfOf(t) === 'Needs update');
  const drafts = r.tests.filter((t: Any) => wfOf(t) === 'Draft');
  const act = (t: Any, a: string) => {
    const err = wfAction(t.id, a, notes[t.id] || '');
    if (err) toast(err, 'err');
    else {
      setNotes({ ...notes, [t.id]: '' });
      toast(
        `${t.key}: ${a === 'approve' ? 'approved' : a === 'changes' ? 'sent back for changes' : 'submitted for review'}`,
      );
    }
  };
  const submitted = (t: Any) =>
    [...(t.reviews || [])].reverse().find((x: Any) => x.action === 'submit');
  const row = (t: Any, kind: string) => (
    <div key={t.id} className="wf-row">
      <div className="wf-main">
        <div>
          <button className="link-btn key" onClick={() => openTest(t)}>
            {t.key}
          </button>{' '}
          <b>{t.title}</b> <WfLoz t={t} />{' '}
          <span className="muted small">
            v{t.version || 1} · {t.type} · {t.steps?.length || 0} steps
          </span>
        </div>
        <div className="muted small">
          {kind === 'waiting'
            ? `Submitted by ${submitted(t)?.by || t.updatedBy || t.createdBy || '—'} ${submitted(t) ? ago(submitted(t).at) : ''}`
            : kind === 'back'
              ? `${(t.reviews || []).slice(-1)[0]?.by || 'A reviewer'}: “${(t.reviews || []).slice(-1)[0]?.comment || ''}”`
              : `Created by ${t.createdBy || '—'} ${ago(t.createdAt)}`}
          {(t.issueIds || []).length > 0 && (
            <>
              {' '}
              · covers{' '}
              {(t.issueIds || [])
                .map((id: string) => p.tickets.find((x: Any) => x.id === id)?.key)
                .filter(Boolean)
                .join(', ')}
            </>
          )}
        </div>
      </div>
      <div className="wf-acts">
        {kind === 'waiting' && canReview() && (
          <>
            <TF
              bare
              className="wf-note"
              value={notes[t.id] || ''}
              placeholder="Comment"
              onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })}
            />
            <button className="btn sm primary" onClick={() => act(t, 'approve')}>
              Approve
            </button>
            <button className="btn sm" onClick={() => act(t, 'changes')}>
              Request changes
            </button>
          </>
        )}
        {kind !== 'waiting' && canEdit() && (
          <button className="btn sm" onClick={() => act(t, 'submit')}>
            Submit for review
          </button>
        )}
        <button className="btn sm subtle" onClick={() => openTest(t)}>
          Open
        </button>
      </div>
    </div>
  );
  const st = wfSettings(p);
  return (
    <div className="wf-queue">
      <p className="muted small" style={{ marginTop: 0 }}>
        Tests move Draft → Ready for review → Approved.{' '}
        {st.requireApproval ? (
          <b>Only Approved tests can go into plans and executions.</b>
        ) : (
          'Any active test can go into plans and executions (turn on “Only Approved tests” in Workflow).'
        )}{' '}
        {st.fourEyes ? 'The approver must not be the person who last changed the test.' : ''}
      </p>
      <h4 className="sync-h">Waiting for review ({waiting.length})</h4>
      {waiting.length ? (
        waiting.map((t: Any) => row(t, 'waiting'))
      ) : (
        <p className="muted small">
          Nothing waiting. Tests appear here when someone submits them for review.
        </p>
      )}
      {back.length > 0 && (
        <>
          <h4 className="sync-h">Sent back for changes ({back.length})</h4>
          {back.map((t: Any) => row(t, 'back'))}
        </>
      )}
      {drafts.length > 0 && (
        <>
          <h4 className="sync-h">Drafts ({drafts.length})</h4>
          {drafts.slice(0, 50).map((t: Any) => row(t, 'draft'))}
          {canEdit() && drafts.length > 1 && (
            <button
              className="btn sm subtle"
              onClick={() => {
                drafts.forEach((t: Any) => wfAction(t.id, 'submit'));
                toast(`${drafts.length} drafts submitted for review`);
              }}
            >
              Submit all {drafts.length} drafts for review
            </button>
          )}
        </>
      )}
    </div>
  );
}
function WorkflowModal() {
  const [v, setV] = useState(() => wfSettings());
  return (
    <Modal
      title="Test review workflow"
      actions={[
        { label: 'Cancel' },
        {
          label: 'Save',
          kind: 'primary',
          onClick: () => {
            edit((rr) => {
              rr.settings = { ...(rr.settings || {}), ...v };
            });
            closeModal();
            toast('Workflow saved');
          },
        },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Like Xray and BrowserStack Test Management: tests are written as Drafts, reviewed, and
        approved before they count. Editing an approved test makes a new version and sends it back
        to review; earlier versions are kept.
      </p>
      <CB
        label={
          <>
            <b>Only Approved tests in plans and executions</b>
            <div className="muted small">
              Drafts and tests waiting for review can’t be planned or run until approved.
            </div>
          </>
        }
        checked={v.requireApproval}
        onChange={(e: Any) => setV({ ...v, requireApproval: e.target.checked })}
      />
      <CB
        label={
          <>
            <b>Four-eyes approval</b>
            <div className="muted small">
              Whoever last changed a test can’t approve it (the owner can).
            </div>
          </>
        }
        checked={v.fourEyes}
        onChange={(e: Any) => setV({ ...v, fourEyes: e.target.checked })}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------- one test
export function openTest(test: Any | null, folderId?: string | null, issueId?: string) {
  openModal(<TestModal test={test} folderId={folderId || null} issueId={issueId} />);
}
function TestModal({
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

// ---------------------------------------------------------------- plans
function Plans() {
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
function latestPlanStatus(pl: Any, testId: string) {
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
function PlanModal({ plan, draft }: { plan: Any | null; draft?: Any }) {
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
const PLAN_KINDS: [string, string, string][] = [
  ['smoke', 'Smoke', 'The few tests that prove the main flows still work.'],
  ['regression', 'Regression', 'Broad coverage of the scope, riskiest first.'],
  ['feature', 'Feature / epic', 'Everything that proves the chosen epics work.'],
  ['sprint', 'Sprint', 'Tests for the issues in a sprint.'],
  ['retest', 'Retest failures', 'What failed or was blocked last time, and its neighbours.'],
  ['custom', 'Custom', 'Describe the goal yourself.'],
];
function AiPlanModal() {
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
function createExecution({
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
function NewExecutionModal() {
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
function Executions() {
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
function ExecutionModal({ id, startAt }: { id: string; startAt?: string }) {
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

// ---------------------------------------------------------------- coverage
function Coverage() {
  const p = P();
  const [epic, setEpic] = useState('');
  const [only, setOnly] = useState('');
  const [env, setEnv] = useState('');
  const envs = environmentsOf(p);
  const rows = p.tickets
    .filter((t: Any) => !isSub(t) && (!epic || t.epicId === epic))
    .map((t: Any) => ({ t, ...coverageOf(t.id, p, env) }))
    .filter((x: Any) => !only || x.status === only);
  const all = p.tickets
    .filter((t: Any) => !isSub(t) && (!epic || t.epicId === epic))
    .map((t: Any) => coverageOf(t.id, p, env).status);
  const n = (s: string) => all.filter((x: string) => x === s).length;
  return (
    <>
      <div className="toolbar">
        <SF filter value={epic} onChange={(e) => setEpic(e.target.value)} aria-label="Epic">
          <MenuItem value="">All epics</MenuItem>
          {p.epics.map((e: Any) => (
            <MenuItem key={e.id} value={e.id}>
              {e.key} {e.title}
            </MenuItem>
          ))}
        </SF>
        {envs.length > 0 && (
          <SF filter value={env} onChange={(e) => setEnv(e.target.value)} aria-label="Environment">
            <MenuItem value="">All environments</MenuItem>
            {envs.map((x) => (
              <MenuItem key={x} value={x}>
                {x}
              </MenuItem>
            ))}
          </SF>
        )}
        {(['OK', 'NOK', 'NOTRUN', 'UNCOVERED'] as const).map((s) => (
          <button
            key={s}
            className={`xr-covfilter ${only === s ? 'on' : ''}`}
            onClick={() => setOnly(only === s ? '' : s)}
          >
            <CovLoz s={s} /> {n(s)}
          </button>
        ))}
        <span className="spacer" />
        <button
          className="btn sm"
          onClick={() => exportTraceability(epic, env)}
          title="Requirement → test → latest run → defects, as CSV"
        >
          <Ico svg={I.download} />
          Traceability report
        </button>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Issue</th>
            <th>Status</th>
            <th>Tests</th>
            <th>Coverage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ t, status, tests }: Any) => (
            <tr key={t.id} className="click" onClick={() => openDrawer('issue', t.id)}>
              <td>
                <span className="row" style={{ flexWrap: 'nowrap' }}>
                  <TypeIcon type={t.type} />
                  <span className="key">{t.key}</span>
                  <span>{t.title}</span>
                </span>
              </td>
              <td>
                <StatusLoz s={t.status} />
              </td>
              <td style={{ width: 200 }}>
                {tests.length ? (
                  <StatusBar statuses={tests.map((x: Any) => latestStatus(x.id, p, env))} />
                ) : (
                  <span className="muted small">No tests</span>
                )}
              </td>
              <td>
                <CovLoz s={status} /> <span className="muted small">{tests.length || ''}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ---------------------------------------------------------------- the issue panel: its tests
/**
 * Issue panel → Tests: the repository tests that cover this issue, their latest results, and
 * linking.
 */
export function TestsSection({ t }: { t: Any }) {
  const p = P();
  const r = repo(p);
  const cov = coverageOf(t.id);
  const [link, setLink] = useState('');
  const ed = canEdit();
  return (
    <div className="sec">
      <div className="sec-title">
        <Ico svg={I.test} />
        <h3>Tests</h3>
        <span className="count">{cov.tests.length}</span>
        <CovLoz s={cov.status} />
        {ed && (
          <div className="tools">
            <SF
              filter
              value={link}
              onChange={(e) => {
                const id = e.target.value;
                setLink('');
                if (id)
                  edit((rr) => {
                    const x = rr.tests.find((y: Any) => y.id === id);
                    if (x) x.issueIds = [...new Set([...(x.issueIds || []), t.id])];
                  });
              }}
              aria-label="Link a test"
            >
              <MenuItem value="">Link a test</MenuItem>
              {r.tests
                .filter((x: Any) => !x.issueIds?.includes(t.id))
                .map((x: Any) => (
                  <MenuItem key={x.id} value={x.id}>
                    {x.key} {x.title.slice(0, 60)}
                  </MenuItem>
                ))}
            </SF>
            <button className="btn sm subtle" onClick={() => openTest(null, null, t.id)}>
              <Ico svg={I.plus} />
              New test
            </button>
          </div>
        )}
      </div>
      {cov.tests.length ? (
        <div className="xr-ttests">
          {cov.tests.map((x: Any) => {
            const lr = latestRun(x.id);
            return (
              <div key={x.id} className="xr-trow">
                <button className="link-btn key" onClick={() => openTest(x)}>
                  {x.key}
                </button>
                <span className="split-title">{x.title}</span>
                {lr ? (
                  <button
                    className="link-btn small"
                    title={`In ${lr.execution.key}`}
                    onClick={() => openExecution(lr.execution.id, x.id)}
                  >
                    <RunLoz s={lr.status} />
                  </button>
                ) : (
                  <RunLoz s="TODO" />
                )}
                {ed && (
                  <button
                    className="icon-btn"
                    title="Unlink from this issue"
                    aria-label={`Unlink ${x.key}`}
                    onClick={() =>
                      edit((rr) => {
                        const y = rr.tests.find((z: Any) => z.id === x.id);
                        if (y) y.issueIds = y.issueIds.filter((id: string) => id !== t.id);
                      })
                    }
                  >
                    <Ico svg={I.close} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted small">
          No repository tests cover this issue yet. Link one, create one, or import this issue’s
          test cases in Test management.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- import / export / reports (Xray
// & BrowserStack style)
const csvCell = (v: Any) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const download = (name: string, text: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
};
/** RFC 4180 CSV → rows of cells. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
      continue;
    }
    if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const CSV_HEAD = [
  'Test Key',
  'Summary',
  'Type',
  'Priority',
  'Labels',
  'Folder',
  'Preconditions',
  'Step',
  'Action',
  'Data',
  'Expected Result',
  'Gherkin',
  'Issues',
];
/** One row per step (the layout Xray and BrowserStack import). */
export function exportTestsCsv(tests: Any[]) {
  const p = P();
  const r = repo(p);
  const folder = (id: string) => r.folders.find((f: Any) => f.id === id)?.name || '';
  const issues = (t: Any) =>
    (t.issueIds || [])
      .map((id: string) => p.tickets.find((x: Any) => x.id === id)?.key)
      .filter(Boolean)
      .join(' ');
  const lines = [CSV_HEAD.join(',')];
  for (const t of tests) {
    const base = [
      t.key,
      t.title,
      t.type,
      t.priority,
      (t.labels || []).join(' '),
      folder(t.folderId),
      t.preconditions || '',
    ];
    const steps = t.type === 'Cucumber' || !(t.steps || []).length ? [null] : t.steps;
    steps.forEach((st: Any, i: number) =>
      lines.push(
        [
          ...base,
          st ? i + 1 : '',
          st?.action || '',
          st?.data || '',
          st?.expected || '',
          i === 0 ? t.gherkin || '' : '',
          i === 0 ? issues(t) : '',
        ]
          .map(csvCell)
          .join(','),
      ),
    );
  }
  download(`${p.key}-tests-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'));
  toast(`${tests.length} test${tests.length === 1 ? '' : 's'} exported`);
}
function CsvImportModal({ folderId }: { folderId: string | null }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [name, setName] = useState('');
  const head = rows?.[0]?.map((h) => h.trim().toLowerCase()) || [];
  const col = (...names: string[]) =>
    head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const ci = {
    key: col('test key', 'key', 'id'),
    title: col('summary', 'title', 'test case', 'name'),
    type: col('type'),
    priority: col('priority'),
    labels: col('labels', 'tags'),
    folder: col('folder'),
    pre: col('precondition'),
    action: col('action', 'step', 'steps'),
    data: col('data', 'test data'),
    expected: col('expected'),
    gherkin: col('gherkin', 'scenario'),
    issues: col('issues', 'requirement', 'linked'),
  };
  const tests = (() => {
    if (!rows || ci.title < 0) return [];
    const out: Any[] = [];
    let cur: Any = null;
    for (const row of rows.slice(1)) {
      const g = (i: number) => (i >= 0 ? String(row[i] || '').trim() : '');
      const title = g(ci.title);
      if (title && (!cur || title !== cur.title || (g(ci.key) && g(ci.key) !== cur.srcKey))) {
        cur = {
          srcKey: g(ci.key),
          title,
          type:
            TEST_TYPES.find((x) => x.toLowerCase() === g(ci.type).toLowerCase()) ||
            (g(ci.gherkin) ? 'Cucumber' : 'Manual'),
          priority:
            ['High', 'Medium', 'Low'].find(
              (x) => x.toLowerCase() === g(ci.priority).toLowerCase(),
            ) || 'Medium',
          labels: g(ci.labels)
            .split(/[\s,;]+/)
            .filter(Boolean),
          folder: g(ci.folder),
          preconditions: g(ci.pre),
          gherkin: g(ci.gherkin),
          issues: g(ci.issues)
            .split(/[\s,;]+/)
            .filter(Boolean),
          steps: [],
        };
        out.push(cur);
      }
      if (cur && (g(ci.action) || g(ci.expected)))
        cur.steps.push({
          id: uid(),
          action: g(ci.action),
          data: g(ci.data),
          expected: g(ci.expected),
        });
    }
    return out;
  })();
  const go = () => {
    let made = 0,
      linked = 0;
    edit((rr, pp) => {
      const folderFor = (n: string) => {
        if (!n) return folderId;
        let f = rr.folders.find((x: Any) => x.name === n);
        if (!f) {
          f = { id: uid(), name: n, parentId: null };
          rr.folders.push(f);
        }
        return f.id;
      };
      for (const t of tests) {
        const issueIds = t.issues
          .map((k: string) => pp.tickets.find((x: Any) => x.key === k)?.id)
          .filter(Boolean);
        linked += issueIds.length;
        rr.tests.push({
          id: uid(),
          key: nextKey(rr, pp, 't'),
          title: t.title,
          type: t.type,
          priority: t.priority,
          labels: t.labels,
          folderId: folderFor(t.folder),
          preconditions: t.preconditions,
          gherkin: t.gherkin,
          steps: t.steps,
          issueIds,
          source: t.srcKey ? { importedKey: t.srcKey } : undefined,
          createdAt: nowIso(),
          createdBy: me(),
        });
        made++;
      }
    });
    closeModal();
    toast(
      `${made} test${made === 1 ? '' : 's'} imported${linked ? `, ${linked} issue link${linked === 1 ? '' : 's'}` : ''}.`,
      'ok',
      {
        title: 'CSV imported',
      },
    );
  };
  return (
    <Modal
      title="Import tests from CSV"
      wide
      actions={[
        { label: 'Cancel' },
        {
          label: `Import ${tests.length} test${tests.length === 1 ? '' : 's'}`,
          kind: 'primary',
          disabled: !tests.length,
          onClick: go,
        },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Works with exports from Xray, BrowserStack Test Management, TestRail and this app: one row
        per step, with columns like <i>Summary / Title</i>, <i>Action</i>, <i>Data</i>,{' '}
        <i>Expected Result</i>, <i>Priority</i>, <i>Labels</i>, <i>Folder</i>, <i>Preconditions</i>,{' '}
        <i>Gherkin</i> and <i>Issues</i> (issue keys to link). Rows with the same title continue the
        same test.
      </p>
      <label className="btn">
        <Ico svg={I.upload} />
        {name || 'Choose a CSV file'}
        <input
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              setName(f.name);
              setRows(parseCsv(await f.text()));
            }
          }}
        />
      </label>
      {rows && ci.title < 0 && (
        <p className="warn-text small">
          No Summary / Title column found. Columns: {rows[0].join(', ')}
        </p>
      )}
      {tests.length > 0 && (
        <div className="split-list" style={{ marginTop: 10 }}>
          {tests.slice(0, 200).map((t: Any, i: number) => (
            <div key={i} className="split-row">
              <span className="key">{t.srcKey || '—'}</span>
              <span className="split-title">{t.title}</span>
              <span className="muted small">
                {t.type} · {t.steps.length} steps
                {t.issues.length ? ` · ${t.issues.join(', ')}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/**
 * Traceability (requirement → test → latest run → defects), as CSV — the report Xray and
 * BrowserStack both provide.
 */
function exportTraceability(epicId: string, env: string) {
  const p = P();
  const lines = [
    [
      'Issue',
      'Issue summary',
      'Issue status',
      'Epic',
      'Coverage',
      'Test',
      'Test summary',
      'Type',
      'Latest result',
      'Execution',
      'Environment',
      'Executed by',
      'Executed at',
      'Defects',
    ].join(','),
  ];
  for (const t of p.tickets.filter((x: Any) => !isSub(x) && (!epicId || x.epicId === epicId))) {
    const cov = coverageOf(t.id, p, env);
    const epic = p.epics.find((e: Any) => e.id === t.epicId);
    const base = [
      t.key,
      t.title,
      t.status,
      epic ? `${epic.key} ${epic.title}` : '',
      COV_LABEL[cov.status],
    ];
    if (!cov.tests.length) {
      lines.push([...base, '', '', '', '', '', '', '', '', ''].map(csvCell).join(','));
      continue;
    }
    for (const x of cov.tests) {
      const lr = latestRun(x.id, p, env);
      const defects = (lr?.defectIds || [])
        .map((id: string) => p.tickets.find((b: Any) => b.id === id)?.key)
        .filter(Boolean)
        .join(' ');
      lines.push(
        [
          ...base,
          x.key,
          x.title,
          x.type,
          lr ? STATUS_LABEL[lr.status] : 'Not run',
          lr?.execution.key || '',
          lr?.execution.environment || '',
          lr?.by || '',
          lr?.at || '',
          defects,
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  download(
    `${p.key}-traceability${env ? `-${env}` : ''}-${new Date().toISOString().slice(0, 10)}.csv`,
    lines.join('\n'),
  );
  toast('Traceability report downloaded');
}

/**
 * JUnit XML (Playwright, Jest, pytest, Cypress, Maven…) → results in an execution. A testcase
 * matches a test by key in its name, else by title.
 */
function importJunit(execId: string, xml: string, file: string) {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('not XML');
  } catch {
    toast(`${file} isn’t a JUnit XML report.`, 'err');
    return;
  }
  const cases = [...doc.getElementsByTagName('testcase')];
  if (!cases.length) {
    toast(`No <testcase> in ${file}.`, 'err');
    return;
  }
  const r = repo();
  const e = r.executions.find((x: Any) => x.id === execId);
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const inExec = r.tests.filter((t: Any) => e?.testIds.includes(t.id));
  const pickTest = (name: string) => {
    const key = name.match(/[A-Z][A-Z0-9]+-T\d+/)?.[0];
    if (key) return r.tests.find((t: Any) => t.key === key);
    const n = norm(name);
    return (
      inExec.find((t: Any) => norm(t.title) === n) ||
      inExec.find((t: Any) => n.includes(norm(t.title)) || norm(t.title).includes(n)) ||
      r.tests.find((t: Any) => norm(t.title) === n)
    );
  };
  const results: Any[] = [];
  const unmatched: string[] = [];
  for (const c of cases) {
    const name = c.getAttribute('name') || '';
    const t = pickTest(`${name} ${c.getAttribute('classname') || ''}`) || pickTest(name);
    if (!t) {
      unmatched.push(name);
      continue;
    }
    const fail = c.getElementsByTagName('failure')[0] || c.getElementsByTagName('error')[0];
    const skip = c.getElementsByTagName('skipped')[0];
    results.push({
      t,
      status: fail ? 'FAILED' : skip ? 'BLOCKED' : 'PASSED',
      comment: fail
        ? `${fail.getAttribute('message') || ''}\n${(fail.textContent || '').trim().slice(0, 1500)}`.trim()
        : skip
          ? `Skipped${skip.getAttribute('message') ? `: ${skip.getAttribute('message')}` : ''}`
          : `Passed in ${c.getAttribute('time') || '?'}s`,
      time: c.getAttribute('time'),
    });
  }
  edit((rr) => {
    const ex = rr.executions.find((x: Any) => x.id === execId);
    if (!ex) return;
    ex.runs = ex.runs || {};
    for (const x of results) {
      if (!ex.testIds.includes(x.t.id)) ex.testIds.push(x.t.id);
      ex.runs[x.t.id] = {
        steps: {},
        defectIds: [],
        ...(ex.runs[x.t.id] || {}),
        status: x.status,
        comment: x.comment,
        automated: true,
        source: file,
        at: nowIso(),
        by: me(),
      };
    }
  });
  const c = counts(results.map((x) => x.status));
  toast(
    `${results.length} of ${cases.length} results matched: ${c.PASSED} passed, ${c.FAILED} failed, ${c.BLOCKED} skipped.${unmatched.length ? ` Not matched: ${unmatched.slice(0, 3).join('; ')}${unmatched.length > 3 ? '…' : ''} (put the test key, like ${r.tests[0]?.key || 'PROJ-T1'}, in the test name).` : ''}`,
    unmatched.length ? 'warn' : 'ok',
    { title: `Imported ${file}` },
  );
}

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
function AiWriteModal({ scope, folderId }: { scope: string; folderId: string | null }) {
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
