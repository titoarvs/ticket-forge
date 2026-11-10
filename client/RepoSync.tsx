'use client';
// Test automation: "Sync with the repository" (lib/reposync.js) and the Playwright run settings.
// Sync reads the project's local repository: its pages, what changed since the last sync, the test cases those changes
// affect, and features already delivered. Everything comes back as a review; nothing changes until you apply it.
import { useState } from 'react';
import { S, P, api, mutate, toast, openModal, closeModal, can, uid, ago, readNdjson, aiBody, startTask, setField, logEvent, newTicket, newTest, me, type Any } from './core';
import { Ico, I, Modal, Spinner } from './ui';
import { TF, SF, CB, MenuItem } from './fields';
import { appSetup } from './AppSetup';

const doneStatus = () => P().workflow.find((w: Any) => w.category === 'done')?.name || 'Done';
const stepsOf = (s: Any) => (Array.isArray(s) ? s : s ? [String(s)] : []);
let running = false;

// ---------------------------------------------------------------- sync card (Test automation → App setup)
export function RepoSyncCard() {
  const p = P();
  const dir = p.dev?.localPath || (appSetup(p).source?.kind === 'folder' ? appSetup(p).source.location : '');
  const last = p.automation?.repoSync;
  const canRun = can('project.settings');
  const [opts, setOpts] = useState({ testCases: can('ai.use'), backlog: can('ai.use') && can('issue.create') });
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (running) { toast('A repository sync is already running. See the tray.', 'info'); return; }
    running = true; setBusy(true); setLog([]);
    const ctrl = new AbortController();
    const task = startTask('Syncing with the repository', { detail: dir, kind: 'test', cancel: () => ctrl.abort() });
    try {
      const res = await api(`/api/projects/${p.id}/reposync`, { method: 'POST', raw: true, signal: ctrl.signal, body: aiBody(opts) });
      let out: Any = null;
      await readNdjson(res, (ev) => {
        if (ev.type === 'progress') { setLog((l) => [...l, ev.message]); task.update({ detail: ev.message.replace(/…$/, '') }); }
        else if (ev.type === 'done') out = ev.result;
        else if (ev.type === 'error') throw new Error(ev.error);
      });
      if (!out) throw new Error('The sync returned nothing.');
      task.finish('Ready to review');
      openModal(<SyncReview r={out} />);
    } catch (e: Any) {
      if (e.name === 'AbortError') { task.fail(''); toast('Nothing was changed.', 'info', { title: 'Repository sync stopped' }); }
      else task.fail(`Repository sync failed: ${e.message}`);
    } finally { running = false; setBusy(false); }
  };
  const writeTests = async () => {
    if (running) { toast('A repository job is already running. See the tray.', 'info'); return; }
    running = true; setBusy(true); setLog([]);
    const ctrl = new AbortController();
    const task = startTask('Writing test cases from the code', { detail: dir, kind: 'test', cancel: () => ctrl.abort() });
    try {
      const res = await api(`/api/projects/${p.id}/reposync`, { method: 'POST', raw: true, signal: ctrl.signal, body: aiBody({ mode: 'pageTests' }) });
      let out: Any = null;
      await readNdjson(res, (ev) => {
        if (ev.type === 'progress') {
          setLog((l) => [...l.filter((x) => !/^Reading .* and writing its test cases/.test(x)), ev.message]);
          const m = ev.message.match(/(\d+)\/(\d+)$/);
          task.update({ detail: ev.message.replace(/ \d+\/\d+$/, '').replace(/…$/, ''), ...(m ? { done: Number(m[1]), total: Number(m[2]) } : {}) });
        } else if (ev.type === 'done') out = ev.result;
        else if (ev.type === 'error') throw new Error(ev.error);
      });
      if (!out) throw new Error('Nothing came back.');
      task.finish(`${out.pages.reduce((n: number, x: Any) => n + x.testCases.length, 0)} test cases ready to review`);
      openModal(<PageTestsReview r={out} />);
    } catch (e: Any) {
      if (e.name === 'AbortError') { task.fail(''); toast('Nothing was changed.', 'info', { title: 'Stopped writing test cases' }); }
      else task.fail(`Couldn’t write test cases from the code: ${e.message}`);
    } finally { running = false; setBusy(false); }
  };
  return (
    <div className="as-sec repo-sync">
      <div className="repo-sync-h">
        <Ico svg={I.pr} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <b>Sync with the repository</b>
          <div className="muted small">{dir
            ? <>{dir}{last ? <> · last synced {ago(last.at)} at <code>{String(last.sha).slice(0, 7)}</code> on {last.branch}{last.pages != null ? ` · ${last.pages} pages` : ''}</> : ' · never synced'}</>
            : <>Set the local repository folder in <b>Project settings → Code &amp; GitHub</b> first.</>}</div>
        </div>
        <button className="btn ai sm" disabled={!dir || !can('ai.use') || !can('issue.edit') || busy} onClick={writeTests} title="Write test cases for every existing page from its code, for review">
          <Ico svg={I.sparkle} />Write test cases from the code</button>
        <button className="btn primary sm" disabled={!dir || !canRun || busy} onClick={run}>{busy ? <><Spinner />Working…</> : last ? 'Sync again' : 'Sync now'}</button>
      </div>
      <p className="muted small" style={{ margin: '6px 0' }}>Reads the code on this computer: adds the app’s pages, finds the pages that changed since the last sync, updates the test cases those changes affect, and puts features that are already built in the backlog as {doneStatus()}. You review everything before it’s applied.</p>
      <div className="row" style={{ gap: 16 }}>
        <CB label="Update test cases for changed pages" disabled={!can('ai.use') || busy} checked={opts.testCases} onChange={(e: Any) => setOpts({ ...opts, testCases: e.target.checked })} />
        <CB label={`Add already-built features to the backlog as ${doneStatus()}`} disabled={!can('ai.use') || !can('issue.create') || busy} checked={opts.backlog} onChange={(e: Any) => setOpts({ ...opts, backlog: e.target.checked })} />
      </div>
      {log.length > 0 && <ol className="sync-log small">{log.map((l, i) => <li key={i} className={i === log.length - 1 && busy ? 'now' : ''}>{i === log.length - 1 && busy ? <Spinner /> : <Ico svg={I.check} />}{l}</li>)}</ol>}
    </div>
  );
}

