'use client';
// Test automation: "Sync with the repository" (lib/reposync.js) and the Playwright run settings.
// Sync reads the project's local repository: its pages, what changed since the last sync, the test cases those changes
// affect, and features already delivered. Everything comes back as a review; nothing changes until you apply it.
import { useState } from 'react';
import { S, P, api, nextEpicKey, COLORS, isDone, mutate, toast, openModal, closeModal, can, uid, ago, readNdjson, aiBody, startTask, setField, logEvent, newTicket, newTest, me, type Any } from './core';
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
  const findFeatures = async () => {
    if (running) { toast('A repository job is already running. See the tray.', 'info'); return; }
    running = true; setBusy(true); setLog([]);
    const ctrl = new AbortController();
    const task = startTask('Finding built features', { detail: dir, kind: 'ai', cancel: () => ctrl.abort() });
    try {
      const res = await api(`/api/projects/${p.id}/reposync`, { method: 'POST', raw: true, signal: ctrl.signal, body: aiBody({ mode: 'features' }) });
      let out: Any = null;
      await readNdjson(res, (ev) => {
        if (ev.type === 'progress') {
          setLog((l) => [...l.filter((x) => !/^Writing the features of/.test(x)), ev.message]);
          const m = ev.message.match(/(\d+)\/(\d+)$/);
          task.update({ detail: ev.message.replace(/ \d+\/\d+$/, '').replace(/…$/, ''), ...(m ? { done: Number(m[1]), total: Number(m[2]) } : {}) });
        } else if (ev.type === 'done') out = ev.result;
        else if (ev.type === 'error') throw new Error(ev.error);
      });
      if (!out) throw new Error('Nothing came back.');
      task.finish(`${out.epics.reduce((n: number, e: Any) => n + e.features.length, 0)} features in ${out.epics.length} epics`);
      openModal(<FeatureMapReview r={out} />);
    } catch (e: Any) {
      if (e.name === 'AbortError') { task.fail(''); toast('Nothing was changed.', 'info', { title: 'Stopped finding features' }); }
      else task.fail(`Couldn’t map the built features: ${e.message}`);
    } finally { running = false; setBusy(false); }
  };
  const aiOk = can('ai.use');
  const pagesCount = appSetup(p).pages.length;
  return (
    <div className="repo-panel">
      <div className="repo-head">
        <span className="repo-ic"><Ico svg={I.pr} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          {dir ? <><b className="repo-path" title={dir}>{dir.split('/').slice(-1)[0]}</b> <span className="muted small repo-full">{dir}</span>
            <div className="repo-meta small">
              {last ? <><span><Ico svg={I.check} /> Synced {ago(last.at)}</span><span>branch <b>{last.branch}</b> at <code>{String(last.sha).slice(0, 7)}</code></span></> : <span className="warn-text">Never synced</span>}
              <span>{pagesCount} page{pagesCount === 1 ? '' : 's'} in App setup</span>
            </div></>
            : <><b>No repository yet</b><div className="muted small">Set the local repository folder in <b>Project settings → Code &amp; GitHub</b>.</div></>}
        </div>
      </div>
      <div className="repo-actions">
        <div className="repo-tile">
          <div className="rt-h"><Ico svg={I.refresh} /><b>Sync changes</b></div>
          <p className="muted small">Adds new pages, finds the pages that changed since the last sync, and proposes the test-case updates and backlog changes that follow.</p>
          <div className="rt-opts">
            <CB label="Update affected test cases" disabled={!aiOk || busy} checked={opts.testCases} onChange={(e: Any) => setOpts({ ...opts, testCases: e.target.checked })} />
            <CB label={`Mark delivered issues ${doneStatus()}`} disabled={!aiOk || !can('issue.create') || busy} checked={opts.backlog} onChange={(e: Any) => setOpts({ ...opts, backlog: e.target.checked })} />
          </div>
          <button className="btn primary sm" disabled={!dir || !canRun || busy} onClick={run}>{busy ? <><Spinner />Working…</> : last ? 'Sync again' : 'Sync now'}</button>
        </div>
        <div className="repo-tile">
          <div className="rt-h"><Ico svg={I.epic} /><b>Find built features</b></div>
          <p className="muted small">Reads the <b>code</b>: every page’s screens, actions and fields, the API endpoints and data models{P().devBackend?.enabled ? ' (frontend and backend)' : ''}. Organizes what’s built into <b>epics</b>, as {doneStatus()} issues. Documents and history only help name things; nothing is added from them alone.</p>
          <button className="btn ai sm" disabled={!dir || !aiOk || !can('issue.create') || busy} onClick={findFeatures}><Ico svg={I.sparkle} />Find built features</button>
        </div>
        <div className="repo-tile">
          <div className="rt-h"><Ico svg={I.test} /><b>Test cases from the code</b></div>
          <p className="muted small">Writes test cases for every existing page from its code, using its real labels and messages, on the issue each page implements.</p>
          <button className="btn ai sm" disabled={!dir || !aiOk || !can('issue.edit') || busy} onClick={writeTests}><Ico svg={I.sparkle} />Write test cases</button>
        </div>
      </div>
      {log.length > 0 && <ol className="sync-log small">{log.map((l, i) => <li key={i} className={i === log.length - 1 && busy ? 'now' : ''}>{i === log.length - 1 && busy ? <Spinner /> : <Ico svg={I.check} />}{l}</li>)}</ol>}
      <p className="muted small repo-note">Everything is read on this computer and comes back as a review: nothing changes until you apply it.</p>
    </div>
  );
}

