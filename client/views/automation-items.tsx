'use client';
import { useState } from 'react';
import { activeSprint, type Any, P, tcKey, S, emit, can, openModal, ago } from '../core';
import { EmptyState, I, Ico, TypeIcon, Spinner } from '../ui';
import { openDrawer, runTests, ScriptModal } from '../actions';
import { TF } from '../fields';
import { openTest, RunLoz } from './test-rows';
import { ShotModal } from './ShotModal';

// ---------------------------------------------------------------- test automation
export function automationItems(scope: string) {
  const act = activeSprint();
  const out: { t: Any; tc: Any; i: number }[] = [];
  for (const t of P().tickets) {
    if (scope === 'sprint' && (!act || t.sprintId !== act.id)) continue;
    if (scope.startsWith('epic:') && t.epicId !== scope.slice(5)) continue;
    t.testCases.forEach((tc: Any, i: number) => {
      if (scope === 'failed' && tc.lastRun?.status !== 'Fail') return;
      if (scope === 'notrun' && tc.lastRun) return;
      if (scope === 'automated' && !tc.script) return;
      out.push({ t, tc, i });
    });
  }
  return out;
}
/**
 * Results tab: test cases grouped under their issue, with counts, search and a Run button per
 * issue.
 */
export function ResultsList({ items, run }: { items: { t: Any; tc: Any; i: number }[]; run: Any }) {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? items.filter(({ t, tc, i }) =>
        `${tcKey(t, i)} ${tc.title} ${t.key} ${t.title}`.toLowerCase().includes(needle),
      )
    : items;
  const groups: { t: Any; list: { t: Any; tc: Any; i: number }[] }[] = [];
  for (const it of shown) {
    const g = groups.find((x) => x.t.id === it.t.id);
    if (g) g.list.push(it);
    else groups.push({ t: it.t, list: [it] });
  }
  // Many issues: start collapsed, except issues with failing tests (and when searching, everything
  // that matches).
  const many = groups.length > 8 && !needle;
  const failing = (list: Any[]) => list.some((x) => x.tc.lastRun && x.tc.lastRun.status !== 'Pass');
  const isClosedG = (g: Any) =>
    closed[g.t.id] ??
    (many && !failing(g.list) && !g.list.some((x: Any) => run?.running && run.current === x.tc.id));
  const allClosed = groups.length > 0 && groups.every(isClosedG);
  if (!items.length)
    return (
      <EmptyState
        compact
        icon={I.bot}
        tone="neutral"
        title="No test cases in this selection"
        actions={
          S.autoScope !== 'all' && (
            <button
              className="btn"
              onClick={() => {
                S.autoScope = 'all';
                emit();
              }}
            >
              Show all test cases
            </button>
          )
        }
      >
        <p>
          {S.autoScope === 'all'
            ? 'Add test cases to your issues first: select issues in the backlog and choose Write test cases.'
            : 'Pick a different set above.'}
        </p>
      </EmptyState>
    );
  return (
    <>
      <div className="toolbar results-tools">
        <TF
          value={q}
          placeholder={`Search ${items.length} test cases or issues`}
          onChange={(e) => setQ(e.target.value)}
          sx={{ flex: 1, maxWidth: 420 }}
          aria-label="Search test cases"
        />
        <span className="muted small">
          {groups.length} issue{groups.length === 1 ? '' : 's'} · {shown.length} test case
          {shown.length === 1 ? '' : 's'}
        </span>
        <button
          className="btn sm subtle"
          style={{ marginLeft: 'auto' }}
          onClick={() =>
            setClosed(allClosed ? {} : Object.fromEntries(groups.map((g) => [g.t.id, true])))
          }
        >
          {allClosed ? 'Expand all' : 'Collapse all'}
        </button>
      </div>
      {!shown.length && <p className="muted small">No test case matches “{q}”.</p>}
      {groups.map(({ t, list }) => {
        const pass = list.filter((x) => x.tc.lastRun?.status === 'Pass').length;
        const fail = list.filter((x) => x.tc.lastRun && x.tc.lastRun.status !== 'Pass').length;
        const never = list.length - pass - fail;
        const scripted = list.filter((x) => x.tc.script).length;
        const isClosed = isClosedG({ t, list });
        return (
          <section key={t.id} className={`res-group ${fail ? 'has-fail' : ''}`}>
            <div className="res-head">
              <button
                type="button"
                className={`as-h ${isClosed ? 'closed' : ''}`}
                aria-expanded={!isClosed}
                onClick={() => setClosed({ ...closed, [t.id]: !isClosed })}
              >
                <Ico svg={I.chevron} />
                <TypeIcon type={t.type} />
                <span className="key">{t.key}</span>
                <b className="res-title">{t.title}</b>
              </button>
              <span className="res-counts small">
                {pass > 0 && <span className="loz t-pass">{pass} passed</span>}
                {fail > 0 && <span className="loz t-fail">{fail} failed</span>}
                {never > 0 && <span className="loz">{never} not run</span>}
                <span className="muted">
                  {scripted}/{list.length} scripted
                </span>
              </span>
              <button className="btn sm subtle" onClick={() => openDrawer('issue', t.id)}>
                Open issue
              </button>
              {can('test.run') && (
                <button
                  className="btn sm"
                  disabled={run?.running}
                  onClick={() => runTests(list.map(({ t: tt, tc }) => ({ t: tt, tc })))}
                >
                  <Ico svg={I.play} />
                  Run {list.length}
                </button>
              )}
            </div>
            {!isClosed && (
              <table className="tbl res-tbl">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Test case</th>
                    <th>Script</th>
                    <th>Last run</th>
                    <th className="num">Duration</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map(({ t, tc, i }) => {
                    const running = run?.running && run.current === tc.id;
                    return [
                      <tr key={tc.id} className="click" onClick={() => openTest(t, tc)}>
                        <td className="key">{tcKey(t, i)}</td>
                        <td>{tc.title}</td>
                        <td>
                          {tc.script ? (
                            <button
                              className="btn sm subtle"
                              onClick={(e) => {
                                e.stopPropagation();
                                openModal(<ScriptModal tid={t.id} tcid={tc.id} />);
                              }}
                            >
                              <Ico svg={I.bot} />
                              View
                            </button>
                          ) : (
                            <span className="muted small">Not written</span>
                          )}
                        </td>
                        <td>
                          {running ? (
                            <span className="row small" style={{ gap: 6 }}>
                              <Spinner />
                              Running
                            </span>
                          ) : tc.lastRun ? (
                            <>
                              <RunLoz tc={tc} />{' '}
                              <span className="muted small">{ago(tc.lastRun.at)}</span>
                            </>
                          ) : (
                            <span className="muted small">Never</span>
                          )}
                        </td>
                        <td className="num muted">
                          {tc.lastRun ? `${(tc.lastRun.durationMs / 1000).toFixed(1)}s` : '–'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {can('test.run') && (
                            <button
                              className="icon-btn"
                              title="Run this test"
                              disabled={run?.running}
                              onClick={(e) => {
                                e.stopPropagation();
                                runTests([{ t, tc }]);
                              }}
                            >
                              <Ico svg={I.play} />
                            </button>
                          )}
                        </td>
                      </tr>,
                      tc.lastRun?.status === 'Fail' && (
                        <tr key={`${tc.id}-err`} className="err-row">
                          <td />
                          <td colSpan={5}>
                            <div className="err-box">
                              {tc.lastRun.error.split('\n').slice(0, 4).join('\n')}
                            </div>
                            {tc.lastRun.screenshot && (
                              <button
                                type="button"
                                className="shot-thumb sm"
                                onClick={() =>
                                  openModal(
                                    <ShotModal
                                      url={tc.lastRun.screenshot}
                                      title={`${tcKey(t, i)} ${tc.title}`}
                                      error={tc.lastRun.error}
                                      at={tc.lastRun.at}
                                    />,
                                  )
                                }
                              >
                                <img
                                  src={tc.lastRun.screenshot}
                                  alt={`Screenshot of the failed test ${tc.title}`}
                                  loading="lazy"
                                />
                              </button>
                            )}
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </>
  );
}
export const AUTO_TABS: [string, string, string][] = [
  ['results', 'Results', I.play],
  ['failures', 'Failures', I.warn],
  ['setup', 'App setup', I.doc],
  ['settings', 'Settings', I.settings],
];