// ---------------------------------------------------------------- review
function SyncReview({ r }: { r: Any }) {
  const p = P();
  const a = appSetup(p);
  const have = new Map(a.pages.map((pg: Any) => [pg.path, pg]));
  const inCode = new Set(r.pages.map((pg: Any) => pg.path));
  const newPages = r.pages.filter((pg: Any) => !have.has(pg.path));
  const changedPages = r.pages.filter((pg: Any) => pg.changedFiles.length);
  const gone = a.pages.filter((pg: Any) => pg.fromCode && !inCode.has(pg.path));
  const [tab, setTab] = useState(() => (r.tests.updates.length || r.tests.additions.length ? 'tests' : r.built.done.length || r.built.newIssues.length ? 'backlog' : 'pages'));
  const on = (list: Any[], key: (x: Any) => string, init = true) => Object.fromEntries(list.map((x) => [key(x), init]));
  const [pick, setPick] = useState<Record<string, boolean>>(() => ({
    ...on(newPages, (x) => `page:${x.path}`), ...on(gone, (x) => `gone:${x.id}`, false),
    ...on(r.tests.updates, (x) => `upd:${x.tcId}`), ...on(r.tests.additions, (x) => `add:${x.ticketKey}:${x.tc.title}`),
    ...on(r.built.done, (x) => `done:${x.ticketId}`), ...on(r.built.newIssues, (x) => `new:${x.title}`),
  }));
  const [open, setOpen] = useState<string | null>(null);
  const tog = (k: string) => setPick({ ...pick, [k]: !pick[k] });
  const n = (prefix: string) => Object.entries(pick).filter(([k, v]) => v && k.startsWith(prefix)).length;
  const total = Object.values(pick).filter(Boolean).length;
  const done = doneStatus();
  const epicName = (id: string) => p.epics.find((e: Any) => e.id === id)?.title || '';

  const apply = () => {
    const files = new Map(r.pages.map((pg: Any) => [pg.path, pg.file]));
    let pagesAdded = 0, tcs = 0, tcsAdded = 0, closed = 0, created = 0;
    mutate((pp: Any) => {
      // Pages
      pp.automation.app = { pages: [], roles: [], login: {}, notes: '', ...(pp.automation.app || {}) };
      const x = pp.automation.app;
      x.pages = x.pages.filter((pg: Any) => !(pg.fromCode && pick[`gone:${pg.id}`])).map((pg: Any) => (files.has(pg.path)
        ? { ...pg, file: files.get(pg.path) || pg.file, missing: false } : pg.fromCode ? { ...pg, missing: true } : pg));
      for (const pg of newPages) if (pick[`page:${pg.path}`]) { x.pages.push({ id: uid(), name: pg.name, path: pg.path, description: '', fromCode: true, file: pg.file }); pagesAdded++; }
      pp.automation.repoSync = { sha: r.repo.head, branch: r.repo.branch, at: new Date().toISOString(), by: me(), pages: r.pages.length, changed: changedPages.length };
      // Test cases: rewritten ones lose their old script (it no longer matches) and run again
      for (const u of r.tests.updates) {
        if (!pick[`upd:${u.tcId}`]) continue;
        const t = pp.tickets.find((y: Any) => y.id === u.ticketId); const tc = t?.testCases.find((c: Any) => c.id === u.tcId);
        if (!tc) continue;
        Object.assign(tc, u.after, { script: '', status: 'Not run', lastRun: null });
        logEvent(t, `updated test case “${u.after.title}” after code changes: ${u.why}`, 'Repository sync'); tcs++;
      }
      for (const ad of r.tests.additions) {
        if (!pick[`add:${ad.ticketKey}:${ad.tc.title}`]) continue;
        const t = pp.tickets.find((y: Any) => y.id === ad.ticketId);
        if (!t) continue;
        t.testCases.push({ ...newTest(), ...ad.tc });
        logEvent(t, `added test case “${ad.tc.title}” for new behaviour: ${ad.why}`, 'Repository sync'); tcsAdded++;
      }
      // Backlog: delivered work
      for (const d of r.built.done) {
        if (!pick[`done:${d.ticketId}`]) continue;
        const t = pp.tickets.find((y: Any) => y.id === d.ticketId);
        if (!t) continue;
        setField(t, 'status', done, 'Repository sync');
        logEvent(t, `marked ${done}: delivered in the repository (${d.evidence})`, 'Repository sync'); closed++;
      }
      for (const ni of r.built.newIssues) {
        if (!pick[`new:${ni.title}`]) continue;
        const t = newTicket({ title: ni.title, type: ni.type, epicId: ni.epicId, userStory: ni.userStory, status: done, labels: ['delivered'],
          description: `${ni.description}${ni.pages.length ? `\n\nPages: ${ni.pages.join(', ')}` : ''}${ni.evidence ? `\n\nDelivered in: ${ni.evidence}` : ''}`,
          acceptanceCriteria: ni.acceptanceCriteria });
        logEvent(t, 'added from the repository history: already delivered', 'Repository sync');
        pp.tickets.push(t); created++;
      }
    });
    closeModal();
    const parts = [pagesAdded && `${pagesAdded} page${pagesAdded > 1 ? 's' : ''} added`, tcs && `${tcs} test case${tcs > 1 ? 's' : ''} updated`, tcsAdded && `${tcsAdded} added`,
      closed && `${closed} issue${closed > 1 ? 's' : ''} marked ${done}`, created && `${created} delivered feature${created > 1 ? 's' : ''} added to the backlog`].filter(Boolean);
    toast(parts.length ? `${parts.join(' · ')}.${tcs ? ' Updated test cases get new scripts on their next run.' : ''}` : `Synced at ${String(r.repo.head).slice(0, 7)}. Nothing else to change.`, 'ok', {
      title: 'Repository synced', action: created || closed ? { label: 'Open backlog', onClick: () => S.nav(`/p/${P().id}/backlog`) } : undefined });
  };

  const Box = ({ k }: { k: string }) => <CB checked={Boolean(pick[k])} onChange={() => tog(k)} aria-label="Include" />;
  const TABS: [string, string, number][] = [
    ['tests', 'Test cases', r.tests.updates.length + r.tests.additions.length],
    ['backlog', 'Already built', r.built.done.length + r.built.newIssues.length],
    ['pages', 'Pages', newPages.length + gone.length],
  ];
  return (
    <Modal title="Review the repository sync" wide persistent actions={[{ label: 'Cancel' }, { label: total ? `Apply ${total} change${total > 1 ? 's' : ''}` : 'Mark as synced', kind: 'primary', onClick: apply }]}>
      <div className="sync-sum">
        <span><Ico svg={I.pr} /> <b>{r.repo.branch}</b> at <code>{String(r.repo.head).slice(0, 7)}</code></span>
        <span>{r.pages.length} pages · {r.repo.frameworks.join(', ') || 'no router found'}</span>
        <span>{changedPages.length} changed — {r.repo.baseNote}</span>
        {r.repo.uncommitted > 0 && <span className="warn-text">{r.repo.uncommitted} uncommitted file{r.repo.uncommitted > 1 ? 's' : ''} included</span>}
      </div>
      <div className="sync-tabs" role="tablist">{TABS.map(([k, l, c]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l} <span className="count">{c}</span></button>)}</div>

      {tab === 'tests' && <div className="sync-pane">
        {r.tests.error && <div className="warn-banner"><span>Couldn’t check the test cases: {r.tests.error}</span></div>}
        {!r.tests.updates.length && !r.tests.additions.length && !r.tests.error && <p className="muted small">{changedPages.length ? 'The changes don’t affect any test case.' : 'No page changed since the last sync.'}</p>}
        {r.tests.updates.length > 0 && <h4 className="sync-h">Update {n('upd:')} of {r.tests.updates.length} test cases to match the code</h4>}
        {r.tests.updates.map((u: Any) => (
          <div key={u.tcId} className={`sync-item ${pick[`upd:${u.tcId}`] ? '' : 'off'}`}>
            <Box k={`upd:${u.tcId}`} />
            <div className="sync-body">
              <div><span className="key">{u.ref}</span> <b>{u.after.title}</b> <span className="muted small">· {u.ticketKey}</span></div>
              <div className="muted small">{u.why}</div>
              <button className="link-btn small" onClick={() => setOpen(open === u.tcId ? null : u.tcId)}>{open === u.tcId ? 'Hide changes' : 'Show changes'}</button>
              {open === u.tcId && <div className="sync-diff">
                <div><h5>Before</h5><ol>{stepsOf(u.before.steps).map((s: string, i: number) => <li key={i}>{s}</li>)}</ol><p><b>Expected:</b> {u.before.expected}</p></div>
                <div><h5>After</h5><ol>{u.after.steps.map((s: string, i: number) => <li key={i} className={stepsOf(u.before.steps).includes(s) ? '' : 'new'}>{s}</li>)}</ol><p><b>Expected:</b> {u.after.expected}</p></div>
              </div>}
            </div>
          </div>))}
        {r.tests.additions.length > 0 && <h4 className="sync-h">Add {n('add:')} new test case{r.tests.additions.length > 1 ? 's' : ''} for new behaviour</h4>}
        {r.tests.additions.map((ad: Any) => { const k = `add:${ad.ticketKey}:${ad.tc.title}`; return (
          <div key={k} className={`sync-item ${pick[k] ? '' : 'off'}`}><Box k={k} />
            <div className="sync-body"><div><span className="loz">{ad.tc.type}</span> <b>{ad.tc.title}</b> <span className="muted small">· {ad.ticketKey}</span></div>
              <div className="muted small">{ad.why}</div></div></div>); })}
      </div>}

      {tab === 'backlog' && <div className="sync-pane">
        {r.built.error && <div className="warn-banner"><span>Couldn’t match the history with the backlog: {r.built.error}</span></div>}
        {!r.built.done.length && !r.built.newIssues.length && !r.built.error && <p className="muted small">The backlog already matches what’s been built.</p>}
        {r.built.done.length > 0 && <h4 className="sync-h">Mark {n('done:')} issue{r.built.done.length > 1 ? 's' : ''} as {done}: delivered in the code</h4>}
        {r.built.done.map((d: Any) => (
          <div key={d.ticketId} className={`sync-item ${pick[`done:${d.ticketId}`] ? '' : 'off'}`}><Box k={`done:${d.ticketId}`} />
            <div className="sync-body"><div><span className="key">{d.key}</span> <b>{d.title}</b> <span className="muted small">{d.status} → {done}</span></div>
              <div className="muted small"><Ico svg={I.pr} /> {d.evidence}</div></div></div>))}
        {r.built.newIssues.length > 0 && <h4 className="sync-h">Add {n('new:')} delivered feature{r.built.newIssues.length > 1 ? 's' : ''} to the backlog as {done}</h4>}
        {r.built.newIssues.map((ni: Any) => (
          <div key={ni.title} className={`sync-item ${pick[`new:${ni.title}`] ? '' : 'off'}`}><Box k={`new:${ni.title}`} />
            <div className="sync-body">
              <div><b>{ni.title}</b> <span className="muted small">· {ni.type}{ni.epicId ? ` · ${epicName(ni.epicId)}` : ' · no epic'}{ni.acceptanceCriteria.length ? ` · ${ni.acceptanceCriteria.length} acceptance criteria` : ''}</span></div>
              {ni.userStory && <div className="small" style={{ fontStyle: 'italic' }}>{ni.userStory}</div>}
              <div className="muted small"><Ico svg={I.pr} /> {ni.evidence}{ni.pages.length ? ` · ${ni.pages.join(', ')}` : ''}</div>
            </div></div>))}
      </div>}

      {tab === 'pages' && <div className="sync-pane">
        {newPages.length > 0 && <h4 className="sync-h">Add {n('page:')} new page{newPages.length > 1 ? 's' : ''} to App setup</h4>}
        {newPages.map((pg: Any) => (
          <div key={pg.path} className={`sync-item ${pick[`page:${pg.path}`] ? '' : 'off'}`}><Box k={`page:${pg.path}`} />
            <div className="sync-body"><div><b>{pg.name}</b> <code className="small">{pg.path}</code></div><div className="muted small">{pg.file}</div></div></div>))}
        {gone.length > 0 && <h4 className="sync-h">No longer in the code (tick to remove)</h4>}
        {gone.map((pg: Any) => (
          <div key={pg.id} className={`sync-item ${pick[`gone:${pg.id}`] ? '' : 'off'}`}><Box k={`gone:${pg.id}`} />
            <div className="sync-body"><div><b>{pg.name}</b> <code className="small">{pg.path}</code></div></div></div>))}
        <h4 className="sync-h">Changed since {r.repo.baseNote.replace(/^since /, '')}: {changedPages.length} page{changedPages.length === 1 ? '' : 's'}</h4>
        <ul className="sync-changed small">{changedPages.map((pg: Any) => <li key={pg.path}><code>{pg.path}</code> <span className="muted">{pg.changedFiles.length} file{pg.changedFiles.length > 1 ? 's' : ''}: {pg.changedFiles.slice(0, 4).join(', ')}{pg.changedFiles.length > 4 ? '…' : ''}</span></li>)}
          {!changedPages.length && <li className="muted">None.</li>}</ul>
        {r.repo.sharedChanged?.length > 0 && <p className="muted small">Shared files changed too (used by most pages, so not pinned on one): {r.repo.sharedChanged.slice(0, 6).join(', ')}{r.repo.sharedChanged.length > 6 ? '…' : ''}</p>}
      </div>}
    </Modal>
  );
}

