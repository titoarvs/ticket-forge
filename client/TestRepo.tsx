'use client';
// Test management, in the style of Xray for Jira. Saved on the project as `testRepo`:
//   Tests       reusable test definitions (steps: action / data / expected), in folders, linked to any number of issues
//   Test Plans  sets of tests for a goal (an epic, a sprint, a release), with progress
//   Executions  runs of tests: each test and each step Passed / Failed / Blocked, with comments, evidence and defects
//   Coverage    per issue: OK (all its tests pass), NOK (one fails), Not run, Uncovered
// Issues show their tests in the issue panel (TestsSection). Existing test cases on issues can be imported.
import { useState, type ReactNode } from 'react';
import { S, P, emit, useStore, mutate, toast, openModal, closeModal, can, uid, nowIso, me, newTicket, addLink, logEvent, isSub, type Any } from './core';
import { Ico, I, Modal, Confirm, TypeIcon, StatusLoz, EmptyState } from './ui';
import { TF, TA, SF, CB, MenuItem } from './fields';
import { Header } from './views';
import { openDrawer } from './actions';

// ---------------------------------------------------------------- model
export const RUN_STATUS = ['TODO', 'EXECUTING', 'PASSED', 'FAILED', 'BLOCKED'] as const;
const STATUS_LABEL: Record<string, string> = { TODO: 'To do', EXECUTING: 'Executing', PASSED: 'Passed', FAILED: 'Failed', BLOCKED: 'Blocked' };
const TEST_TYPES = ['Manual', 'Automated', 'Exploratory'];
export const repo = (p: Any = P()) => p.testRepo || { seq: { t: 0, tp: 0, te: 0 }, folders: [], tests: [], plans: [], executions: [] };
/** Changes the repository inside one undo step and save. */
const edit = (fn: (r: Any, p: Any) => void, tag?: string) => mutate((pp: Any) => {
  pp.testRepo = { seq: { t: 0, tp: 0, te: 0 }, folders: [], tests: [], plans: [], executions: [], ...(pp.testRepo || {}) };
  pp.testRepo.seq = { t: 0, tp: 0, te: 0, ...(pp.testRepo.seq || {}) };
  fn(pp.testRepo, pp);
}, tag ? { tag } : undefined);
const nextKey = (r: Any, p: Any, kind: 't' | 'tp' | 'te') => { r.seq[kind] = (r.seq[kind] || 0) + 1; return `${p.key}-${kind.toUpperCase()}${r.seq[kind]}`; };
const canEdit = () => can('test.run') || can('issue.edit');

/** A test's latest result across executions: the newest run that isn't To do. */
export function latestRun(testId: string, p: Any = P()): Any | null {
  const runs = repo(p).executions.map((e: Any) => ({ e, run: e.runs?.[testId] })).filter((x: Any) => x.run && x.run.status !== 'TODO')
    .sort((a: Any, b: Any) => String(b.run.at || b.e.createdAt).localeCompare(String(a.run.at || a.e.createdAt)));
  return runs[0] ? { ...runs[0].run, execution: runs[0].e } : null;
}
export const latestStatus = (testId: string, p?: Any) => latestRun(testId, p)?.status || 'TODO';
/** Xray coverage of an issue from its linked tests. */
export function coverageOf(ticketId: string, p: Any = P()) {
  const tests = repo(p).tests.filter((t: Any) => t.issueIds?.includes(ticketId));
  if (!tests.length) return { status: 'UNCOVERED', tests };
  const st = tests.map((t: Any) => latestStatus(t.id, p));
  return { status: st.includes('FAILED') ? 'NOK' : st.includes('BLOCKED') ? 'NOK' : st.every((x: string) => x === 'PASSED') ? 'OK' : 'NOTRUN', tests };
}
const COV_LABEL: Record<string, string> = { OK: 'OK', NOK: 'NOK', NOTRUN: 'Not run', UNCOVERED: 'Uncovered' };
export const RunLoz = ({ s }: { s: string }) => <span className={`xr-st xr-${String(s).toLowerCase()}`}>{STATUS_LABEL[s] || s}</span>;
export const CovLoz = ({ s }: { s: string }) => <span className={`xr-cov xr-cov-${s.toLowerCase()}`}>{COV_LABEL[s]}</span>;
function counts(statuses: string[]) {
  const c: Record<string, number> = { PASSED: 0, FAILED: 0, BLOCKED: 0, EXECUTING: 0, TODO: 0 };
  for (const s of statuses) c[s] = (c[s] || 0) + 1;
  return c;
}
/** A stacked bar of run statuses. */
function StatusBar({ statuses }: { statuses: string[] }) {
  const c = counts(statuses);
  const n = statuses.length || 1;
  return <span className="xr-bar" title={RUN_STATUS.map((s) => `${STATUS_LABEL[s]}: ${c[s] || 0}`).join(' · ')}>
    {(['PASSED', 'FAILED', 'BLOCKED', 'EXECUTING', 'TODO'] as const).map((s) => c[s] ? <i key={s} className={`xr-${s.toLowerCase()}`} style={{ width: `${(c[s] / n) * 100}%` }} /> : null)}</span>;
}
const runStatusFromSteps = (steps: Record<string, string>, total: number) => {
  const v = Object.values(steps || {});
  if (v.includes('FAILED')) return 'FAILED';
  if (v.includes('BLOCKED')) return 'BLOCKED';
  if (total && v.filter((x) => x === 'PASSED').length === total) return 'PASSED';
  return v.some((x) => x && x !== 'TODO') ? 'EXECUTING' : 'TODO';
};

