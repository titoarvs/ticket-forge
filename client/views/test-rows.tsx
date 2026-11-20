'use client';
import { useState } from 'react';
import {
  S,
  type Any,
  P,
  tcKey,
  tCls,
  ago,
  mutate,
  logEvent,
  can,
  TC_STATUS,
  emit,
  sCls,
} from '../core';
import { Ico, I, TypeIcon, Swatch } from '../ui';
import { openDrawer, runTests } from '../actions';
import { SF, opts } from '../fields';

// ---------------------------------------------------------------- test cases
export function testRows() {
  const f = S.tcFilter;
  const qq = f.q.trim().toLowerCase();
  const rows: { t: Any; tc: Any; i: number }[] = [];
  for (const t of P().tickets.filter((x: Any) => !S.filter.epic || x.epicId === S.filter.epic)) {
    t.testCases.forEach((tc: Any, i: number) => {
      if (f.status && tc.status !== f.status) return;
      if (f.type && tc.type !== f.type) return;
      if (
        qq &&
        ![tc.title, tc.expected, tcKey(t, i), t.key, t.title].join(' ').toLowerCase().includes(qq)
      )
        return;
      rows.push({ t, tc, i });
    });
  }
  return rows;
}
export const RunLoz = ({ tc }: { tc: Any }) =>
  tc.lastRun ? (
    <span
      className={`loz ${tCls(tc.lastRun.status)}`}
      title={`Automated run ${ago(tc.lastRun.at)} · ${(tc.lastRun.durationMs / 1000).toFixed(1)}s${tc.lastRun.attempts > 1 ? ` · passed on attempt ${tc.lastRun.attempts}` : ''}`}
    >
      <Ico svg={I.bot} /> {tc.lastRun.status}
      {tc.lastRun.flaky ? ' · flaky' : ''}
    </span>
  ) : null;
export function setTcStatus(t: Any, tc: Any, v: string) {
  mutate(() => {
    tc.status = v;
    logEvent(t, `marked ${tcKey(t, t.testCases.indexOf(tc))} as ${v}`);
  });
}
export const TcStatusSelect = ({ t, tc }: { t: Any; tc: Any }) => (
  <SF
    loz
    className={`loz ${tCls(tc.status)}`}
    aria-label="Result"
    value={tc.status}
    disabled={!can('test.run') && !can('issue.edit')}
    onClick={(e) => e.stopPropagation()}
    onChange={(e) => setTcStatus(t, tc, e.target.value)}
  >
    {opts(TC_STATUS)}
  </SF>
);
export function openTest(t: Any, tc: Any) {
  openDrawer('issue', t.id);
  S.openTc.add(tc.id);
  emit();
  setTimeout(() => document.getElementById(`tc-${tc.id}`)?.scrollIntoView({ block: 'center' }), 50);
}
export const tcGroup = () => {
  try {
    return localStorage.getItem('tf.tcGroup') || 'feature';
  } catch {
    return 'feature';
  }
};
type TcRow = { t: Any; tc: Any; i: number };
/** Pass / fail / not run counts for a set of test cases, as small lozenges. */
function TcCounts({ list }: { list: TcRow[] }) {
  const n = (s: string) => list.filter((x) => x.tc.status === s).length;
  const pass = n('Pass'),
    fail = n('Fail'),
    blocked = n('Blocked'),
    notRun = list.length - pass - fail - blocked;
  const auto = list.filter((x) => x.tc.script).length;
  return (
    <span className="res-counts small">
      {pass > 0 && <span className="loz t-pass">{pass} passed</span>}
      {fail > 0 && <span className="loz t-fail">{fail} failed</span>}
      {blocked > 0 && <span className={`loz ${tCls('Blocked')}`}>{blocked} blocked</span>}
      {notRun > 0 && <span className="loz">{notRun} not run</span>}
      <span className="muted">
        {auto}/{list.length} automated
      </span>
    </span>
  );
}
/**
 * Test cases organized by feature (epic) and issue. Issues start collapsed unless a search or
 * filter is on.
 */