// ---------------------------------------------------------------- Playwright run settings (Test automation → Settings)
const RUN_DEFAULTS = { retries: 1, testTimeoutSec: 90, actionTimeoutSec: 15, navTimeoutSec: 30, expectTimeoutSec: 10, device: 'desktop', locale: 'en-PH', timezoneId: 'Asia/Manila', ignoreHttpsErrors: false, reducedMotion: true };
const DEVICES: [string, string][] = [['desktop', 'Desktop · 1440×900'], ['laptop', 'Laptop · 1280×800'], ['tablet', 'Tablet · 820×1180, touch'], ['mobile', 'Phone · 390×844, touch']];
export function RunSettingsCard() {
  const p = P();
  const ed = can('project.settings');
  const rs = { ...RUN_DEFAULTS, ...(p.automation?.app?.run || {}) };
  const set = (k: string, v: Any) => mutate((pp: Any) => { pp.automation.app = { pages: [], roles: [], login: {}, notes: '', ...(pp.automation.app || {}) }; pp.automation.app.run = { ...RUN_DEFAULTS, ...(pp.automation.app.run || {}), [k]: v }; }, { tag: `run.${k}` });
  const numF = (k: string, label: string, help: string, min: number, max: number) => (
    <label className="field"><span>{label}</span><TF type="number" disabled={!ed} value={(rs as Any)[k]} slotProps={{ htmlInput: { min, max } }}
      onChange={(e) => set(k, Math.min(max, Math.max(min, Number(e.target.value) || min)))} /><small className="muted">{help}</small></label>);
  const isDefault = JSON.stringify({ ...RUN_DEFAULTS, ...(p.automation?.app?.run || {}) }) === JSON.stringify(RUN_DEFAULTS);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ alignItems: 'baseline' }}><h3 style={{ margin: 0 }}>Run settings</h3>
        {ed && !isDefault && <button className="link-btn small" style={{ marginLeft: 'auto' }} onClick={() => mutate((pp: Any) => { if (pp.automation.app) delete pp.automation.app.run; })}>Reset to defaults</button>}</div>
      <p className="sub">How Playwright runs each test. Retries catch one-off network hiccups; a test that only passes on a retry is marked <b>flaky</b>.</p>
      <div className="grid3">
        <label className="field"><span>Retries when a test fails</span><SF disabled={!ed} value={rs.retries} onChange={(e) => set('retries', Number(e.target.value))}>
          {[0, 1, 2, 3].map((x) => <MenuItem key={x} value={x}>{x === 0 ? 'No retries' : `${x} retr${x === 1 ? 'y' : 'ies'}`}</MenuItem>)}</SF><small className="muted">Each retry starts a fresh browser.</small></label>
        {numF('testTimeoutSec', 'Time limit per test (s)', 'The whole script, sign-in included.', 15, 600)}
        <label className="field"><span>Screen</span><SF disabled={!ed} value={rs.device} onChange={(e) => set('device', e.target.value)}>
          {DEVICES.map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}</SF><small className="muted">Phone and tablet also turn on touch.</small></label>
        {numF('actionTimeoutSec', 'Wait for a click or fill (s)', 'How long to wait for an element.', 2, 120)}
        {numF('navTimeoutSec', 'Wait for a page to load (s)', 'Slow staging servers need more.', 5, 180)}
        {numF('expectTimeoutSec', 'Wait for a check to pass (s)', 'For expect(…) assertions.', 2, 120)}
        <label className="field"><span>Language (locale)</span><TF disabled={!ed} value={rs.locale} placeholder="en-PH" onChange={(e) => set('locale', e.target.value.trim())} /><small className="muted">Dates and numbers format like this.</small></label>
        <label className="field"><span>Time zone</span><TF disabled={!ed} value={rs.timezoneId} placeholder="Asia/Manila" onChange={(e) => set('timezoneId', e.target.value.trim())} /><small className="muted">Cut-offs and dates use this zone.</small></label>
        <div className="field"><span>Browser</span>
          <CB disabled={!ed} label="Accept self-signed HTTPS certificates" checked={Boolean(rs.ignoreHttpsErrors)} onChange={(e: Any) => set('ignoreHttpsErrors', e.target.checked)} />
          <CB disabled={!ed} label="Reduce animations (steadier runs)" checked={rs.reducedMotion !== false} onChange={(e: Any) => set('reducedMotion', e.target.checked)} /></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- test cases for the existing pages (from their code)
