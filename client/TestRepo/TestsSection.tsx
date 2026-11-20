'use client';
import { useState } from 'react';
import { P, type Any, isSub, toast } from '../core';
import { Ico, I, TypeIcon, StatusLoz } from '../ui';
import { SF, MenuItem } from '../fields';
import { openDrawer } from '../actions';
import {
  environmentsOf,
  coverageOf,
  CovLoz,
  StatusBar,
  latestStatus,
  canEdit,
  latestRun,
  RunLoz,
} from './TestManagement';
import { exportTraceability } from './CsvImportModal';
import { repo, edit } from './run-status';
import { openTest } from './open-test';
import { openExecution } from './open-execution';

// ---------------------------------------------------------------- coverage
export function Coverage() {
  const p = P();
  const [epic, setEpic] = useState('');
  const [only, setOnly] = useState('');
  const [env, setEnv] = useState('');
  const envs = environmentsOf(p);
  const rows = p.tickets
    .filter((t: Any) => !isSub(t) && (!epic || t.epicId === epic))
    .map((t: Any) => ({ t, ...coverageOf(t.id, p, env) }))
    .filter((x: Any) => !only || x.status === only);
  const all = p.tickets
    .filter((t: Any) => !isSub(t) && (!epic || t.epicId === epic))
    .map((t: Any) => coverageOf(t.id, p, env).status);
  const n = (s: string) => all.filter((x: string) => x === s).length;
  return (
    <>
      <div className="toolbar">
        <SF filter value={epic} onChange={(e) => setEpic(e.target.value)} aria-label="Epic">
          <MenuItem value="">All epics</MenuItem>
          {p.epics.map((e: Any) => (
            <MenuItem key={e.id} value={e.id}>
              {e.key} {e.title}
            </MenuItem>
          ))}
        </SF>
        {envs.length > 0 && (
          <SF filter value={env} onChange={(e) => setEnv(e.target.value)} aria-label="Environment">
            <MenuItem value="">All environments</MenuItem>
            {envs.map((x) => (
              <MenuItem key={x} value={x}>
                {x}
              </MenuItem>
            ))}
          </SF>
        )}
        {(['OK', 'NOK', 'NOTRUN', 'UNCOVERED'] as const).map((s) => (
          <button
            key={s}
            className={`xr-covfilter ${only === s ? 'on' : ''}`}
            onClick={() => setOnly(only === s ? '' : s)}
          >
            <CovLoz s={s} /> {n(s)}
          </button>
        ))}
        <span className="spacer" />
        <button
          className="btn sm"
          onClick={() => exportTraceability(epic, env)}
          title="Requirement → test → latest run → defects, as CSV"
        >
          <Ico svg={I.download} />
          Traceability report
        </button>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Issue</th>
            <th>Status</th>
            <th>Tests</th>
            <th>Coverage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ t, status, tests }: Any) => (
            <tr key={t.id} className="click" onClick={() => openDrawer('issue', t.id)}>
              <td>
                <span className="row" style={{ flexWrap: 'nowrap' }}>
                  <TypeIcon type={t.type} />
                  <span className="key">{t.key}</span>
                  <span>{t.title}</span>
                </span>
              </td>
              <td>
                <StatusLoz s={t.status} />
              </td>
              <td style={{ width: 200 }}>
                {tests.length ? (
                  <StatusBar statuses={tests.map((x: Any) => latestStatus(x.id, p, env))} />
                ) : (
                  <span className="muted small">No tests</span>
                )}
              </td>
              <td>
                <CovLoz s={status} /> <span className="muted small">{tests.length || ''}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
// ---------------------------------------------------------------- the issue panel: its tests
/**
 * Issue panel → Tests: the repository tests that cover this issue, their latest results, and
 * linking.
 */
export function TestsSection({ t }: { t: Any }) {
  const p = P();
  const r = repo(p);
  const cov = coverageOf(t.id);
  const [link, setLink] = useState('');
  const ed = canEdit();
  return (
    <div className="sec">
      <div className="sec-title">
        <Ico svg={I.test} />
        <h3>Tests</h3>
        <span className="count">{cov.tests.length}</span>
        <CovLoz s={cov.status} />
        {ed && (
          <div className="tools">
            <SF
              filter
              value={link}
              onChange={(e) => {
                const id = e.target.value;
                setLink('');
                if (id)
                  edit((rr) => {
                    const x = rr.tests.find((y: Any) => y.id === id);
                    if (x) x.issueIds = [...new Set([...(x.issueIds || []), t.id])];
                  });
              }}
              aria-label="Link a test"
            >
              <MenuItem value="">Link a test</MenuItem>
              {r.tests
                .filter((x: Any) => !x.issueIds?.includes(t.id))
                .map((x: Any) => (
                  <MenuItem key={x.id} value={x.id}>
                    {x.key} {x.title.slice(0, 60)}
                  </MenuItem>
                ))}
            </SF>
            <button className="btn sm subtle" onClick={() => openTest(null, null, t.id)}>
              <Ico svg={I.plus} />
              New test
            </button>
          </div>
        )}
      </div>
      {cov.tests.length ? (
        <div className="xr-ttests">
          {cov.tests.map((x: Any) => {
            const lr = latestRun(x.id);
            return (
              <div key={x.id} className="xr-trow">
                <button className="link-btn key" onClick={() => openTest(x)}>
                  {x.key}
                </button>
                <span className="split-title">{x.title}</span>
                {lr ? (
                  <button
                    className="link-btn small"
                    title={`In ${lr.execution.key}`}
                    onClick={() => openExecution(lr.execution.id, x.id)}
                  >
                    <RunLoz s={lr.status} />
                  </button>
                ) : (
                  <RunLoz s="TODO" />
                )}
                {ed && (
                  <button
                    className="icon-btn"
                    title="Unlink from this issue"
                    aria-label={`Unlink ${x.key}`}
                    onClick={() =>
                      edit((rr) => {
                        const y = rr.tests.find((z: Any) => z.id === x.id);
                        if (y) y.issueIds = y.issueIds.filter((id: string) => id !== t.id);
                      })
                    }
                  >
                    <Ico svg={I.close} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted small">
          No repository tests cover this issue yet. Link one, create one, or import this issue’s
          test cases in Test management.
        </p>
      )}
    </div>
  );
}
// ---------------------------------------------------------------- import / export / reports (Xray
// & BrowserStack style)
export const csvCell = (v: Any) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const download = (name: string, text: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
};
/** RFC 4180 CSV → rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
      continue;
    }
    if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const CSV_HEAD = [
  'Test Key',
  'Summary',
  'Type',
  'Priority',
  'Labels',
  'Folder',
  'Preconditions',
  'Step',
  'Action',
  'Data',
  'Expected Result',
  'Gherkin',
  'Issues',
];
/** One row per step (the layout Xray and BrowserStack import). */
export function exportTestsCsv(tests: Any[]) {
  const p = P();
  const r = repo(p);
  const folder = (id: string) => r.folders.find((f: Any) => f.id === id)?.name || '';
  const issues = (t: Any) =>
    (t.issueIds || [])
      .map((id: string) => p.tickets.find((x: Any) => x.id === id)?.key)
      .filter(Boolean)
      .join(' ');
  const lines = [CSV_HEAD.join(',')];
  for (const t of tests) {
    const base = [
      t.key,
      t.title,
      t.type,
      t.priority,
      (t.labels || []).join(' '),
      folder(t.folderId),
      t.preconditions || '',
    ];
    const steps = t.type === 'Cucumber' || !(t.steps || []).length ? [null] : t.steps;
    steps.forEach((st: Any, i: number) =>
      lines.push(
        [
          ...base,
          st ? i + 1 : '',
          st?.action || '',
          st?.data || '',
          st?.expected || '',
          i === 0 ? t.gherkin || '' : '',
          i === 0 ? issues(t) : '',
        ]
          .map(csvCell)
          .join(','),
      ),
    );
  }
  download(`${p.key}-tests-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'));
  toast(`${tests.length} test${tests.length === 1 ? '' : 's'} exported`);
}
