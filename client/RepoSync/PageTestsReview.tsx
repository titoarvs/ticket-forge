'use client';
import { useState } from 'react';
import { type Any, closeModal, toast, S, P } from '../core';
import { Modal, Ico, I } from '../ui';
import { CB } from '../fields';
import { applyPageTests } from './RunSettingsCard';
import { doneStatus } from './RepoSyncCard';

export function PageTestsReview({ r }: { r: Any }) {
  const pages = r.pages.filter((pg: Any) => pg.testCases.length || pg.error);
  const skipped = r.pages.filter((pg: Any) => !pg.testCases.length && !pg.error);
  const [pick, setPick] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      r.pages.flatMap((pg: Any, pi: number) =>
        pg.testCases.map((_: Any, ti: number) => [`${pi}:${ti}`, true]),
      ),
    ),
  );
  const [open, setOpen] = useState<string | null>(null);
  const idx = (pg: Any) => r.pages.indexOf(pg);
  const total = Object.values(pick).filter(Boolean).length;
  const all = r.pages.reduce((n: number, pg: Any) => n + pg.testCases.length, 0);
  const setPage = (pi: number, v: boolean) =>
    setPick({
      ...pick,
      ...Object.fromEntries(r.pages[pi].testCases.map((_: Any, ti: number) => [`${pi}:${ti}`, v])),
    });
  const apply = () => {
    const res = applyPageTests(r.pages, (pi, ti) => Boolean(pick[`${pi}:${ti}`]));
    closeModal();
    toast(
      `${res.added} test case${res.added === 1 ? '' : 's'} added to ${res.issues} issue${res.issues === 1 ? '' : 's'}${res.created ? `, including ${res.created} new ${doneStatus()} issue${res.created > 1 ? 's' : ''} for pages that had none` : ''}. Run them from Test automation; scripts are written on the first run.`,
      'ok',
      {
        title: 'Test cases added',
        action: { label: 'Open Test automation', onClick: () => S.nav(`/p/${P().id}/automation`) },
      },
    );
  };
  return (
    <Modal
      title="Test cases for the existing pages"
      wide
      persistent
      actions={[
        { label: 'Cancel' },
        {
          label: `Add ${total} test case${total === 1 ? '' : 's'}`,
          kind: 'primary',
          disabled: !total,
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
          {all} test cases for {pages.length} pages, written from their code
        </span>
        {skipped.length > 0 && (
          <span>
            {skipped.length} page{skipped.length > 1 ? 's' : ''} with nothing to test
          </span>
        )}
      </div>
      <div className="sync-pane">
        {pages.map((pg: Any) => {
          const pi = idx(pg);
          const n = pg.testCases.filter((_: Any, ti: number) => pick[`${pi}:${ti}`]).length;
          return (
            <div key={pg.path} className="pt-page">
              <div className="pt-head">
                <CB
                  checked={n === pg.testCases.length && n > 0}
                  indeterminate={n > 0 && n < pg.testCases.length}
                  disabled={!pg.testCases.length}
                  onChange={(e: Any) => setPage(pi, e.target.checked)}
                  aria-label={`All test cases for ${pg.name}`}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b>{pg.name}</b> <code className="small">{pg.path}</code>
                  <div className="muted small">
                    {pg.error ? (
                      <span className="warn-text">Couldn’t write these: {pg.error}</span>
                    ) : pg.ticketKey ? (
                      <>
                        → <span className="key">{pg.ticketKey}</span> {pg.ticketTitle}
                      </>
                    ) : pg.newIssue ? (
                      <>
                        → new issue, {doneStatus()}: <b>{pg.newIssue.title}</b>
                        {pg.newIssue.epicKey ? ` (${pg.newIssue.epicKey})` : ''}
                      </>
                    ) : (
                      '→ no issue'
                    )}
                  </div>
                </div>
                <span className="muted small">
                  {n} of {pg.testCases.length}
                </span>
              </div>
              {pg.testCases.map((tc: Any, ti: number) => {
                const k = `${pi}:${ti}`;
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
                          {tc.runAsName ? ` · as ${tc.runAsName}` : ''}
                        </span>
                      </div>
                      <button
                        className="link-btn small"
                        onClick={() => setOpen(open === k ? null : k)}
                      >
                        {open === k ? 'Hide steps' : `${tc.steps.length} steps`}
                      </button>
                      {open === k && (
                        <div className="pt-steps small">
                          {tc.preconditions && (
                            <p>
                              <b>Before:</b> {tc.preconditions}
                            </p>
                          )}
                          <ol>
                            {tc.steps.map((x: string, i: number) => (
                              <li key={i}>{x}</li>
                            ))}
                          </ol>
                          <p>
                            <b>Expected:</b> {tc.expected}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        {skipped.length > 0 && (
          <p className="muted small">
            Nothing to test:{' '}
            {skipped.map((pg: Any) => `${pg.path}${pg.note ? ` (${pg.note})` : ''}`).join(' · ')}
          </p>
        )}
      </div>
    </Modal>
  );
}