/** Adds reviewed page test cases to their issues; pages with no issue get a new one, Done (delivered work). */
export function applyPageTests(pages: Any[], picked: (pageIdx: number, tcIdx: number) => boolean) {
  const done = doneStatus();
  let added = 0, created = 0;
  const touched = new Set<string>();
  mutate((pp: Any) => {
    const roleId = (name?: string) => (pp.automation?.app?.roles || []).find((r: Any) => r.name === name)?.id;
    const newByTitle = new Map<string, Any>();
    pages.forEach((pg: Any, pi: number) => {
      const tcs = pg.testCases.filter((_: Any, ti: number) => picked(pi, ti));
      if (!tcs.length) return;
      let t = pg.ticketId ? pp.tickets.find((x: Any) => x.id === pg.ticketId) : null;
      if (!t && pg.newIssue) {
        t = newByTitle.get(pg.newIssue.title);
        if (!t) {
          t = newTicket({ title: pg.newIssue.title, type: 'Story', epicId: pg.newIssue.epicId, userStory: pg.newIssue.userStory, acceptanceCriteria: pg.newIssue.acceptanceCriteria,
            status: done, labels: ['delivered', 'from-code'], description: `Already built. Page: ${pg.path}\nCode: ${pg.files.slice(0, 6).join(', ')}` });
          logEvent(t, 'added from the code: an existing page with no issue', 'Repository sync');
          pp.tickets.push(t); newByTitle.set(pg.newIssue.title, t); created++;
        }
      }
      if (!t) return;
      for (const tc of tcs) { const { runAsName, ...rest } = tc; t.testCases.push({ ...newTest(), ...rest, ...(roleId(runAsName) ? { roleId: roleId(runAsName) } : {}) }); added++; }
      logEvent(t, `added ${tcs.length} test case${tcs.length > 1 ? 's' : ''} written from the code of ${pg.path}`, 'Repository sync');
      touched.add(t.key);
    });
  });
  return { added, created, issues: touched.size };
}