// ---------------------------------------------------------------- built features, by epic
export function FeatureMapReview({ r }: { r: Any }) {
  const p = P();
  const done = doneStatus();
  const key = (ei: number, fi: number) => `${ei}:${fi}`;
  const isDoneF = (f: Any) => f.alreadyDone || (f.existingKey && f.existingStatus === done) || (f.existingId && isDone(P().tickets.find((t: Any) => t.id === f.existingId) || {}));
  const cur = (f: Any) => P().tickets.find((t: Any) => t.id === f.existingId);
  // Done, already in an epic and already sized: nothing to change.
  const settled = (f: Any) => isDoneF(f) && (f.existingEpicId || cur(f)?.epicId) && (cur(f)?.storyPoints != null || !f.storyPoints);
  const [pick, setPick] = useState<Record<string, boolean>>(() => Object.fromEntries(r.epics.flatMap((e: Any, ei: number) => e.features.map((f: Any, fi: number) => [key(ei, fi), !settled(f)]))));
  const [open, setOpen] = useState<string | null>(null);
  const [closed, setClosed] = useState<Record<number, boolean>>({});
  const all = r.epics.flatMap((e: Any) => e.features);
  const chosen = Object.values(pick).filter(Boolean).length;
  const setEpic = (ei: number, v: boolean) => setPick({ ...pick, ...Object.fromEntries(r.epics[ei].features.map((f: Any, fi: number) => [key(ei, fi), v && !settled(f)])) });
  const apply = () => {
    let newEpics = 0, created = 0, marked = 0, moved = 0, sized = 0;
    mutate((pp: Any) => {
      r.epics.forEach((e: Any, ei: number) => {
        const feats = e.features.filter((f: Any, fi: number) => pick[key(ei, fi)] && !settled(f));
        if (!feats.length) return;
        let epicId = e.epicId;
        if (!epicId) {
          const ne = { id: uid(), key: nextEpicKey(), title: e.title, description: e.description || '', color: COLORS[pp.epics.length % COLORS.length] };
          pp.epics.push(ne); epicId = ne.id; newEpics++;
        }
        for (const f of feats) {
          if (f.existingId) {
            const t = pp.tickets.find((x: Any) => x.id === f.existingId);
            if (!t) continue;
            if (!t.epicId) { setField(t, 'epicId', epicId, 'Repository sync'); moved++; }
            if (t.storyPoints == null && f.storyPoints) { setField(t, 'storyPoints', f.storyPoints, 'Repository sync'); sized++; } // size issues that had none
            if (!isDoneF(f)) {
              setField(t, 'status', done, 'Repository sync');
              logEvent(t, `marked ${done}: already built (${f.sources.slice(0, 3).join(', ') || 'found in the code'})`, 'Repository sync');
              marked++;
            }
          } else {
            const t = newTicket({ title: f.title, type: f.type, epicId, userStory: f.userStory, acceptanceCriteria: f.acceptanceCriteria, status: done, labels: ['delivered'], storyPoints: f.storyPoints ?? null,
              description: [f.description, f.pages.length && `Pages: ${f.pages.join(', ')}`, f.sources.length && `Sources: ${f.sources.join(', ')}`].filter(Boolean).join('\n\n') });
            logEvent(t, 'added from the repository: already built', 'Repository sync');
            pp.tickets.push(t); created++;
          }
        }
      });
    });
    closeModal();
    toast([`${created} small ticket${created === 1 ? '' : 's'} added as ${done}`, marked && `${marked} existing issue${marked > 1 ? 's' : ''} marked ${done}`, moved && `${moved} existing issue${moved > 1 ? 's' : ''} moved into their epic`, sized && `${sized} sized`, newEpics && `${newEpics} new epic${newEpics > 1 ? 's' : ''}`].filter(Boolean).join(' · ') + '.', 'ok',
      { title: 'Backlog organized', action: { label: 'Open Epics', onClick: () => S.nav(`/p/${P().id}/epics`) } });
  };
  return (
    <Modal title="Built features, by epic" wide persistent actions={[{ label: 'Cancel' }, { label: (() => { const sel = r.epics.flatMap((e: Any, ei: number) => e.features.filter((_: Any, fi: number) => pick[key(ei, fi)])); const nNew = sel.filter((f: Any) => !f.existingId).length;
      return nNew === sel.length ? `Add ${nNew} ticket${nNew === 1 ? '' : 's'}` : nNew ? `Add ${nNew}, update ${sel.length - nNew}` : `Apply ${sel.length} change${sel.length === 1 ? '' : 's'}`; })(), kind: 'primary', disabled: !chosen, onClick: apply }]}>
      <div className="sync-sum"><span><Ico svg={I.pr} /> <b>{r.repo.branch}</b> at <code>{String(r.repo.head).slice(0, 7)}</code></span>
        <span>{r.code ? <>From the code: {r.code.pages} pages, {r.code.endpoints} endpoints, {r.code.models} data models{r.code.backend ? ' (with the backend)' : ''}</> : <>Read {r.pages} pages</>} · hints from {r.docs.length} .md file{r.docs.length === 1 ? '' : 's'} and {r.commits} commits</span>
        <span>{all.length} small tickets · {new Set(all.map((f: Any) => f.group || f.title)).size} features · {r.epics.length} epics ({r.epics.filter((e: Any) => e.isNew).length} new)</span></div>
      <div className="sync-pane">
        {r.epics.map((e: Any, ei: number) => {
          const n = e.features.filter((f: Any, fi: number) => pick[key(ei, fi)]).length;
          const selectable = e.features.filter((f: Any) => !settled(f)).length;
          return (
            <div key={ei} className="pt-page fm-epic">
              <div className="pt-head">
                <CB checked={n > 0 && n === selectable} indeterminate={n > 0 && n < selectable} disabled={!selectable} onChange={(ev: Any) => setEpic(ei, ev.target.checked)} aria-label={`All features of ${e.title}`} />
                <button type="button" className={`as-h ${closed[ei] ? 'closed' : ''}`} style={{ flex: 1, width: 'auto' }} onClick={() => setClosed({ ...closed, [ei]: !closed[ei] })}>
                  <Ico svg={I.chevron} /><TypeIconEpic />{e.epicKey && <span className="key">{e.epicKey}</span>}<b>{e.title}</b>
                  <span className={`pg-badge ${e.isNew ? 'dyn' : ''}`}>{e.isNew ? 'New epic' : 'Existing epic'}</span></button>
                <span className="muted small fm-sum">{new Set(e.features.map((f: Any) => f.group || f.title)).size} features · {e.features.length} tickets · {e.features.reduce((x: number, f: Any) => x + (f.storyPoints || 0), 0)} pts · {n} selected</span>
              </div>
              {e.description && !closed[ei] && <p className="muted small fm-desc">{e.description}</p>}
              {e.error && <p className="warn-text small fm-desc">Couldn’t write the details: {e.error}</p>}
              {!closed[ei] && e.features.map((f: Any, fi: number) => { const k = key(ei, fi); const g = f.group || f.title; const size = e.features.filter((x: Any) => (x.group || x.title) === g).length;
                const head = size > 1 && g !== (fi > 0 ? (e.features[fi - 1].group || e.features[fi - 1].title) : null); return (
                <div key={k}>
                {head && <div className="fm-group small"><Ico svg={I.chevron} /> {g}<span className="muted"> · split into {size} tickets</span></div>}
                <div className={`sync-item pt-tc fm-ticket ${size > 1 ? 'in-group' : ''} ${pick[k] ? '' : 'off'}`}>
                  <CB checked={Boolean(pick[k])} disabled={settled(f)} onChange={() => setPick({ ...pick, [k]: !pick[k] })} aria-label="Include" />
                  <div className="sync-body">
                    <div><span className="sp" title="Story points">{f.storyPoints ?? '–'}</span> <b>{f.title}</b> {settled(f) ? <span className="pg-badge">{f.existingKey} · already {f.existingStatus}</span>
                      : isDoneF(f) ? <span className="pg-badge dyn">{f.existingKey} · {[!(f.existingEpicId || cur(f)?.epicId) && 'move into this epic', cur(f)?.storyPoints == null && f.storyPoints && `size ${f.storyPoints} pts`].filter(Boolean).join(' · ')}</span>
                      : f.existingKey ? <span className="pg-badge dyn">{f.existingKey}: {f.existingStatus} → {done}</span> : <span className="pg-badge">New · {done}</span>}</div>
                    {!f.existingKey && <button className="link-btn small" onClick={() => setOpen(open === k ? null : k)}>{open === k ? 'Hide details' : `${f.acceptanceCriteria.length} acceptance criteria`}</button>}
                    {open === k && <div className="pt-steps small">{f.userStory && <p><i>{f.userStory}</i></p>}{f.description && <p>{f.description}</p>}<ol>{f.acceptanceCriteria.map((a: string, i: number) => <li key={i}>{a}</li>)}</ol>
                      {(f.pages.length > 0 || f.sources.length > 0) && <p className="muted">{[f.pages.length && `Pages: ${f.pages.join(', ')}`, f.sources.length && `Code and hints: ${f.sources.join(', ')}`].filter(Boolean).join(' · ')}</p>}</div>}
                  </div>
                </div>
                </div>); })}
            </div>);
        })}
        {!r.epics.length && <p className="muted small">Nothing built was found in the code.</p>}
        {r.unverified?.length > 0 && <details className="fm-unverified">
          <summary className="small"><b>{r.unverified.length} not found in the code</b> <span className="muted">· mentioned only in documents or history, so not added</span></summary>
          <ul className="small">{r.unverified.map((u: Any, i: number) => <li key={i}><b>{u.title}</b>{u.source && <span className="muted"> · {u.source}</span>}<div className="muted">{u.why}</div></li>)}</ul>
          <p className="muted small" style={{ margin: 0 }}>If one is really built, it may live in a repository TicketForge doesn’t read: set the backend repository in Project settings → Code & GitHub, then run this again.</p>
        </details>}
      </div>
    </Modal>
  );
}
const TypeIconEpic = () => <span className="fm-epic-ic" aria-hidden><Ico svg={I.epic} /></span>;

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
