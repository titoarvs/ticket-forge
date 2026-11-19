'use client';
import { useState } from 'react';
import {
  type Any,
  P,
  mutate,
  uid,
  me,
  logEvent,
  newTest,
  setField,
  newTicket,
  closeModal,
  toast,
  S,
} from '../core';
import { Modal, Ico, I } from '../ui';
import { CB } from '../fields';
import { appSetup } from '../AppSetup';
import { doneStatus, stepsOf } from './RepoSyncCard';

// ---------------------------------------------------------------- review
export function SyncReview({ r }: { r: Any }) {
  const p = P();
  const a = appSetup(p);
  const have = new Map(a.pages.map((pg: Any) => [pg.path, pg]));
  const inCode = new Set(r.pages.map((pg: Any) => pg.path));
  const newPages = r.pages.filter((pg: Any) => !have.has(pg.path));
  const changedPages = r.pages.filter((pg: Any) => pg.changedFiles.length);
  const gone = a.pages.filter((pg: Any) => pg.fromCode && !inCode.has(pg.path));
  const [tab, setTab] = useState(() =>
    r.tests.updates.length || r.tests.additions.length
      ? 'tests'
      : r.built.done.length || r.built.newIssues.length
        ? 'backlog'
        : 'pages',
  );
  const on = (list: Any[], key: (x: Any) => string, init = true) =>
    Object.fromEntries(list.map((x) => [key(x), init]));
  const [pick, setPick] = useState<Record<string, boolean>>(() => ({
    ...on(newPages, (x) => `page:${x.path}`),
    ...on(gone, (x) => `gone:${x.id}`, false),
    ...on(r.tests.updates, (x) => `upd:${x.tcId}`),
    ...on(r.tests.additions, (x) => `add:${x.ticketKey}:${x.tc.title}`),
    ...on(r.built.done, (x) => `done:${x.ticketId}`),
    ...on(r.built.newIssues, (x) => `new:${x.title}`),
  }));
  const [open, setOpen] = useState<string | null>(null);
  const tog = (k: string) => setPick({ ...pick, [k]: !pick[k] });
  const n = (prefix: string) =>
    Object.entries(pick).filter(([k, v]) => v && k.startsWith(prefix)).length;
  const total = Object.values(pick).filter(Boolean).length;
  const done = doneStatus();
  const epicName = (id: string) => p.epics.find((e: Any) => e.id === id)?.title || '';

  const apply = () => {
    const files = new Map(r.pages.map((pg: Any) => [pg.path, pg.file]));
    let pagesAdded = 0,
      tcs = 0,
      tcsAdded = 0,
      closed = 0,
      created = 0;
    mutate((pp: Any) => {
      // Pages
      pp.automation.app = {
        pages: [],
        roles: [],
        login: {},
        notes: '',
        ...(pp.automation.app || {}),
      };
      const x = pp.automation.app;
      x.pages = x.pages
        .filter((pg: Any) => !(pg.fromCode && pick[`gone:${pg.id}`]))
        .map((pg: Any) =>
          files.has(pg.path)
            ? { ...pg, file: files.get(pg.path) || pg.file, missing: false }
            : pg.fromCode
              ? { ...pg, missing: true }
              : pg,
        );
      for (const pg of newPages)
        if (pick[`page:${pg.path}`]) {
          x.pages.push({
            id: uid(),
            name: pg.name,
            path: pg.path,
            description: '',
            fromCode: true,
            file: pg.file,
          });
          pagesAdded++;
        }
      pp.automation.repoSync = {
        sha: r.repo.head,
        branch: r.repo.branch,
        at: new Date().toISOString(),
        by: me(),
        pages: r.pages.length,
        changed: changedPages.length,
      };
      // Test cases: rewritten ones lose their old script (it no longer matches) and run again
      for (const u of r.tests.updates) {
        if (!pick[`upd:${u.tcId}`]) continue;
        const t = pp.tickets.find((y: Any) => y.id === u.ticketId);
        const tc = t?.testCases.find((c: Any) => c.id === u.tcId);
        if (!tc) continue;
        Object.assign(tc, u.after, { script: '', status: 'Not run', lastRun: null });
        logEvent(
          t,
          `updated test case “${u.after.title}” after code changes: ${u.why}`,
          'Repository sync',
        );
        tcs++;
      }
      for (const ad of r.tests.additions) {
        if (!pick[`add:${ad.ticketKey}:${ad.tc.title}`]) continue;
        const t = pp.tickets.find((y: Any) => y.id === ad.ticketId);
        if (!t) continue;
        t.testCases.push({ ...newTest(), ...ad.tc });
        logEvent(
          t,
          `added test case “${ad.tc.title}” for new behaviour: ${ad.why}`,
          'Repository sync',
        );
        tcsAdded++;
      }
      // Backlog: delivered work
      for (const d of r.built.done) {
        if (!pick[`done:${d.ticketId}`]) continue;
        const t = pp.tickets.find((y: Any) => y.id === d.ticketId);
        if (!t) continue;
        setField(t, 'status', done, 'Repository sync');
        logEvent(
          t,
          `marked ${done}: delivered in the repository (${d.evidence})`,
          'Repository sync',
        );
        closed++;
      }
      for (const ni of r.built.newIssues) {
        if (!pick[`new:${ni.title}`]) continue;
        const t = newTicket({
          title: ni.title,
          type: ni.type,
          epicId: ni.epicId,
          userStory: ni.userStory,
          status: done,
          labels: ['delivered'],
          description: `${ni.description}${ni.pages.length ? `\n\nPages: ${ni.pages.join(', ')}` : ''}${ni.evidence ? `\n\nDelivered in: ${ni.evidence}` : ''}`,
          acceptanceCriteria: ni.acceptanceCriteria,
        });
        logEvent(t, 'added from the repository history: already delivered', 'Repository sync');
        pp.tickets.push(t);
        created++;
      }
    });
    closeModal();
    const parts = [
      pagesAdded && `${pagesAdded} page${pagesAdded > 1 ? 's' : ''} added`,
      tcs && `${tcs} test case${tcs > 1 ? 's' : ''} updated`,
      tcsAdded && `${tcsAdded} added`,
      closed && `${closed} issue${closed > 1 ? 's' : ''} marked ${done}`,
      created && `${created} delivered feature${created > 1 ? 's' : ''} added to the backlog`,
    ].filter(Boolean);
    toast(
      parts.length
        ? `${parts.join(' · ')}.${tcs ? ' Updated test cases get new scripts on their next run.' : ''}`
        : `Synced at ${String(r.repo.head).slice(0, 7)}. Nothing else to change.`,
      'ok',
      {
        title: 'Repository synced',
        action:
          created || closed
            ? { label: 'Open backlog', onClick: () => S.nav(`/p/${P().id}/backlog`) }
            : undefined,
      },
    );
  };

  const Box = ({ k }: { k: string }) => (
    <CB checked={Boolean(pick[k])} onChange={() => tog(k)} aria-label="Include" />
  );
  const TABS: [string, string, number][] = [
    ['tests', 'Test cases', r.tests.updates.length + r.tests.additions.length],
    ['backlog', 'Already built', r.built.done.length + r.built.newIssues.length],
    ['pages', 'Pages', newPages.length + gone.length],
  ];
  return (
    <Modal
      title="Review the repository sync"
      wide
      persistent
      actions={[
        { label: 'Cancel' },
        {
          label: total ? `Apply ${total} change${total > 1 ? 's' : ''}` : 'Mark as synced',
          kind: 'primary',
          onClick: apply,
        },
      ]}
    >
      <div className="sync-sum">
        <span>
          <Ico svg={I.pr} /> <b>{r.repo.branch}</b> at{' '}
          <code>{String(r.repo.head).slice(0, 7)}</code>
        </span>
        <span>
          {r.pages.length} pages · {r.repo.frameworks.join(', ') || 'no router found'}
        </span>
        <span>
          {changedPages.length} changed — {r.repo.baseNote}
        </span>
        {r.repo.uncommitted > 0 && (
          <span className="warn-text">
            {r.repo.uncommitted} uncommitted file{r.repo.uncommitted > 1 ? 's' : ''} included
          </span>
        )}
      </div>
      <div className="sync-tabs" role="tablist">
        {TABS.map(([k, l, c]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'on' : ''}
            onClick={() => setTab(k)}
          >
            {l} <span className="count">{c}</span>
          </button>
        ))}
      </div>

      {tab === 'tests' && (
        <div className="sync-pane">
          {r.tests.error && (
            <div className="warn-banner">
              <span>Couldn’t check the test cases: {r.tests.error}</span>
            </div>
          )}
          {!r.tests.updates.length && !r.tests.additions.length && !r.tests.error && (
            <p className="muted small">
              {changedPages.length
                ? 'The changes don’t affect any test case.'
                : 'No page changed since the last sync.'}
            </p>
          )}
          {r.tests.updates.length > 0 && (
            <h4 className="sync-h">
              Update {n('upd:')} of {r.tests.updates.length} test cases to match the code
            </h4>
          )}
          {r.tests.updates.map((u: Any) => (
            <div key={u.tcId} className={`sync-item ${pick[`upd:${u.tcId}`] ? '' : 'off'}`}>
              <Box k={`upd:${u.tcId}`} />
              <div className="sync-body">
                <div>
                  <span className="key">{u.ref}</span> <b>{u.after.title}</b>{' '}
                  <span className="muted small">· {u.ticketKey}</span>
                </div>
                <div className="muted small">{u.why}</div>
                <button
                  className="link-btn small"
                  onClick={() => setOpen(open === u.tcId ? null : u.tcId)}
                >
                  {open === u.tcId ? 'Hide changes' : 'Show changes'}
                </button>
                {open === u.tcId && (
                  <div className="sync-diff">
                    <div>
                      <h5>Before</h5>
                      <ol>
                        {stepsOf(u.before.steps).map((s: string, i: number) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ol>
                      <p>
                        <b>Expected:</b> {u.before.expected}
                      </p>
                    </div>
                    <div>
                      <h5>After</h5>
                      <ol>
                        {u.after.steps.map((s: string, i: number) => (
                          <li key={i} className={stepsOf(u.before.steps).includes(s) ? '' : 'new'}>
                            {s}
                          </li>
                        ))}
                      </ol>
                      <p>
                        <b>Expected:</b> {u.after.expected}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          {r.tests.additions.length > 0 && (
            <h4 className="sync-h">
              Add {n('add:')} new test case{r.tests.additions.length > 1 ? 's' : ''} for new
              behaviour
            </h4>
          )}
          {r.tests.additions.map((ad: Any) => {
            const k = `add:${ad.ticketKey}:${ad.tc.title}`;
            return (
              <div key={k} className={`sync-item ${pick[k] ? '' : 'off'}`}>
                <Box k={k} />
                <div className="sync-body">
                  <div>
                    <span className="loz">{ad.tc.type}</span> <b>{ad.tc.title}</b>{' '}
                    <span className="muted small">· {ad.ticketKey}</span>
                  </div>
                  <div className="muted small">{ad.why}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'backlog' && (
        <div className="sync-pane">
          {r.built.error && (
            <div className="warn-banner">
              <span>Couldn’t match the history with the backlog: {r.built.error}</span>
            </div>
          )}
          {!r.built.done.length && !r.built.newIssues.length && !r.built.error && (
            <p className="muted small">The backlog already matches what’s been built.</p>
          )}
          {r.built.done.length > 0 && (
            <h4 className="sync-h">
              Mark {n('done:')} issue{r.built.done.length > 1 ? 's' : ''} as {done}: delivered in
              the code
            </h4>
          )}
          {r.built.done.map((d: Any) => (
            <div
              key={d.ticketId}
              className={`sync-item ${pick[`done:${d.ticketId}`] ? '' : 'off'}`}
            >
              <Box k={`done:${d.ticketId}`} />
              <div className="sync-body">
                <div>
                  <span className="key">{d.key}</span> <b>{d.title}</b>{' '}
                  <span className="muted small">
                    {d.status} → {done}
                  </span>
                </div>
                <div className="muted small">
                  <Ico svg={I.pr} /> {d.evidence}
                </div>
              </div>
            </div>
          ))}
          {r.built.newIssues.length > 0 && (
            <h4 className="sync-h">
              Add {n('new:')} delivered feature{r.built.newIssues.length > 1 ? 's' : ''} to the
              backlog as {done}
            </h4>
          )}
          {r.built.newIssues.map((ni: Any) => (
            <div key={ni.title} className={`sync-item ${pick[`new:${ni.title}`] ? '' : 'off'}`}>
              <Box k={`new:${ni.title}`} />
              <div className="sync-body">
                <div>
                  <b>{ni.title}</b>{' '}
                  <span className="muted small">
                    · {ni.type}
                    {ni.epicId ? ` · ${epicName(ni.epicId)}` : ' · no epic'}
                    {ni.acceptanceCriteria.length
                      ? ` · ${ni.acceptanceCriteria.length} acceptance criteria`
                      : ''}
                  </span>
                </div>
                {ni.userStory && (
                  <div className="small" style={{ fontStyle: 'italic' }}>
                    {ni.userStory}
                  </div>
                )}
                <div className="muted small">
                  <Ico svg={I.pr} /> {ni.evidence}
                  {ni.pages.length ? ` · ${ni.pages.join(', ')}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'pages' && (
        <div className="sync-pane">
          {newPages.length > 0 && (
            <h4 className="sync-h">
              Add {n('page:')} new page{newPages.length > 1 ? 's' : ''} to App setup
            </h4>
          )}
          {newPages.map((pg: Any) => (
            <div key={pg.path} className={`sync-item ${pick[`page:${pg.path}`] ? '' : 'off'}`}>
              <Box k={`page:${pg.path}`} />
              <div className="sync-body">
                <div>
                  <b>{pg.name}</b> <code className="small">{pg.path}</code>
                </div>
                <div className="muted small">{pg.file}</div>
              </div>
            </div>
          ))}
          {gone.length > 0 && <h4 className="sync-h">No longer in the code (tick to remove)</h4>}
          {gone.map((pg: Any) => (
            <div key={pg.id} className={`sync-item ${pick[`gone:${pg.id}`] ? '' : 'off'}`}>
              <Box k={`gone:${pg.id}`} />
              <div className="sync-body">
                <div>
                  <b>{pg.name}</b> <code className="small">{pg.path}</code>
                </div>
              </div>
            </div>
          ))}
          <h4 className="sync-h">
            Changed since {r.repo.baseNote.replace(/^since /, '')}: {changedPages.length} page
            {changedPages.length === 1 ? '' : 's'}
          </h4>
          <ul className="sync-changed small">
            {changedPages.map((pg: Any) => (
              <li key={pg.path}>
                <code>{pg.path}</code>{' '}
                <span className="muted">
                  {pg.changedFiles.length} file{pg.changedFiles.length > 1 ? 's' : ''}:{' '}
                  {pg.changedFiles.slice(0, 4).join(', ')}
                  {pg.changedFiles.length > 4 ? '…' : ''}
                </span>
              </li>
            ))}
            {!changedPages.length && <li className="muted">None.</li>}
          </ul>
          {r.repo.sharedChanged?.length > 0 && (
            <p className="muted small">
              Shared files changed too (used by most pages, so not pinned on one):{' '}
              {r.repo.sharedChanged.slice(0, 6).join(', ')}
              {r.repo.sharedChanged.length > 6 ? '…' : ''}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