function PageTestsReview({ r }: { r: Any }) {
  const pages = r.pages.filter((pg: Any) => pg.testCases.length || pg.error);
  const skipped = r.pages.filter((pg: Any) => !pg.testCases.length && !pg.error);
  const [pick, setPick] = useState<Record<string, boolean>>(() => Object.fromEntries(r.pages.flatMap((pg: Any, pi: number) => pg.testCases.map((_: Any, ti: number) => [`${pi}:${ti}`, true]))));
  const [open, setOpen] = useState<string | null>(null);
  const idx = (pg: Any) => r.pages.indexOf(pg);
  const total = Object.values(pick).filter(Boolean).length;
  const all = r.pages.reduce((n: number, pg: Any) => n + pg.testCases.length, 0);
  const setPage = (pi: number, v: boolean) => setPick({ ...pick, ...Object.fromEntries(r.pages[pi].testCases.map((_: Any, ti: number) => [`${pi}:${ti}`, v])) });
  const apply = () => {
    const res = applyPageTests(r.pages, (pi, ti) => Boolean(pick[`${pi}:${ti}`]));
    closeModal();
    toast(`${res.added} test case${res.added === 1 ? '' : 's'} added to ${res.issues} issue${res.issues === 1 ? '' : 's'}${res.created ? `, including ${res.created} new ${doneStatus()} issue${res.created > 1 ? 's' : ''} for pages that had none` : ''}. Run them from Test automation; scripts are written on the first run.`,
      'ok', { title: 'Test cases added', action: { label: 'Open Test automation', onClick: () => S.nav(`/p/${P().id}/automation`) } });
  };
  return (
    <Modal title="Test cases for the existing pages" wide persistent actions={[{ label: 'Cancel' }, { label: `Add ${total} test case${total === 1 ? '' : 's'}`, kind: 'primary', disabled: !total, onClick: apply }]}>
      <div className="sync-sum"><span><Ico svg={I.pr} /> <b>{r.repo.branch}</b> at <code>{String(r.repo.head).slice(0, 7)}</code></span>
        <span>{all} test cases for {pages.length} pages, written from their code</span>{skipped.length > 0 && <span>{skipped.length} page{skipped.length > 1 ? 's' : ''} with nothing to test</span>}</div>
      <div className="sync-pane">
        {pages.map((pg: Any) => { const pi = idx(pg); const n = pg.testCases.filter((_: Any, ti: number) => pick[`${pi}:${ti}`]).length; return (
          <div key={pg.path} className="pt-page">
            <div className="pt-head">
              <CB checked={n === pg.testCases.length && n > 0} indeterminate={n > 0 && n < pg.testCases.length} disabled={!pg.testCases.length} onChange={(e: Any) => setPage(pi, e.target.checked)} aria-label={`All test cases for ${pg.name}`} />
              <div style={{ minWidth: 0, flex: 1 }}><b>{pg.name}</b> <code className="small">{pg.path}</code>
                <div className="muted small">{pg.error ? <span className="warn-text">Couldn’t write these: {pg.error}</span>
                  : pg.ticketKey ? <>→ <span className="key">{pg.ticketKey}</span> {pg.ticketTitle}</>
                  : pg.newIssue ? <>→ new issue, {doneStatus()}: <b>{pg.newIssue.title}</b>{pg.newIssue.epicKey ? ` (${pg.newIssue.epicKey})` : ''}</> : '→ no issue'}</div></div>
              <span className="muted small">{n} of {pg.testCases.length}</span>
            </div>
            {pg.testCases.map((tc: Any, ti: number) => { const k = `${pi}:${ti}`; return (
              <div key={k} className={`sync-item pt-tc ${pick[k] ? '' : 'off'}`}>
                <CB checked={Boolean(pick[k])} onChange={() => setPick({ ...pick, [k]: !pick[k] })} aria-label="Include" />
                <div className="sync-body">
                  <div><span className="loz">{tc.type}</span> <b>{tc.title}</b> <span className="muted small">· {tc.priority}{tc.runAsName ? ` · as ${tc.runAsName}` : ''}</span></div>
                  <button className="link-btn small" onClick={() => setOpen(open === k ? null : k)}>{open === k ? 'Hide steps' : `${tc.steps.length} steps`}</button>
                  {open === k && <div className="pt-steps small">{tc.preconditions && <p><b>Before:</b> {tc.preconditions}</p>}<ol>{tc.steps.map((x: string, i: number) => <li key={i}>{x}</li>)}</ol><p><b>Expected:</b> {tc.expected}</p></div>}
                </div>
              </div>); })}
          </div>); })}
        {skipped.length > 0 && <p className="muted small">Nothing to test: {skipped.map((pg: Any) => `${pg.path}${pg.note ? ` (${pg.note})` : ''}`).join(' · ')}</p>}
      </div>
    </Modal>
  );
}
