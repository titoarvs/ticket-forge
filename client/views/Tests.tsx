'use client';
import Link from 'next/link';
import { P, S, emit, type Any, can, TC_STATUS, TC_TYPES, tcKey } from '../core';
import { Ico, I, TypeIcon, EmptyState } from '../ui';
import { runTests } from '../actions';
import { TF, SF, MenuItem, opts } from '../fields';
import { testRows, tcGroup, TestsGrouped, openTest, RunLoz, TcStatusSelect } from './test-rows';
import { Header } from './row-dnd';
import { Tile } from './Summary';

export function Tests() {
  const p = P();
  const f = S.tcFilter;
  const setF = (k: string, v: string) => {
    S.tcFilter = { ...S.tcFilter, [k]: v };
    emit();
  };
  const rows = testRows();
  const all = p.tickets.flatMap((t: Any) => t.testCases);
  const c = (s: string) => all.filter((x: Any) => x.status === s).length;
  return (
    <>
      <Header
        title="Test cases"
        right={
          can('test.run') && (
            <button className="btn" disabled={!rows.length} onClick={() => runTests(rows)}>
              <Ico svg={I.play} />
              Run {rows.length} automated
            </button>
          )
        }
      />
      <div className="tiles">
        <Tile
          icon={I.test}
          value={all.length}
          label={`test cases · ${all.filter((x: Any) => x.script).length} automated`}
        />
        <Tile icon={I.check} value={c('Pass')} label="passed" color="#22a06b" />
        <Tile icon={I.close} value={c('Fail')} label="failed" color="var(--danger)" />
        <Tile icon={I.backlog} value={c('Not run') + c('Blocked')} label="not run or blocked" />
      </div>
      <div className="toolbar">
        <TF
          search
          sx={{ width: 220 }}
          id="tq"
          placeholder="Search test cases"
          value={f.q}
          onChange={(e) => setF('q', e.target.value)}
        />
        <SF
          filter
          aria-label="Epic"
          value={S.filter.epic}
          onChange={(e) => {
            S.filter = { ...S.filter, epic: e.target.value };
            emit();
          }}
        >
          <MenuItem value="">Epic</MenuItem>
          {p.epics.map((e: Any) => (
            <MenuItem key={e.id} value={e.id}>
              {e.title}
            </MenuItem>
          ))}
        </SF>
        <SF
          filter
          aria-label="Result"
          value={f.status}
          onChange={(e) => setF('status', e.target.value)}
        >
          <MenuItem value="">Result</MenuItem>
          {opts(TC_STATUS)}
        </SF>
        <SF
          filter
          aria-label="Test type"
          value={f.type}
          onChange={(e) => setF('type', e.target.value)}
        >
          <MenuItem value="">Test type</MenuItem>
          {opts(TC_TYPES)}
        </SF>
        <div className="spacer" />
        <span className="muted small">{rows.length} shown</span>
        <SF
          filter
          aria-label="Group by"
          value={tcGroup()}
          onChange={(e) => {
            try {
              localStorage.setItem('tf.tcGroup', e.target.value);
            } catch {
              /* private mode */
            }
            emit();
          }}
        >
          <MenuItem value="feature">Group by feature</MenuItem>
          <MenuItem value="issue">Group by issue</MenuItem>
          <MenuItem value="none">No grouping</MenuItem>
        </SF>
      </div>
      {rows.length && tcGroup() !== 'none' ? (
        <TestsGrouped
          rows={rows}
          byFeature={tcGroup() === 'feature'}
          filtered={Boolean(f.q.trim() || f.status || f.type)}
        />
      ) : rows.length ? (
        <table className="tbl">
          <thead>
            <tr>
              <th>Key</th>
              <th>Test case</th>
              <th>Issue</th>
              <th>Type</th>
              <th>Covers</th>
              <th>Automation</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ t, tc, i }) => (
              <tr key={tc.id} className="click" onClick={() => openTest(t, tc)}>
                <td className="key">{tcKey(t, i)}</td>
                <td>{tc.title}</td>
                <td>
                  <span className="row" style={{ flexWrap: 'nowrap' }}>
                    <TypeIcon type={t.type} />
                    <span className="key">{t.key}</span>
                  </span>
                </td>
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
      ) : all.length ? (
        <EmptyState
          compact
          icon={I.search}
          tone="neutral"
          title="No test cases match your filters"
          actions={
            <button
              className="btn"
              onClick={() => {
                S.tcFilter = { q: '', status: '', type: '' };
                emit();
              }}
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <EmptyState
          icon={I.test}
          tone="success"
          title="No test cases yet"
          actions={
            <Link className="btn primary" href={`/p/${p.id}/backlog`}>
              Go to backlog
            </Link>
          }
        >
          <p>
            Select issues in the backlog and choose <b>Write test cases</b>, or open an issue and
            use <b>Regenerate test cases</b>. Claude plans them from the acceptance criteria.
          </p>
        </EmptyState>
      )}
    </>
  );
}
