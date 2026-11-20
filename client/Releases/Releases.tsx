'use client';
import { useState } from 'react';
import {
  useStore,
  releases,
  release,
  type Any,
  mutate,
  P,
  openModal,
  setField,
  fmtDate,
  ago,
} from '../core';
import { Confirm, Ico, I, EmptyState } from '../ui';
import { Header } from '../views';
import {
  canRelease,
  ReleaseModal,
  releaseIssues,
  RelLoz,
  Progress,
  overdue,
  ReleaseNowModal,
} from './ReleaseModal';
import { ReleaseDetail } from './release-notes';

export function Releases() {
  useStore();
  const [sel, setSel] = useState<string | null>(null);
  const [show, setShow] = useState('unreleased');
  const manage = canRelease();
  const all = releases();
  const r = sel ? release(sel) : null;
  if (r) return <ReleaseDetail r={r} back={() => setSel(null)} />;
  const list = all
    .filter((x: Any) => show === 'all' || x.status === show)
    .sort(
      (a: Any, b: Any) =>
        (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999') ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
  const n = (s: string) => all.filter((x: Any) => x.status === s).length;
  const setStatus = (x: Any, status: string) =>
    mutate((p) => {
      Object.assign(
        p.releases.find((y: Any) => y.id === x.id),
        { status, ...(status === 'unreleased' ? { releasedAt: null } : {}) },
      );
    });
  const del = (x: Any) => {
    const used = P().tickets.filter((t: Any) => (t.fixVersions || []).includes(x.id));
    openModal(
      <Confirm
        title={`Delete ${x.name}?`}
        label="Delete"
        text={
          used.length
            ? `${used.length} issue${used.length === 1 ? ' has' : 's have'} it as Fix version; it’s removed from them. Undo with ⌘Z.`
            : 'No issues use it. Undo with ⌘Z.'
        }
        onYes={() =>
          mutate((p) => {
            for (const t of used)
              setField(
                t,
                'fixVersions',
                t.fixVersions.filter((v: string) => v !== x.id),
              );
            p.releases = p.releases.filter((y: Any) => y.id !== x.id);
          })
        }
      />,
    );
  };
  return (
    <>
      <Header
        title="Releases"
        right={
          manage && (
            <button className="btn primary" onClick={() => openModal(<ReleaseModal />)}>
              <Ico svg={I.plus} />
              Create version
            </button>
          )
        }
      />
      <p className="muted" style={{ marginTop: -6 }}>
        Plan what ships together: give issues a Fix version, follow each version’s progress, release
        it and share the release notes.
      </p>
      <div className="tabbar rel-tabs" role="tablist">
        {[
          ['unreleased', 'Unreleased', n('unreleased')],
          ['released', 'Released', n('released')],
          ['archived', 'Archived', n('archived')],
          ['all', 'All', all.length],
        ].map(([k, l, c]) => (
          <button
            key={k as string}
            role="tab"
            aria-selected={show === k}
            className={`tab ${show === k ? 'active' : ''}`}
            onClick={() => setShow(k as string)}
          >
            {l} <span className="count">{c}</span>
          </button>
        ))}
      </div>
      {!all.length ? (
        <EmptyState
          icon={I.calendar}
          title="No versions yet"
          actions={
            manage && (
              <button className="btn primary" onClick={() => openModal(<ReleaseModal />)}>
                <Ico svg={I.plus} />
                Create version
              </button>
            )
          }
        >
          <p>
            Create a version (for example 1.0 or “Payroll Q4”), then add issues to it. Releasing it
            records what shipped and gives you release notes.
          </p>
        </EmptyState>
      ) : !list.length ? (
        <p className="muted">No {show} versions.</p>
      ) : (
        <div className="table-wrap">
          <table className="tbl rel-tbl">
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th style={{ width: '24%' }}>Progress</th>
                <th>Start</th>
                <th>Release</th>
                <th>Description</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((x: Any) => {
                const items = releaseIssues(x.id);
                return (
                  <tr key={x.id} className="click" onClick={() => setSel(x.id)}>
                    <td data-label="Version">
                      <b>{x.name}</b>
                    </td>
                    <td data-label="Status">
                      <RelLoz r={x} />
                    </td>
                    <td data-label="Progress">
                      <Progress items={items} />
                    </td>
                    <td data-label="Start" className="muted">
                      {x.startDate ? fmtDate(x.startDate) : '—'}
                    </td>
                    <td data-label="Release" className={overdue(x) ? 'danger-text' : 'muted'}>
                      {x.releaseDate ? fmtDate(x.releaseDate) : '—'}
                      {x.releasedAt ? <span className="small"> · {ago(x.releasedAt)}</span> : null}
                    </td>
                    <td data-label="Description" className="muted rel-desc">
                      {x.description || ''}
                    </td>
                    <td className="rel-acts" onClick={(e) => e.stopPropagation()}>
                      {manage && (
                        <>
                          {x.status === 'unreleased' && (
                            <button
                              className="btn sm"
                              onClick={() => openModal(<ReleaseNowModal r={x} />)}
                            >
                              Release
                            </button>
                          )}
                          {x.status === 'released' && (
                            <button
                              className="btn sm subtle"
                              onClick={() => setStatus(x, 'archived')}
                            >
                              Archive
                            </button>
                          )}
                          {x.status !== 'unreleased' && (
                            <button
                              className="btn sm subtle"
                              onClick={() => setStatus(x, 'unreleased')}
                              title="Move back to unreleased"
                            >
                              Unrelease
                            </button>
                          )}
                          <button
                            className="icon-btn"
                            title="Edit"
                            aria-label={`Edit ${x.name}`}
                            onClick={() => openModal(<ReleaseModal r={x} />)}
                          >
                            <Ico svg={I.pencil} />
                          </button>
                          <button
                            className="icon-btn"
                            title="Delete"
                            aria-label={`Delete ${x.name}`}
                            onClick={() => del(x)}
                          >
                            <Ico svg={I.trash} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