// ---------------------------------------------------------------- page
const TABS: [string, string, string][] = [['repository', 'Test repository', I.folder], ['plans', 'Test plans', I.epic], ['executions', 'Test executions', I.play], ['coverage', 'Coverage', I.check]];
export function TestManagement() {
  const p = P();
  const r = repo(p);
  const tab = TABS.some(([k]) => k === S.trTab) ? S.trTab : 'repository';
  const setTab = (k: string) => { S.trTab = k; emit(); };
  const allSt = r.tests.map((t: Any) => latestStatus(t.id));
  const c = counts(allSt);
  const issues = p.tickets.filter((t: Any) => !isSub(t));
  const covered = issues.filter((t: Any) => r.tests.some((x: Any) => x.issueIds?.includes(t.id))).length;
  return <>
    <Header title="Test management" sub={<span className="muted small">Reusable tests, plans and executions, linked to your issues</span>}
      right={canEdit() && <>
        {tab === 'repository' && <button className="btn primary" onClick={() => openTest(null)}><Ico svg={I.plus} />New test</button>}
        {tab === 'plans' && <button className="btn primary" onClick={() => openModal(<PlanModal plan={null} />)}><Ico svg={I.plus} />New test plan</button>}
        {tab === 'executions' && <button className="btn primary" onClick={() => openModal(<NewExecutionModal />)}><Ico svg={I.plus} />New execution</button>}
      </>} />
    <div className="tiles">
      <div className="tile"><span className="ic"><Ico svg={I.test} /></span><div><b>{r.tests.length}</b><span>tests in {r.folders.length} folder{r.folders.length === 1 ? '' : 's'}</span></div></div>
      <div className="tile"><span className="ic" style={{ color: '#22a06b' }}><Ico svg={I.check} /></span><div><b>{c.PASSED}</b><span>passing · {c.FAILED} failing · {c.BLOCKED} blocked</span></div></div>
      <div className="tile"><span className="ic"><Ico svg={I.play} /></span><div><b>{r.executions.length}</b><span>executions in {r.plans.length} plan{r.plans.length === 1 ? '' : 's'}</span></div></div>
      <div className="tile"><span className="ic"><Ico svg={I.backlog} /></span><div><b>{issues.length ? Math.round((covered / issues.length) * 100) : 0}%</b><span>issues covered ({covered} of {issues.length})</span></div></div>
    </div>
    <div className="tabbar auto-tabs" role="tablist" aria-label="Test management">{TABS.map(([k, l, icon]) => (
      <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}><Ico svg={icon} />{l}</button>))}</div>
    {tab === 'repository' && <Repository />}
    {tab === 'plans' && <Plans />}
    {tab === 'executions' && <Executions />}
    {tab === 'coverage' && <Coverage />}
  </>;
}