export function TestsGrouped({
  rows,
  byFeature,
  filtered,
}: {
  rows: TcRow[];
  byFeature: boolean;
  filtered: boolean;
}) {
  const p = P();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const issues = new Map<string, { t: Any; list: TcRow[] }>();
  for (const r of rows) {
    const g = issues.get(r.t.id);
    if (g) g.list.push(r);
    else issues.set(r.t.id, { t: r.t, list: [r] });
  }
  const features: { key: string; epic: Any; issues: { t: Any; list: TcRow[] }[] }[] = [];
  if (byFeature) {
    for (const e of [...p.epics, null]) {
      const its = [...issues.values()].filter((g) =>
        e ? g.t.epicId === e.id : !p.epics.some((x: Any) => x.id === g.t.epicId),
      );
      if (its.length) features.push({ key: e ? e.id : 'none', epic: e, issues: its });
    }
  } else features.push({ key: 'all', epic: undefined, issues: [...issues.values()] });
  const isOpen = (k: string, dflt: boolean) => open[k] ?? dflt;
  const toggle = (k: string, dflt: boolean) => setOpen({ ...open, [k]: !isOpen(k, dflt) });
  const issueBlock = ({ t, list }: { t: Any; list: TcRow[] }) => {
    const dflt = filtered || list.some((x) => x.tc.status === 'Fail');
    const o = isOpen(`i:${t.id}`, dflt);
    return (
      <div
        key={t.id}
        className={`tg-issue ${list.some((x) => x.tc.status === 'Fail') ? 'has-fail' : ''}`}
      >
        <div className="res-head">
          <button
            type="button"
            className={`as-h ${o ? '' : 'closed'}`}
            aria-expanded={o}
            onClick={() => toggle(`i:${t.id}`, dflt)}
          >
            <Ico svg={I.chevron} />
            <TypeIcon type={t.type} />
            <span className="key">{t.key}</span>
            <span className="res-title">{t.title}</span>
            <span className={`loz ${sCls(t.status)} tg-status`}>{t.status}</span>
          </button>
          <TcCounts list={list} />
          <button
            className="icon-btn"
            title="Open the issue"
            aria-label={`Open ${t.key}`}
            onClick={() => openDrawer('issue', t.id)}
          >
            <Ico svg={I.external} />
          </button>
          {can('test.run') && (
            <button
              className="icon-btn"
              title={`Run ${list.length} test${list.length > 1 ? 's' : ''}`}
              aria-label={`Run ${t.key} tests`}
              onClick={() => runTests(list)}
            >
              <Ico svg={I.play} />
            </button>
          )}
        </div>
        {o && (
          <table className="tbl res-tbl">
            <thead>
              <tr>
                <th>Key</th>
                <th>Test case</th>
                <th>Type</th>
                <th>Covers</th>
                <th>Automation</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {list.map(({ t, tc, i }) => (
                <tr key={tc.id} className="click" onClick={() => openTest(t, tc)}>
                  <td className="key">{tcKey(t, i)}</td>
                  <td>{tc.title}</td>
                  <td className="muted">{tc.type}</td>
                  <td className="muted">
                    {(tc.acRef || []).map((n: number) => `AC${n}`).join(', ') || '–'}
                  </td>
                  <td>
                    {tc.lastRun ? (
                      <RunLoz tc={tc} />
                    ) : tc.script ? (
                      <span className="muted small">
                        <Ico svg={I.bot} /> Script ready
                      </span>
                    ) : (
                      <span className="muted small">Manual</span>
                    )}
                  </td>
                  <td>
                    <TcStatusSelect t={t} tc={tc} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };
  const allKeys = features.flatMap((f) => [`f:${f.key}`, ...f.issues.map((g) => `i:${g.t.id}`)]);
  const expandAll = (v: boolean) => setOpen(Object.fromEntries(allKeys.map((k) => [k, v])));
  return (
    <>
      <div className="row tg-tools">
        <span className="muted small">
          {byFeature ? `${features.length} feature${features.length === 1 ? '' : 's'} · ` : ''}
          {issues.size} issue{issues.size === 1 ? '' : 's'} · {rows.length} test case
          {rows.length === 1 ? '' : 's'}
        </span>
        <span className="spacer" />
        <button className="btn sm subtle" onClick={() => expandAll(true)}>
          Expand all
        </button>
        <button className="btn sm subtle" onClick={() => expandAll(false)}>
          Collapse all
        </button>
      </div>
      {features.map((f) => {
        if (!byFeature) return <div key="all">{f.issues.map(issueBlock)}</div>;
        const list = f.issues.flatMap((g) => g.list);
        const o = isOpen(`f:${f.key}`, true);
        return (
          <section key={f.key} className="tg-feature">
            <div className="tg-feature-h">
              <button
                type="button"
                className={`as-h ${o ? '' : 'closed'}`}
                aria-expanded={o}
                onClick={() => toggle(`f:${f.key}`, true)}
              >
                <Ico svg={I.chevron} />
                {f.epic ? (
                  <>
                    <Swatch color={f.epic.color} />
                    <span className="key">{f.epic.key}</span>
                    <b>{f.epic.title}</b>
                  </>
                ) : (
                  <b>No feature</b>
                )}
                <span className="muted small">
                  {f.issues.length} issue{f.issues.length === 1 ? '' : 's'}
                </span>
              </button>
              <TcCounts list={list} />
              {f.epic && (
                <button className="btn sm subtle" onClick={() => openDrawer('epic', f.epic.id)}>
                  Open feature
                </button>
              )}
              {can('test.run') && (
                <button className="btn sm" onClick={() => runTests(list)}>
                  <Ico svg={I.play} />
                  Run {list.length}
                </button>
              )}
            </div>
            {o && <div className="tg-issues">{f.issues.map(issueBlock)}</div>}
          </section>
        );
      })}
    </>
  );
}
