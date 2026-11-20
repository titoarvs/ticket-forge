'use client';
import { useState } from 'react';
import {
  P,
  type Any,
  feat,
  S,
  can,
  toast,
  startTask,
  api,
  aiBody,
  readNdjson,
  openModal,
  ago,
} from '../core';
import { Ico, I, Spinner } from '../ui';
import { CB } from '../fields';
import { appSetup } from '../AppSetup';
import { SyncReview } from './SyncReview';
import { PageTestsReview } from './PageTestsReview';
import { FeatureMapReview } from './FeatureMapReview';

export const doneStatus = () =>
  P().workflow.find((w: Any) => w.category === 'done')?.name || 'Done';
export const stepsOf = (s: Any) => (Array.isArray(s) ? s : s ? [String(s)] : []);
let running = false;
// ---------------------------------------------------------------- sync card (Test automation → App
// setup)
/** Repository sync, unless the owner locked it (Administration → Features). */
export function RepoSyncCard() {
  if (!feat('reposync'))
    return (
      <p className="muted small" style={{ margin: 0 }}>
        <b>Repository sync is locked.</b>{' '}
        {S.user?.isOwner
          ? 'Unlock it in Administration → Features.'
          : 'The owner locked this feature.'}
      </p>
    );
  return <RepoSyncCardInner />;
}
function RepoSyncCardInner() {
  const p = P();
  const dir =
    p.dev?.localPath || (appSetup(p).source?.kind === 'folder' ? appSetup(p).source.location : '');
  const last = p.automation?.repoSync;
  const canRun = can('project.settings');
  const [opts, setOpts] = useState({
    testCases: can('ai.use'),
    backlog: can('ai.use') && can('issue.create'),
  });
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (running) {
      toast('A repository sync is already running. See the tray.', 'info');
      return;
    }
    running = true;
    setBusy(true);
    setLog([]);
    const ctrl = new AbortController();
    const task = startTask('Syncing with the repository', {
      detail: dir,
      kind: 'test',
      cancel: () => ctrl.abort(),
    });
    try {
      const res = await api(`/api/projects/${p.id}/reposync`, {
        method: 'POST',
        raw: true,
        signal: ctrl.signal,
        body: aiBody(opts),
      });
      let out: Any = null;
      await readNdjson(res, (ev) => {
        if (ev.type === 'progress') {
          setLog((l) => [...l, ev.message]);
          task.update({ detail: ev.message.replace(/…$/, '') });
        } else if (ev.type === 'done') out = ev.result;
        else if (ev.type === 'error') throw new Error(ev.error);
      });
      if (!out) throw new Error('The sync returned nothing.');
      task.finish('Ready to review');
      openModal(<SyncReview r={out} />);
    } catch (e: Any) {
      if (e.name === 'AbortError') {
        task.fail('');
        toast('Nothing was changed.', 'info', { title: 'Repository sync stopped' });
      } else task.fail(`Repository sync failed: ${e.message}`);
    } finally {
      running = false;
      setBusy(false);
    }
  };
  const writeTests = async () => {
    if (running) {
      toast('A repository job is already running. See the tray.', 'info');
      return;
    }
    running = true;
    setBusy(true);
    setLog([]);
    const ctrl = new AbortController();
    const task = startTask('Writing test cases from the code', {
      detail: dir,
      kind: 'test',
      cancel: () => ctrl.abort(),
    });
    try {
      const res = await api(`/api/projects/${p.id}/reposync`, {
        method: 'POST',
        raw: true,
        signal: ctrl.signal,
        body: aiBody({ mode: 'pageTests' }),
      });
      let out: Any = null;
      await readNdjson(res, (ev) => {
        if (ev.type === 'progress') {
          setLog((l) => [
            ...l.filter((x) => !/^Reading .* and writing its test cases/.test(x)),
            ev.message,
          ]);
          const m = ev.message.match(/(\d+)\/(\d+)$/);
          task.update({
            detail: ev.message.replace(/ \d+\/\d+$/, '').replace(/…$/, ''),
            ...(m ? { done: Number(m[1]), total: Number(m[2]) } : {}),
          });
        } else if (ev.type === 'done') out = ev.result;
        else if (ev.type === 'error') throw new Error(ev.error);
      });
      if (!out) throw new Error('Nothing came back.');
      task.finish(
        `${out.pages.reduce((n: number, x: Any) => n + x.testCases.length, 0)} test cases ready to review`,
      );
      openModal(<PageTestsReview r={out} />);
    } catch (e: Any) {
      if (e.name === 'AbortError') {
        task.fail('');
        toast('Nothing was changed.', 'info', { title: 'Stopped writing test cases' });
      } else task.fail(`Couldn’t write test cases from the code: ${e.message}`);
    } finally {
      running = false;
      setBusy(false);
    }
  };
  const findFeatures = async () => {
    if (running) {
      toast('A repository job is already running. See the tray.', 'info');
      return;
    }
    running = true;
    setBusy(true);
    setLog([]);
    const ctrl = new AbortController();
    const task = startTask('Finding built features', {
      detail: dir,
      kind: 'ai',
      cancel: () => ctrl.abort(),
    });
    try {
      const res = await api(`/api/projects/${p.id}/reposync`, {
        method: 'POST',
        raw: true,
        signal: ctrl.signal,
        body: aiBody({ mode: 'features' }),
      });
      let out: Any = null;
      await readNdjson(res, (ev) => {
        if (ev.type === 'progress') {
          setLog((l) => [...l.filter((x) => !/^Writing the features of/.test(x)), ev.message]);
          const m = ev.message.match(/(\d+)\/(\d+)$/);
          task.update({
            detail: ev.message.replace(/ \d+\/\d+$/, '').replace(/…$/, ''),
            ...(m ? { done: Number(m[1]), total: Number(m[2]) } : {}),
          });
        } else if (ev.type === 'done') out = ev.result;
        else if (ev.type === 'error') throw new Error(ev.error);
      });
      if (!out) throw new Error('Nothing came back.');
      task.finish(
        `${out.epics.reduce((n: number, e: Any) => n + e.features.length, 0)} features in ${out.epics.length} epics`,
      );
      openModal(<FeatureMapReview r={out} />);
    } catch (e: Any) {
      if (e.name === 'AbortError') {
        task.fail('');
        toast('Nothing was changed.', 'info', { title: 'Stopped finding features' });
      } else task.fail(`Couldn’t map the built features: ${e.message}`);
    } finally {
      running = false;
      setBusy(false);
    }
  };
  const aiOk = can('ai.use');
  const pagesCount = appSetup(p).pages.length;
  return (
    <div className="repo-panel">
      <div className="repo-head">
        <span className="repo-ic">
          <Ico svg={I.pr} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          {dir ? (
            <>
              <b className="repo-path" title={dir}>
                {dir.split('/').slice(-1)[0]}
              </b>{' '}
              <span className="muted small repo-full">{dir}</span>
              <div className="repo-meta small">
                {last ? (
                  <>
                    <span>
                      <Ico svg={I.check} /> Synced {ago(last.at)}
                    </span>
                    <span>
                      branch <b>{last.branch}</b> at <code>{String(last.sha).slice(0, 7)}</code>
                    </span>
                  </>
                ) : (
                  <span className="warn-text">Never synced</span>
                )}
                <span>
                  {pagesCount} page{pagesCount === 1 ? '' : 's'} in App setup
                </span>
              </div>
            </>
          ) : (
            <>
              <b>No repository yet</b>
              <div className="muted small">
                Set the local repository folder in <b>Project settings → Code &amp; GitHub</b>.
              </div>
            </>
          )}
        </div>
      </div>
      <div className="repo-actions">
        <div className="repo-tile">
          <div className="rt-h">
            <Ico svg={I.refresh} />
            <b>Sync changes</b>
          </div>
          <p className="muted small">
            Adds new pages, finds the pages that changed since the last sync, and proposes the
            test-case updates and backlog changes that follow.
          </p>
          <div className="rt-opts">
            <CB
              label="Update affected test cases"
              disabled={!aiOk || busy}
              checked={opts.testCases}
              onChange={(e: Any) => setOpts({ ...opts, testCases: e.target.checked })}
            />
            <CB
              label={`Mark delivered issues ${doneStatus()}`}
              disabled={!aiOk || !can('issue.create') || busy}
              checked={opts.backlog}
              onChange={(e: Any) => setOpts({ ...opts, backlog: e.target.checked })}
            />
          </div>
          <button className="btn primary sm" disabled={!dir || !canRun || busy} onClick={run}>
            {busy ? (
              <>
                <Spinner />
                Working…
              </>
            ) : last ? (
              'Sync again'
            ) : (
              'Sync now'
            )}
          </button>
        </div>
        <div className="repo-tile">
          <div className="rt-h">
            <Ico svg={I.epic} />
            <b>Find built features</b>
          </div>
          <p className="muted small">
            Reads the <b>code</b>: every page’s screens, actions and fields, the API endpoints and
            data models
            {P().devBackend?.enabled ? ' (frontend and backend)' : ''}. Organizes what’s built into{' '}
            <b>epics</b>, as {doneStatus()} issues. Documents and history only help name things;
            nothing is added from them alone.
          </p>
          <button
            className="btn ai sm"
            disabled={!dir || !aiOk || !can('issue.create') || busy}
            onClick={findFeatures}
          >
            <Ico svg={I.sparkle} />
            Find built features
          </button>
        </div>
        <div className="repo-tile">
          <div className="rt-h">
            <Ico svg={I.test} />
            <b>Test cases from the code</b>
          </div>
          <p className="muted small">
            Writes test cases for every existing page from its code, using its real labels and
            messages, on the issue each page implements.
          </p>
          <button
            className="btn ai sm"
            disabled={!dir || !aiOk || !can('issue.edit') || busy}
            onClick={writeTests}
          >
            <Ico svg={I.sparkle} />
            Write test cases
          </button>
        </div>
      </div>
      {log.length > 0 && (
        <ol className="sync-log small">
          {log.map((l, i) => (
            <li key={i} className={i === log.length - 1 && busy ? 'now' : ''}>
              {i === log.length - 1 && busy ? <Spinner /> : <Ico svg={I.check} />}
              {l}
            </li>
          ))}
        </ol>
      )}
      <p className="muted small repo-note">
        Everything is read on this computer and comes back as a review: nothing changes until you
        apply it.
      </p>
    </div>
  );
}