// ---------------------------------------------------------------- repository
function Repository() {
  const p = P();
  const r = repo(p);
  const [folder, setFolder] = useState<string>('all');
  const [q, setQ] = useState('');
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const inFolder = (t: Any) => folder === 'all' || (folder === 'none' ? !t.folderId : t.folderId === folder);
  const list = r.tests.filter(inFolder).filter((t: Any) => !q.trim() || `${t.key} ${t.title} ${t.labels?.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()));
  const tree = (parentId: string | null, depth: number): ReactNode => r.folders.filter((f: Any) => (f.parentId || null) === parentId).map((f: Any) => (
    <div key={f.id}>
      <button className={`xr-folder ${folder === f.id ? 'on' : ''}`} style={{ paddingLeft: 10 + depth * 14 }} onClick={() => setFolder(f.id)}>
        <Ico svg={I.folder} /><span>{f.name}</span><span className="count">{r.tests.filter((t: Any) => t.folderId === f.id).length}</span></button>
      {tree(f.id, depth + 1)}
    </div>));
  const addFolder = () => {
    const name = String(newFolder || '').trim();
    if (!name) { setNewFolder(null); return; }
    const parentId = folder !== 'all' && folder !== 'none' ? folder : null;
    edit((rr) => { rr.folders.push({ id: uid(), name, parentId }); });
    setNewFolder(null);
  };
  const cur = r.folders.find((f: Any) => f.id === folder);
  return (
    <div className="xr-repo">
      <aside className="xr-tree">
        <button className={`xr-folder ${folder === 'all' ? 'on' : ''}`} onClick={() => setFolder('all')}><Ico svg={I.test} /><span>All tests</span><span className="count">{r.tests.length}</span></button>
        {tree(null, 0)}
        <button className={`xr-folder ${folder === 'none' ? 'on' : ''}`} onClick={() => setFolder('none')}><Ico svg={I.doc} /><span>Not in a folder</span><span className="count">{r.tests.filter((t: Any) => !t.folderId).length}</span></button>
        {canEdit() && (newFolder !== null
          ? <div className="xr-newfolder"><TF autoFocus value={newFolder} placeholder={cur ? `Folder inside ${cur.name}` : 'Folder name'} onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e: Any) => { if (e.key === 'Enter') addFolder(); if (e.key === 'Escape') setNewFolder(null); }} onBlur={addFolder} /></div>
          : <button className="btn sm subtle" onClick={() => setNewFolder('')}><Ico svg={I.plus} />New folder{cur ? ' here' : ''}</button>)}
        {cur && canEdit() && <button className="btn sm subtle" onClick={() => openModal(<Confirm title={`Delete the folder “${cur.name}”?`} label="Delete folder"
          text="Its tests and sub-folders move up to the parent folder. No test is deleted." onYes={() => { edit((rr) => {
            rr.tests.forEach((t: Any) => { if (t.folderId === cur.id) t.folderId = cur.parentId || null; });
            rr.folders.forEach((f: Any) => { if (f.parentId === cur.id) f.parentId = cur.parentId || null; });
            rr.folders = rr.folders.filter((f: Any) => f.id !== cur.id);
          }); setFolder('all'); }} />)}><Ico svg={I.trash} />Delete folder</button>}
      </aside>
      <section className="xr-list">
        <div className="toolbar">
          <TF search sx={{ width: 260 }} placeholder="Search tests" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="spacer" />
          {canEdit() && <button className="btn sm" onClick={() => openModal(<ImportModal folderId={cur?.id || null} />)}><Ico svg={I.upload} />Import from issues</button>}
        </div>
        {list.length ? <table className="tbl"><thead><tr><th>Key</th><th>Test</th><th>Type</th><th>Steps</th><th>Issues</th><th>Latest result</th></tr></thead><tbody>
          {list.map((t: Any) => { const lr = latestRun(t.id); return (
            <tr key={t.id} className="click" onClick={() => openTest(t)}>
              <td className="key">{t.key}</td><td>{t.title}{t.labels?.length ? <span className="lbls">{t.labels.slice(0, 2).map((l: string) => <span key={l} className="label-chip">{l}</span>)}</span> : null}</td>
              <td className="muted">{t.type}</td><td className="num muted">{t.steps?.length || 0}</td>
              <td onClick={(e) => e.stopPropagation()}>{(t.issueIds || []).map((id: string) => p.tickets.find((x: Any) => x.id === id)).filter(Boolean).slice(0, 3).map((x: Any) =>
                <button key={x.id} className="link-btn key small" onClick={() => openDrawer('issue', x.id)}>{x.key}</button>)}{(t.issueIds || []).length > 3 ? <span className="muted small"> +{t.issueIds.length - 3}</span> : null}</td>
              <td>{lr ? <><RunLoz s={lr.status} /> <span className="muted small">{lr.execution.key}</span></> : <span className="muted small">Not run</span>}</td>
            </tr>); })}
        </tbody></table> : <EmptyState compact icon={I.test} tone="neutral" title={r.tests.length ? 'No tests here' : 'No tests yet'}
          actions={canEdit() && <><button className="btn primary" onClick={() => openTest(null, cur?.id)}><Ico svg={I.plus} />New test</button>
            {!r.tests.length && <button className="btn" onClick={() => openModal(<ImportModal folderId={null} />)}><Ico svg={I.upload} />Import from issues</button>}</>}>
          <p>{r.tests.length ? 'Pick another folder, or clear the search.' : 'Create reusable tests, or import the test cases your issues already have. Each test can cover several issues.'}</p></EmptyState>}
      </section>
    </div>
  );
}

/** Test cases already on issues → repository tests, linked to their issue, one folder per epic. */
function ImportModal({ folderId }: { folderId: string | null }) {
  const p = P();
  const r = repo(p);
  const done = new Set(r.tests.map((t: Any) => t.source?.tcId).filter(Boolean));
  const issues = p.tickets.filter((t: Any) => (t.testCases || []).some((c: Any) => !done.has(c.id)));
  const [pick, setPick] = useState<Record<string, boolean>>(() => Object.fromEntries(issues.map((t: Any) => [t.id, true])));
  const [byEpic, setByEpic] = useState(!folderId);
  const n = issues.filter((t: Any) => pick[t.id]).reduce((x: number, t: Any) => x + t.testCases.filter((c: Any) => !done.has(c.id)).length, 0);
  const go = () => {
    let made = 0;
    edit((rr, pp) => {
      const folderFor = (epicId: string | null) => {
        if (!byEpic) return folderId;
        const e = pp.epics.find((x: Any) => x.id === epicId);
        const name = e ? `${e.key} ${e.title}` : 'No epic';
        let f = rr.folders.find((x: Any) => x.name === name && !x.parentId);
        if (!f) { f = { id: uid(), name, parentId: null }; rr.folders.push(f); }
        return f.id;
      };
      for (const t of pp.tickets.filter((x: Any) => pick[x.id])) {
        for (const c of t.testCases || []) {
          if (done.has(c.id)) continue;
          const steps = (Array.isArray(c.steps) ? c.steps : c.steps ? [c.steps] : []).map((s: string, i: number, all: string[]) => ({ id: uid(), action: s, data: '', expected: i === all.length - 1 ? c.expected || '' : '' }));
          rr.tests.push({ id: uid(), key: nextKey(rr, pp, 't'), title: c.title, type: c.script ? 'Automated' : 'Manual', folderId: folderFor(t.epicId || null), priority: c.priority || 'Medium', labels: [c.type].filter(Boolean),
            preconditions: c.preconditions || '', steps, issueIds: [t.id], source: { ticketId: t.id, tcId: c.id }, createdAt: nowIso(), createdBy: me() });
          made++;
        }
      }
    });
    closeModal();
    toast(`${made} test${made === 1 ? '' : 's'} added to the repository, each linked to its issue.`, 'ok', { title: 'Tests imported' });
  };
  return (
    <Modal title="Import test cases from issues" wide actions={[{ label: 'Cancel' }, { label: `Import ${n} test${n === 1 ? '' : 's'}`, kind: 'primary', disabled: !n, onClick: go }]}>
      <p className="muted small" style={{ marginTop: 0 }}>Each test case on the picked issues becomes a reusable test in the repository, linked to its issue (its steps and expected result carry over). The issues keep their own test cases. Test cases imported before are skipped.</p>
      <CB label="One folder per epic" checked={byEpic} onChange={(e: Any) => setByEpic(e.target.checked)} />
      <div className="split-list">{issues.map((t: Any) => (
        <label key={t.id} className={`split-row ${pick[t.id] ? '' : 'off'}`}>
          <CB checked={Boolean(pick[t.id])} onChange={() => setPick({ ...pick, [t.id]: !pick[t.id] })} aria-label={`Import ${t.key}`} />
          <TypeIcon type={t.type} /><span className="key">{t.key}</span><span className="split-title">{t.title}</span>
          <span className="muted small">{t.testCases.filter((c: Any) => !done.has(c.id)).length} test cases</span></label>))}
        {!issues.length && <p className="muted small" style={{ padding: 10 }}>Every test case is already in the repository.</p>}</div>
    </Modal>
  );
}

// ---------------------------------------------------------------- one test
export function openTest(test: Any | null, folderId?: string | null, issueId?: string) { openModal(<TestModal test={test} folderId={folderId || null} issueId={issueId} />); }
function TestModal({ test, folderId, issueId }: { test: Any | null; folderId: string | null; issueId?: string }) {
  const p = P();
  const r = repo(p);
  const [d, setD] = useState<Any>(() => test ? JSON.parse(JSON.stringify(test)) : { title: '', type: 'Manual', folderId, priority: 'Medium', labels: [], preconditions: '', steps: [{ id: uid(), action: '', data: '', expected: '' }], issueIds: issueId ? [issueId] : [] });
  const [addIssue, setAddIssue] = useState('');
  const ed = canEdit();
  const set = (k: string, v: Any) => setD({ ...d, [k]: v });
  const setStep = (i: number, k: string, v: string) => setD({ ...d, steps: d.steps.map((s: Any, j: number) => (j === i ? { ...s, [k]: v } : s)) });
  const move = (i: number, by: number) => { const st = [...d.steps]; const [x] = st.splice(i, 1); st.splice(i + by, 0, x); set('steps', st); };
  const save = () => {
    if (!d.title.trim()) { toast('Give the test a title.', 'err'); return; }
    const clean = { ...d, title: d.title.trim(), steps: d.steps.filter((s: Any) => s.action.trim() || s.expected.trim()) };
    edit((rr, pp) => {
      if (test) { const i = rr.tests.findIndex((x: Any) => x.id === test.id); if (i >= 0) rr.tests[i] = { ...rr.tests[i], ...clean, updatedAt: nowIso() }; }
      else rr.tests.push({ ...clean, id: uid(), key: nextKey(rr, pp, 't'), createdAt: nowIso(), createdBy: me() });
    });
    closeModal(); toast(test ? `${test.key} saved` : 'Test created');
  };
  const runs = test ? r.executions.filter((e: Any) => e.runs?.[test.id]).sort((a: Any, b: Any) => String(b.createdAt).localeCompare(String(a.createdAt))) : [];
  const issues = (d.issueIds || []).map((id: string) => p.tickets.find((x: Any) => x.id === id)).filter(Boolean);
  return (
    <Modal title={test ? `${test.key} · ${test.title}` : 'New test'} wide persistent actions={[
      ...(test && ed ? [{ label: 'Delete', kind: 'danger' as const, onClick: () => openModal(<Confirm title={`Delete ${test.key}?`} label="Delete test" text="It’s removed from the repository, its plans and executions (their other results stay)."
        onYes={() => { edit((rr) => { rr.tests = rr.tests.filter((x: Any) => x.id !== test.id); rr.plans.forEach((pl: Any) => { pl.testIds = pl.testIds.filter((x: string) => x !== test.id); }); rr.executions.forEach((e: Any) => { e.testIds = e.testIds.filter((x: string) => x !== test.id); delete e.runs?.[test.id]; }); }); toast(`${test.key} deleted`); }} />) }] : []),
      { label: 'Cancel' }, ...(ed ? [{ label: test ? 'Save' : 'Create test', kind: 'primary' as const, onClick: save }] : [])]}>
      <div className="grid2">
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Title</span><TF autoFocus={!test} disabled={!ed} value={d.title} placeholder="e.g. Approve a salary proposal as the assigned approver" onChange={(e) => set('title', e.target.value)} /></label>
        <label className="field"><span>Type</span><SF disabled={!ed} value={d.type} onChange={(e) => set('type', e.target.value)}>{TEST_TYPES.map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>)}</SF></label>
        <label className="field"><span>Folder</span><SF disabled={!ed} value={d.folderId || ''} onChange={(e) => set('folderId', e.target.value || null)}><MenuItem value="">Not in a folder</MenuItem>
          {r.folders.map((f: Any) => <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>)}</SF></label>
        <label className="field"><span>Priority</span><SF disabled={!ed} value={d.priority} onChange={(e) => set('priority', e.target.value)}>{['High', 'Medium', 'Low'].map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>)}</SF></label>
        <label className="field"><span>Labels</span><TF disabled={!ed} value={(d.labels || []).join(', ')} placeholder="e.g. regression, smoke" onChange={(e) => set('labels', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></label>
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Preconditions</span><TA disabled={!ed} rows={2} value={d.preconditions} placeholder="e.g. Signed in as HR; a pending proposal exists" onChange={(e) => set('preconditions', e.target.value)} /></label>
      </div>
      <h4 className="sync-h">Steps</h4>
      <table className="tbl xr-steps"><thead><tr><th style={{ width: 28 }}>#</th><th>Action</th><th>Data</th><th>Expected result</th>{ed && <th style={{ width: 80 }} />}</tr></thead><tbody>
        {d.steps.map((s: Any, i: number) => (
          <tr key={s.id}><td className="muted">{i + 1}</td>
            <td><TA disabled={!ed} rows={1} value={s.action} placeholder="What to do" onChange={(e) => setStep(i, 'action', e.target.value)} /></td>
            <td><TA disabled={!ed} rows={1} value={s.data} placeholder="Test data" onChange={(e) => setStep(i, 'data', e.target.value)} /></td>
            <td><TA disabled={!ed} rows={1} value={s.expected} placeholder="What should happen" onChange={(e) => setStep(i, 'expected', e.target.value)} /></td>
            {ed && <td style={{ whiteSpace: 'nowrap' }}>
              <button className="icon-btn" disabled={i === 0} title="Move up" aria-label="Move step up" onClick={() => move(i, -1)}><Ico svg={I.up} /></button>
              <button className="icon-btn" disabled={i === d.steps.length - 1} title="Move down" aria-label="Move step down" onClick={() => move(i, 1)}><Ico svg={I.down} /></button>
              <button className="icon-btn" title="Remove step" aria-label="Remove step" onClick={() => set('steps', d.steps.filter((_: Any, j: number) => j !== i))}><Ico svg={I.trash} /></button></td>}
          </tr>))}
      </tbody></table>
      {ed && <button className="btn sm subtle" onClick={() => set('steps', [...d.steps, { id: uid(), action: '', data: '', expected: '' }])}><Ico svg={I.plus} />Add step</button>}
      <h4 className="sync-h">Covers these issues</h4>
      <div className="row" style={{ gap: 6 }}>
        {issues.map((x: Any) => <span key={x.id} className="xr-issue"><TypeIcon type={x.type} /><button className="link-btn" onClick={() => openDrawer('issue', x.id)}>{x.key}</button> {x.title.slice(0, 40)}
          {ed && <button className="icon-btn" aria-label={`Unlink ${x.key}`} onClick={() => set('issueIds', d.issueIds.filter((id: string) => id !== x.id))}><Ico svg={I.close} /></button>}</span>)}
        {!issues.length && <span className="muted small">Not linked to any issue yet.</span>}
        {ed && <SF filter value={addIssue} onChange={(e) => { if (e.target.value) set('issueIds', [...new Set([...(d.issueIds || []), e.target.value])]); setAddIssue(''); }} aria-label="Link an issue">
          <MenuItem value="">+ Link an issue</MenuItem>{p.tickets.filter((x: Any) => !isSub(x) && !d.issueIds?.includes(x.id)).map((x: Any) => <MenuItem key={x.id} value={x.id}>{x.key} {x.title.slice(0, 60)}</MenuItem>)}</SF>}
      </div>
      {test && <><h4 className="sync-h">Execution history</h4>
        {runs.length ? <ul className="xr-history small">{runs.map((e: Any) => <li key={e.id}><RunLoz s={e.runs[test.id].status} /> <b>{e.key}</b> {e.title}<span className="muted"> · {e.runs[test.id].by || '—'}{e.runs[test.id].at ? ` · ${new Date(e.runs[test.id].at).toLocaleString()}` : ''}</span>
          {e.runs[test.id].comment && <div className="muted">“{e.runs[test.id].comment}”</div>}</li>)}</ul> : <p className="muted small">Not in any execution yet.</p>}</>}
    </Modal>
  );
}

// ---------------------------------------------------------------- plans
function Plans() {
  const p = P();
  const r = repo(p);
  if (!r.plans.length) return <EmptyState icon={I.epic} tone="neutral" title="No test plans yet" actions={canEdit() && <button className="btn primary" onClick={() => openModal(<PlanModal plan={null} />)}><Ico svg={I.plus} />New test plan</button>}>
    <p>A test plan groups the tests for a goal (an epic, a sprint, a release) and shows how far its executions got.</p></EmptyState>;
  return <div className="xr-cards">{r.plans.map((pl: Any) => {
    const st = pl.testIds.map((id: string) => latestPlanStatus(pl, id));
    const c = counts(st);
    const ex = r.executions.filter((e: Any) => e.planId === pl.id);
    const epic = p.epics.find((e: Any) => e.id === pl.epicId);
    return (
      <div key={pl.id} className="xr-card" role="button" tabIndex={0} onClick={() => openModal(<PlanModal plan={pl} />)} onKeyDown={(e) => { if (e.key === 'Enter') openModal(<PlanModal plan={pl} />); }}>
        <div className="xr-card-h"><span className="key">{pl.key}</span><b>{pl.title}</b></div>
        <div className="muted small">{pl.testIds.length} tests · {ex.length} execution{ex.length === 1 ? '' : 's'}{epic ? ` · ${epic.key} ${epic.title}` : ''}</div>
        <StatusBar statuses={st} />
        <div className="small">{c.PASSED} passed · {c.FAILED} failed · {c.BLOCKED} blocked · {c.TODO + c.EXECUTING} to do</div>
      </div>);
  })}</div>;
}
/** A test's latest result within a plan's executions. */
function latestPlanStatus(pl: Any, testId: string) {
  const runs = repo().executions.filter((e: Any) => e.planId === pl.id && e.runs?.[testId] && e.runs[testId].status !== 'TODO')
    .sort((a: Any, b: Any) => String(b.runs[testId].at || b.createdAt).localeCompare(String(a.runs[testId].at || a.createdAt)));
  return runs[0]?.runs[testId].status || 'TODO';
}
function PlanModal({ plan }: { plan: Any | null }) {
  const p = P();
  const r = repo(p);
  const [d, setD] = useState<Any>(() => plan ? { ...plan, testIds: [...plan.testIds] } : { title: '', description: '', epicId: '', sprintId: '', testIds: [] });
  const [folder, setFolder] = useState('all');
  const ed = canEdit();
  const pool = r.tests.filter((t: Any) => folder === 'all' || (folder === 'epic' ? (t.issueIds || []).some((id: string) => p.tickets.find((x: Any) => x.id === id)?.epicId === d.epicId) : t.folderId === folder));
  const toggle = (id: string) => setD({ ...d, testIds: d.testIds.includes(id) ? d.testIds.filter((x: string) => x !== id) : [...d.testIds, id] });
  const save = (thenRun = false) => {
    if (!d.title.trim()) { toast('Give the plan a title.', 'err'); return; }
    let saved: Any = null;
    edit((rr, pp) => {
      if (plan) { const i = rr.plans.findIndex((x: Any) => x.id === plan.id); rr.plans[i] = { ...rr.plans[i], ...d, title: d.title.trim() }; saved = rr.plans[i]; }
      else { saved = { ...d, title: d.title.trim(), id: uid(), key: nextKey(rr, pp, 'tp'), createdAt: nowIso(), createdBy: me() }; rr.plans.push(saved); }
    });
    closeModal();
    if (thenRun && saved) createExecution({ title: `${saved.title} — run ${repo().executions.filter((e: Any) => e.planId === saved.id).length + 1}`, planId: saved.id, testIds: saved.testIds });
    else toast(plan ? `${plan.key} saved` : 'Test plan created');
  };
  return (
    <Modal title={plan ? `${plan.key} · ${plan.title}` : 'New test plan'} wide persistent actions={[
      ...(plan && ed ? [{ label: 'Delete', kind: 'danger' as const, onClick: () => openModal(<Confirm title={`Delete ${plan.key}?`} label="Delete plan" text="The plan is removed. Its executions and their results stay." onYes={() => { edit((rr) => { rr.plans = rr.plans.filter((x: Any) => x.id !== plan.id); rr.executions.forEach((e: Any) => { if (e.planId === plan.id) e.planId = null; }); }); }} />) }] : []),
      { label: 'Cancel' }, ...(ed ? [{ label: 'Save', onClick: () => save(false) }, { label: 'Save and run', kind: 'primary' as const, disabled: !d.testIds.length, onClick: () => save(true) }] : [])]}>
      <div className="grid2">
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Title</span><TF autoFocus={!plan} disabled={!ed} value={d.title} placeholder="e.g. Salary management — release 1.7 regression" onChange={(e) => setD({ ...d, title: e.target.value })} /></label>
        <label className="field"><span>Epic (optional)</span><SF disabled={!ed} value={d.epicId || ''} onChange={(e) => setD({ ...d, epicId: e.target.value })}><MenuItem value="">None</MenuItem>{p.epics.map((e: Any) => <MenuItem key={e.id} value={e.id}>{e.key} {e.title}</MenuItem>)}</SF></label>
        <label className="field"><span>Sprint (optional)</span><SF disabled={!ed} value={d.sprintId || ''} onChange={(e) => setD({ ...d, sprintId: e.target.value })}><MenuItem value="">None</MenuItem>{p.sprints.map((s: Any) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}</SF></label>
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Description</span><TA disabled={!ed} rows={2} value={d.description || ''} onChange={(e) => setD({ ...d, description: e.target.value })} /></label>
      </div>
      <div className="row split-tools"><b className="small">Tests in the plan ({d.testIds.length})</b><span className="spacer" />
        <SF filter value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Show tests from">
          <MenuItem value="all">All tests</MenuItem>{d.epicId && <MenuItem value="epic">Tests covering the epic’s issues</MenuItem>}{r.folders.map((f: Any) => <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>)}</SF>
        {ed && <button className="btn sm subtle" onClick={() => setD({ ...d, testIds: [...new Set([...d.testIds, ...pool.map((t: Any) => t.id)])] })}>Add all shown ({pool.length})</button>}</div>
      <div className="split-list">{pool.map((t: Any) => (
        <label key={t.id} className={`split-row ${d.testIds.includes(t.id) ? '' : 'off'}`}>
          <CB disabled={!ed} checked={d.testIds.includes(t.id)} onChange={() => toggle(t.id)} aria-label={`Include ${t.key}`} />
          <span className="key">{t.key}</span><span className="split-title">{t.title}</span><RunLoz s={plan ? latestPlanStatus(plan, t.id) : latestStatus(t.id)} /></label>))}
        {!pool.length && <p className="muted small" style={{ padding: 10 }}>No tests here.</p>}</div>
    </Modal>
  );
}

// ---------------------------------------------------------------- executions
function createExecution({ title, planId, testIds, environment = '' }: { title: string; planId: string | null; testIds: string[]; environment?: string }) {
  let created: Any = null;
  edit((rr, pp) => {
    created = { id: uid(), key: nextKey(rr, pp, 'te'), title, planId, testIds: [...testIds], environment, assignee: me(), runs: Object.fromEntries(testIds.map((id) => [id, { status: 'TODO', steps: {}, comment: '', defectIds: [] }])), createdAt: nowIso(), createdBy: me() };
    rr.executions.push(created);
  });
  S.trTab = 'executions'; emit();
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
    <Modal title="New test execution" actions={[{ label: 'Cancel' }, { label: `Start with ${ids.length} test${ids.length === 1 ? '' : 's'}`, kind: 'primary', disabled: !ids.length, onClick: () => { closeModal(); createExecution({ title: title.trim() || `${pl ? pl.title : 'All tests'} — ${new Date().toLocaleDateString()}`, planId: pl?.id || null, testIds: ids, environment: env.trim() }); } }]}>
      <label className="field"><span>From</span><SF value={planId} onChange={(e) => setPlanId(e.target.value)}>{r.plans.map((x: Any) => <MenuItem key={x.id} value={x.id}>{x.key} {x.title} ({x.testIds.length})</MenuItem>)}<MenuItem value="">All tests in the repository ({r.tests.length})</MenuItem></SF></label>
      <label className="field"><span>Title (optional)</span><TF value={title} placeholder={`${pl ? pl.title : 'All tests'} — ${new Date().toLocaleDateString()}`} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="field"><span>Environment (optional)</span><TF value={env} placeholder="e.g. staging, Chrome" onChange={(e) => setEnv(e.target.value)} /></label>
    </Modal>
  );
}
function Executions() {
  const r = repo();
  if (!r.executions.length) return <EmptyState icon={I.play} tone="neutral" title="No test executions yet" actions={canEdit() && r.tests.length > 0 && <button className="btn primary" onClick={() => openModal(<NewExecutionModal />)}><Ico svg={I.plus} />New execution</button>}>
    <p>An execution runs a set of tests (usually a plan’s) and records each one as Passed, Failed or Blocked, step by step, with defects.</p></EmptyState>;
  const list = [...r.executions].sort((a: Any, b: Any) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return <table className="tbl"><thead><tr><th>Key</th><th>Execution</th><th>Plan</th><th>Environment</th><th>Progress</th><th>Results</th><th>By</th></tr></thead><tbody>
    {list.map((e: Any) => { const st = e.testIds.map((id: string) => e.runs?.[id]?.status || 'TODO'); const c = counts(st); const pl = r.plans.find((x: Any) => x.id === e.planId); return (
      <tr key={e.id} className="click" onClick={() => openExecution(e.id)}>
        <td className="key">{e.key}</td><td>{e.title}</td><td className="muted">{pl ? pl.key : '—'}</td><td className="muted">{e.environment || '—'}</td>
        <td style={{ width: 180 }}><StatusBar statuses={st} /></td>
        <td className="small">{c.PASSED} ✓ · {c.FAILED} ✗ · {c.BLOCKED} ⦸ · {c.TODO + c.EXECUTING} to do</td><td className="muted small">{e.assignee || e.createdBy}</td>
      </tr>); })}
  </tbody></table>;
}

export const openExecution = (id: string, testId?: string) => openModal(<ExecutionModal id={id} startAt={testId} />);
function ExecutionModal({ id, startAt }: { id: string; startAt?: string }) {
  useStore(); // a dialog doesn't redraw with the page: follow the project so results show as they're marked
  const p = P();
  const r = repo(p);
  const e = r.executions.find((x: Any) => x.id === id);
  const [cur, setCur] = useState<string | null>(startAt || e?.testIds.find((t: string) => e.runs?.[t]?.status !== 'PASSED') || e?.testIds[0] || null);
  if (!e) return <Modal title="Execution not found"><p>It may have been deleted.</p></Modal>;
  const ed = canEdit();
  const test = r.tests.find((t: Any) => t.id === cur);
  const run = cur ? e.runs?.[cur] || { status: 'TODO', steps: {}, comment: '', defectIds: [] } : null;
  const setRun = (patch: Any, tag?: string) => edit((rr) => {
    const ex = rr.executions.find((x: Any) => x.id === id);
    if (!ex || !cur) return;
    ex.runs = ex.runs || {};
    ex.runs[cur] = { status: 'TODO', steps: {}, comment: '', defectIds: [], ...(ex.runs[cur] || {}), ...patch, at: nowIso(), by: me() };
  }, tag);
  const setStep = (stepId: string, st: string) => {
    const steps = { ...(run.steps || {}), [stepId]: st };
    setRun({ steps, status: runStatusFromSteps(steps, test?.steps?.length || 0) });
  };
  const createDefect = () => {
    if (!test) return;
    const failed = (test.steps || []).map((s: Any, i: number) => ({ s, i, st: run.steps?.[s.id] })).filter((x: Any) => x.st === 'FAILED');
    const linked = (test.issueIds || []).map((x: string) => p.tickets.find((t: Any) => t.id === x)).filter(Boolean);
    let bug: Any = null;
    mutate((pp: Any) => {
      bug = newTicket({ type: 'Bug', priority: test.priority === 'High' ? 'High' : 'Medium', epicId: linked[0]?.epicId || null, labels: ['defect'],
        title: `${test.title}: fails${failed[0] ? ` at step ${failed[0].i + 1}` : ''}`.slice(0, 120),
        description: [`Found while running ${test.key} in ${e.key} (${e.title})${e.environment ? ` on ${e.environment}` : ''}.`,
          test.preconditions && `Preconditions: ${test.preconditions}`,
          `Steps:\n${(test.steps || []).map((s: Any, i: number) => `${i + 1}. ${s.action}${s.data ? ` (${s.data})` : ''} → expected: ${s.expected || '—'}${run.steps?.[s.id] === 'FAILED' ? '  ✗ FAILED' : ''}`).join('\n')}`,
          run.comment && `Tester’s note: ${run.comment}`].filter(Boolean).join('\n\n') });
      pp.tickets.push(bug);
      for (const l of linked) { const t = pp.tickets.find((x: Any) => x.id === l.id); if (t) addLink(t, 'is blocked by', bug); }
      logEvent(bug, `defect from ${test.key} in ${e.key}`, 'Test management');
      const ex = pp.testRepo.executions.find((x: Any) => x.id === id);
      ex.runs[cur!] = { ...ex.runs[cur!], defectIds: [...(ex.runs[cur!]?.defectIds || []), bug.id] };
    });
    toast(`${bug.key} created and linked to the run${linked.length ? ` and to ${linked.map((x: Any) => x.key).join(', ')}` : ''}.`, 'ok', { title: 'Defect created', action: { label: 'Open', onClick: () => openDrawer('issue', bug.id) } });
  };
  const st = e.testIds.map((t: string) => e.runs?.[t]?.status || 'TODO');
  const idx = e.testIds.indexOf(cur || '');
  return (
    <Modal title={`${e.key} · ${e.title}`} wide persistent actions={[
      ...(ed ? [{ label: 'Delete execution', kind: 'danger' as const, onClick: () => openModal(<Confirm title={`Delete ${e.key}?`} label="Delete" text="Its results are removed. Defects created from it stay." onYes={() => edit((rr) => { rr.executions = rr.executions.filter((x: Any) => x.id !== id); })} />) }] : []),
      { label: 'Close' }]}>
      <div className="xr-exec-head"><StatusBar statuses={st} /><span className="small muted">{counts(st).PASSED} passed · {counts(st).FAILED} failed · {counts(st).BLOCKED} blocked · {counts(st).TODO + counts(st).EXECUTING} to do{e.environment ? ` · ${e.environment}` : ''}</span></div>
      <div className="xr-exec">
        <ul className="xr-exec-list">{e.testIds.map((tid: string) => { const t = r.tests.find((x: Any) => x.id === tid); return t && (
          <li key={tid}><button className={cur === tid ? 'on' : ''} onClick={() => setCur(tid)}><RunLoz s={e.runs?.[tid]?.status || 'TODO'} /><span className="key">{t.key}</span><span className="split-title">{t.title}</span></button></li>); })}</ul>
        <div className="xr-exec-run">
          {!test ? <p className="muted">Pick a test.</p> : <>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}><span className="key">{test.key}</span><b style={{ flex: 1 }}>{test.title}</b>
              <SF disabled={!ed} value={run.status} onChange={(ev) => setRun({ status: ev.target.value })} aria-label="Result">{RUN_STATUS.map((s) => <MenuItem key={s} value={s}>{STATUS_LABEL[s]}</MenuItem>)}</SF></div>
            {test.preconditions && <p className="small"><b>Preconditions:</b> {test.preconditions}</p>}
            <table className="tbl xr-steps"><thead><tr><th>#</th><th>Action</th><th>Data</th><th>Expected</th><th>Result</th></tr></thead><tbody>
              {(test.steps || []).map((s: Any, i: number) => { const v = run.steps?.[s.id] || 'TODO'; return (
                <tr key={s.id} className={`xr-step-${v.toLowerCase()}`}><td className="muted">{i + 1}</td><td>{s.action}</td><td className="muted">{s.data}</td><td>{s.expected}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{ed ? (['PASSED', 'FAILED', 'BLOCKED'] as const).map((x) => <button key={x} className={`xr-stepbtn ${v === x ? `on xr-${x.toLowerCase()}` : ''}`} title={STATUS_LABEL[x]} aria-pressed={v === x}
                    onClick={() => setStep(s.id, v === x ? 'TODO' : x)}>{x === 'PASSED' ? '✓' : x === 'FAILED' ? '✗' : '⦸'}</button>) : <RunLoz s={v} />}</td></tr>); })}
              {!(test.steps || []).length && <tr><td colSpan={5} className="muted small">This test has no steps: set its result above.</td></tr>}
            </tbody></table>
            <label className="field"><span>Comment / evidence</span><TA disabled={!ed} rows={2} value={run.comment || ''} placeholder="What you saw, links to screenshots or logs" onChange={(ev) => setRun({ comment: ev.target.value }, `xr-c-${id}-${cur}`)} /></label>
            <div className="row" style={{ gap: 8 }}>
              {(run.defectIds || []).map((did: string) => { const b = p.tickets.find((x: Any) => x.id === did); return b && <span key={did} className="xr-issue"><TypeIcon type="Bug" /><button className="link-btn" onClick={() => openDrawer('issue', b.id)}>{b.key}</button><StatusLoz s={b.status} /></span>; })}
              {ed && can('issue.create') && ['FAILED', 'BLOCKED'].includes(run.status) && <button className="btn sm" onClick={createDefect}><Ico svg={I.plus} />Create defect</button>}
              <span className="spacer" />
              <button className="btn sm subtle" disabled={idx <= 0} onClick={() => setCur(e.testIds[idx - 1])}>Previous</button>
              <button className="btn sm primary" disabled={idx >= e.testIds.length - 1} onClick={() => setCur(e.testIds[idx + 1])}>Next test</button>
            </div>
          </>}
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
  const rows = p.tickets.filter((t: Any) => !isSub(t) && (!epic || t.epicId === epic)).map((t: Any) => ({ t, ...coverageOf(t.id) })).filter((x: Any) => !only || x.status === only);
  const all = p.tickets.filter((t: Any) => !isSub(t) && (!epic || t.epicId === epic)).map((t: Any) => coverageOf(t.id).status);
  const n = (s: string) => all.filter((x: string) => x === s).length;
  return <>
    <div className="toolbar">
      <SF filter value={epic} onChange={(e) => setEpic(e.target.value)} aria-label="Epic"><MenuItem value="">All epics</MenuItem>{p.epics.map((e: Any) => <MenuItem key={e.id} value={e.id}>{e.key} {e.title}</MenuItem>)}</SF>
      {(['OK', 'NOK', 'NOTRUN', 'UNCOVERED'] as const).map((s) => <button key={s} className={`xr-covfilter ${only === s ? 'on' : ''}`} onClick={() => setOnly(only === s ? '' : s)}><CovLoz s={s} /> {n(s)}</button>)}
    </div>
    <table className="tbl"><thead><tr><th>Issue</th><th>Status</th><th>Tests</th><th>Coverage</th></tr></thead><tbody>
      {rows.map(({ t, status, tests }: Any) => (
        <tr key={t.id} className="click" onClick={() => openDrawer('issue', t.id)}>
          <td><span className="row" style={{ flexWrap: 'nowrap' }}><TypeIcon type={t.type} /><span className="key">{t.key}</span><span>{t.title}</span></span></td>
          <td><StatusLoz s={t.status} /></td>
          <td style={{ width: 200 }}>{tests.length ? <StatusBar statuses={tests.map((x: Any) => latestStatus(x.id))} /> : <span className="muted small">No tests</span>}</td>
          <td><CovLoz s={status} /> <span className="muted small">{tests.length || ''}</span></td>
        </tr>))}
    </tbody></table>
  </>;
}

// ---------------------------------------------------------------- the issue panel: its tests
/** Issue panel → Tests: the repository tests that cover this issue, their latest results, and linking. */
export function TestsSection({ t }: { t: Any }) {
  const p = P();
  const r = repo(p);
  const cov = coverageOf(t.id);
  const [link, setLink] = useState('');
  const ed = canEdit();
  return (
    <div className="sec"><div className="sec-title"><Ico svg={I.test} /><h3>Tests</h3><span className="count">{cov.tests.length}</span><CovLoz s={cov.status} />
      {ed && <div className="tools">
        <SF filter value={link} onChange={(e) => { const id = e.target.value; setLink(''); if (id) edit((rr) => { const x = rr.tests.find((y: Any) => y.id === id); if (x) x.issueIds = [...new Set([...(x.issueIds || []), t.id])]; }); }} aria-label="Link a test">
          <MenuItem value="">Link a test</MenuItem>{r.tests.filter((x: Any) => !x.issueIds?.includes(t.id)).map((x: Any) => <MenuItem key={x.id} value={x.id}>{x.key} {x.title.slice(0, 60)}</MenuItem>)}</SF>
        <button className="btn sm subtle" onClick={() => openTest(null, null, t.id)}><Ico svg={I.plus} />New test</button></div>}</div>
      {cov.tests.length ? <div className="xr-ttests">{cov.tests.map((x: Any) => { const lr = latestRun(x.id); return (
        <div key={x.id} className="xr-trow">
          <button className="link-btn key" onClick={() => openTest(x)}>{x.key}</button><span className="split-title">{x.title}</span>
          {lr ? <button className="link-btn small" title={`In ${lr.execution.key}`} onClick={() => openExecution(lr.execution.id, x.id)}><RunLoz s={lr.status} /></button> : <RunLoz s="TODO" />}
          {ed && <button className="icon-btn" title="Unlink from this issue" aria-label={`Unlink ${x.key}`} onClick={() => edit((rr) => { const y = rr.tests.find((z: Any) => z.id === x.id); if (y) y.issueIds = y.issueIds.filter((id: string) => id !== t.id); })}><Ico svg={I.close} /></button>}
        </div>); })}</div>
        : <p className="muted small">No repository tests cover this issue yet. Link one, create one, or import this issue’s test cases in Test management.</p>}
    </div>
  );
}
