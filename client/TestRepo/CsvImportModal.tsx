'use client';
import { useState } from 'react';
import { type Any, uid, nowIso, me, closeModal, toast, P, isSub } from '../core';
import { Modal, Ico, I } from '../ui';
import { TEST_TYPES, edit, STATUS_LABEL, repo } from './run-status';
import { nextKey, coverageOf, COV_LABEL, latestRun, counts } from './TestManagement';
import { parseCsv, csvCell, download } from './TestsSection';

export function CsvImportModal({ folderId }: { folderId: string | null }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [name, setName] = useState('');
  const head = rows?.[0]?.map((h) => h.trim().toLowerCase()) || [];
  const col = (...names: string[]) =>
    head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const ci = {
    key: col('test key', 'key', 'id'),
    title: col('summary', 'title', 'test case', 'name'),
    type: col('type'),
    priority: col('priority'),
    labels: col('labels', 'tags'),
    folder: col('folder'),
    pre: col('precondition'),
    action: col('action', 'step', 'steps'),
    data: col('data', 'test data'),
    expected: col('expected'),
    gherkin: col('gherkin', 'scenario'),
    issues: col('issues', 'requirement', 'linked'),
  };
  const tests = (() => {
    if (!rows || ci.title < 0) return [];
    const out: Any[] = [];
    let cur: Any = null;
    for (const row of rows.slice(1)) {
      const g = (i: number) => (i >= 0 ? String(row[i] || '').trim() : '');
      const title = g(ci.title);
      if (title && (!cur || title !== cur.title || (g(ci.key) && g(ci.key) !== cur.srcKey))) {
        cur = {
          srcKey: g(ci.key),
          title,
          type:
            TEST_TYPES.find((x) => x.toLowerCase() === g(ci.type).toLowerCase()) ||
            (g(ci.gherkin) ? 'Cucumber' : 'Manual'),
          priority:
            ['High', 'Medium', 'Low'].find(
              (x) => x.toLowerCase() === g(ci.priority).toLowerCase(),
            ) || 'Medium',
          labels: g(ci.labels)
            .split(/[\s,;]+/)
            .filter(Boolean),
          folder: g(ci.folder),
          preconditions: g(ci.pre),
          gherkin: g(ci.gherkin),
          issues: g(ci.issues)
            .split(/[\s,;]+/)
            .filter(Boolean),
          steps: [],
        };
        out.push(cur);
      }
      if (cur && (g(ci.action) || g(ci.expected)))
        cur.steps.push({
          id: uid(),
          action: g(ci.action),
          data: g(ci.data),
          expected: g(ci.expected),
        });
    }
    return out;
  })();
  const go = () => {
    let made = 0,
      linked = 0;
    edit((rr, pp) => {
      const folderFor = (n: string) => {
        if (!n) return folderId;
        let f = rr.folders.find((x: Any) => x.name === n);
        if (!f) {
          f = { id: uid(), name: n, parentId: null };
          rr.folders.push(f);
        }
        return f.id;
      };
      for (const t of tests) {
        const issueIds = t.issues
          .map((k: string) => pp.tickets.find((x: Any) => x.key === k)?.id)
          .filter(Boolean);
        linked += issueIds.length;
        rr.tests.push({
          id: uid(),
          key: nextKey(rr, pp, 't'),
          title: t.title,
          type: t.type,
          priority: t.priority,
          labels: t.labels,
          folderId: folderFor(t.folder),
          preconditions: t.preconditions,
          gherkin: t.gherkin,
          steps: t.steps,
          issueIds,
          source: t.srcKey ? { importedKey: t.srcKey } : undefined,
          createdAt: nowIso(),
          createdBy: me(),
        });
        made++;
      }
    });
    closeModal();
    toast(
      `${made} test${made === 1 ? '' : 's'} imported${linked ? `, ${linked} issue link${linked === 1 ? '' : 's'}` : ''}.`,
      'ok',
      {
        title: 'CSV imported',
      },
    );
  };
  return (
    <Modal
      title="Import tests from CSV"
      wide
      actions={[
        { label: 'Cancel' },
        {
          label: `Import ${tests.length} test${tests.length === 1 ? '' : 's'}`,
          kind: 'primary',
          disabled: !tests.length,
          onClick: go,
        },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Works with exports from Xray, BrowserStack Test Management, TestRail and this app: one row
        per step, with columns like <i>Summary / Title</i>, <i>Action</i>, <i>Data</i>,{' '}
        <i>Expected Result</i>, <i>Priority</i>, <i>Labels</i>, <i>Folder</i>, <i>Preconditions</i>,{' '}
        <i>Gherkin</i> and <i>Issues</i> (issue keys to link). Rows with the same title continue the
        same test.
      </p>
      <label className="btn">
        <Ico svg={I.upload} />
        {name || 'Choose a CSV file'}
        <input
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              setName(f.name);
              setRows(parseCsv(await f.text()));
            }
          }}
        />
      </label>
      {rows && ci.title < 0 && (
        <p className="warn-text small">
          No Summary / Title column found. Columns: {rows[0].join(', ')}
        </p>
      )}
      {tests.length > 0 && (
        <div className="split-list" style={{ marginTop: 10 }}>
          {tests.slice(0, 200).map((t: Any, i: number) => (
            <div key={i} className="split-row">
              <span className="key">{t.srcKey || '—'}</span>
              <span className="split-title">{t.title}</span>
              <span className="muted small">
                {t.type} · {t.steps.length} steps
                {t.issues.length ? ` · ${t.issues.join(', ')}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
/**
 * Traceability (requirement → test → latest run → defects), as CSV — the report Xray and
 * BrowserStack both provide.
 */
export function exportTraceability(epicId: string, env: string) {
  const p = P();
  const lines = [
    [
      'Issue',
      'Issue summary',
      'Issue status',
      'Epic',
      'Coverage',
      'Test',
      'Test summary',
      'Type',
      'Latest result',
      'Execution',
      'Environment',
      'Executed by',
      'Executed at',
      'Defects',
    ].join(','),
  ];
  for (const t of p.tickets.filter((x: Any) => !isSub(x) && (!epicId || x.epicId === epicId))) {
    const cov = coverageOf(t.id, p, env);
    const epic = p.epics.find((e: Any) => e.id === t.epicId);
    const base = [
      t.key,
      t.title,
      t.status,
      epic ? `${epic.key} ${epic.title}` : '',
      COV_LABEL[cov.status],
    ];
    if (!cov.tests.length) {
      lines.push([...base, '', '', '', '', '', '', '', '', ''].map(csvCell).join(','));
      continue;
    }
    for (const x of cov.tests) {
      const lr = latestRun(x.id, p, env);
      const defects = (lr?.defectIds || [])
        .map((id: string) => p.tickets.find((b: Any) => b.id === id)?.key)
        .filter(Boolean)
        .join(' ');
      lines.push(
        [
          ...base,
          x.key,
          x.title,
          x.type,
          lr ? STATUS_LABEL[lr.status] : 'Not run',
          lr?.execution.key || '',
          lr?.execution.environment || '',
          lr?.by || '',
          lr?.at || '',
          defects,
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  download(
    `${p.key}-traceability${env ? `-${env}` : ''}-${new Date().toISOString().slice(0, 10)}.csv`,
    lines.join('\n'),
  );
  toast('Traceability report downloaded');
}
/**
 * JUnit XML (Playwright, Jest, pytest, Cypress, Maven…) → results in an execution. A testcase
 * matches a test by key in its name, else by title.
 */
export function importJunit(execId: string, xml: string, file: string) {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('not XML');
  } catch {
    toast(`${file} isn’t a JUnit XML report.`, 'err');
    return;
  }
  const cases = [...doc.getElementsByTagName('testcase')];
  if (!cases.length) {
    toast(`No <testcase> in ${file}.`, 'err');
    return;
  }
  const r = repo();
  const e = r.executions.find((x: Any) => x.id === execId);
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const inExec = r.tests.filter((t: Any) => e?.testIds.includes(t.id));
  const pickTest = (name: string) => {
    const key = name.match(/[A-Z][A-Z0-9]+-T\d+/)?.[0];
    if (key) return r.tests.find((t: Any) => t.key === key);
    const n = norm(name);
    return (
      inExec.find((t: Any) => norm(t.title) === n) ||
      inExec.find((t: Any) => n.includes(norm(t.title)) || norm(t.title).includes(n)) ||
      r.tests.find((t: Any) => norm(t.title) === n)
    );
  };
  const results: Any[] = [];
  const unmatched: string[] = [];
  for (const c of cases) {
    const name = c.getAttribute('name') || '';
    const t = pickTest(`${name} ${c.getAttribute('classname') || ''}`) || pickTest(name);
    if (!t) {
      unmatched.push(name);
      continue;
    }
    const fail = c.getElementsByTagName('failure')[0] || c.getElementsByTagName('error')[0];
    const skip = c.getElementsByTagName('skipped')[0];
    results.push({
      t,
      status: fail ? 'FAILED' : skip ? 'BLOCKED' : 'PASSED',
      comment: fail
        ? `${fail.getAttribute('message') || ''}\n${(fail.textContent || '').trim().slice(0, 1500)}`.trim()
        : skip
          ? `Skipped${skip.getAttribute('message') ? `: ${skip.getAttribute('message')}` : ''}`
          : `Passed in ${c.getAttribute('time') || '?'}s`,
      time: c.getAttribute('time'),
    });
  }
  edit((rr) => {
    const ex = rr.executions.find((x: Any) => x.id === execId);
    if (!ex) return;
    ex.runs = ex.runs || {};
    for (const x of results) {
      if (!ex.testIds.includes(x.t.id)) ex.testIds.push(x.t.id);
      ex.runs[x.t.id] = {
        steps: {},
        defectIds: [],
        ...(ex.runs[x.t.id] || {}),
        status: x.status,
        comment: x.comment,
        automated: true,
        source: file,
        at: nowIso(),
        by: me(),
      };
    }
  });
  const c = counts(results.map((x) => x.status));
  toast(
    `${results.length} of ${cases.length} results matched: ${c.PASSED} passed, ${c.FAILED} failed, ${c.BLOCKED} skipped.${unmatched.length ? ` Not matched: ${unmatched.slice(0, 3).join('; ')}${unmatched.length > 3 ? '…' : ''} (put the test key, like ${r.tests[0]?.key || 'PROJ-T1'}, in the test name).` : ''}`,
    unmatched.length ? 'warn' : 'ok',
    { title: `Imported ${file}` },
  );
}
