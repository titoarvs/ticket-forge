'use client';
// The tests list: search and filter, writing / importing / exporting tests, and the table (or an
// empty state).
import { type Any, openModal, can } from '../../core';
import { Ico, I, EmptyState } from '../../ui';
import { TF, SF, MenuItem } from '../../fields';
import { openDrawer } from '../../actions';
import { wfOf, canEdit, WF, latestRun, WfLoz, RunLoz } from '../TestManagement';
import { AiWriteModal } from '../record-automation-result';
import { openTest, ImportModal } from '../open-test';
import { exportTestsCsv } from '../TestsSection';
import { CsvImportModal } from '../CsvImportModal';
import type { Repo } from './use-repository';

function Filters({ g }: { g: Repo }) {
  return (
    <>
      <TF
        search
        sx={{ width: 260, maxWidth: '100%' }}
        placeholder="Search tests"
        value={g.q}
        onChange={(e) => g.setQ(e.target.value)}
      />
      <SF
        filter
        value={g.wf}
        onChange={(e) => g.setWf(e.target.value)}
        aria-label="Workflow status"
      >
        <MenuItem value="">Active (not deprecated)</MenuItem>
        {WF.map((x) => (
          <MenuItem key={x} value={x}>
            {x} ({g.r.tests.filter((t: Any) => wfOf(t) === x).length})
          </MenuItem>
        ))}
        <MenuItem value="all">All</MenuItem>
      </SF>
    </>
  );
}

function Toolbar({ g }: { g: Repo }) {
  const { folder, cur, selIssue, list } = g;
  const ed = canEdit();
  const folderId = cur?.id || null;
  return (
    <div className="toolbar">
      <Filters g={g} />
      <span className="spacer" />
      {ed && can('ai.use') && (
        <button
          className="btn sm ai"
          onClick={() => openModal(<AiWriteModal scope={folder} folderId={folderId} />)}
          title="The AI writes repository tests for issues, following your test standard (Administration → Generation)"
        >
          <Ico svg={I.sparkle} />
          Write tests with AI
        </button>
      )}
      {selIssue && ed && (
        <button className="btn sm" onClick={() => openTest(null, null, selIssue.id)}>
          <Ico svg={I.plus} />
          New test for {selIssue.key}
        </button>
      )}
      <button
        className="btn sm subtle"
        onClick={() => exportTestsCsv(list)}
        title="Export these tests as CSV (one row per step: Xray / BrowserStack style)"
      >
        <Ico svg={I.download} />
        Export CSV
      </button>
      {ed && (
        <button
          className="btn sm subtle"
          onClick={() => openModal(<CsvImportModal folderId={folderId} />)}
        >
          <Ico svg={I.upload} />
          Import CSV
        </button>
      )}
      {ed && (
        <button className="btn sm" onClick={() => openModal(<ImportModal folderId={folderId} />)}>
          <Ico svg={I.upload} />
          Import from issues
        </button>
      )}
    </div>
  );
}

/** The first three issues the test covers (each opens the issue), then "+N". */
function IssueLinks({ p, t }: { p: Any; t: Any }) {
  const ids = t.issueIds || [];
  return (
    <td onClick={(e) => e.stopPropagation()}>
      {ids
        .map((id: string) => p.tickets.find((x: Any) => x.id === id))
        .filter(Boolean)
        .slice(0, 3)
        .map((x: Any) => (
          <button
            key={x.id}
            className="link-btn key small"
            onClick={() => openDrawer('issue', x.id)}
          >
            {x.key}
          </button>
        ))}
      {ids.length > 3 ? <span className="muted small"> +{ids.length - 3}</span> : null}
    </td>
  );
}

function TestRow({ p, t }: { p: Any; t: Any }) {
  const lr = latestRun(t.id);
  return (
    <tr className="click" onClick={() => openTest(t)}>
      <td className="key">{t.key}</td>
      <td>
        {t.title}
        {t.labels?.length ? (
          <span className="lbls">
            {t.labels.slice(0, 2).map((l: string) => (
              <span key={l} className="label-chip">
                {l}
              </span>
            ))}
          </span>
        ) : null}
      </td>
      <td>
        <WfLoz t={t} />
        {(t.version || 1) > 1 && <span className="muted small"> v{t.version}</span>}
      </td>
      <td className="muted">{t.type}</td>
      <td className="num muted">{t.steps?.length || 0}</td>
      <IssueLinks p={p} t={t} />
      <td>
        {lr ? (
          <>
            <RunLoz s={lr.status} /> <span className="muted small">{lr.execution.key}</span>
          </>
        ) : (
          <span className="muted small">Not run</span>
        )}
      </td>
    </tr>
  );
}

function Empty({ g }: { g: Repo }) {
  const any = g.r.tests.length > 0;
  const actions = canEdit() && (
    <>
      <button className="btn primary" onClick={() => openTest(null, g.cur?.id)}>
        <Ico svg={I.plus} />
        New test
      </button>
      {!any && (
        <button className="btn" onClick={() => openModal(<ImportModal folderId={null} />)}>
          <Ico svg={I.upload} />
          Import from issues
        </button>
      )}
    </>
  );
  return (
    <EmptyState
      compact
      icon={I.test}
      tone="neutral"
      title={any ? 'No tests here' : 'No tests yet'}
      actions={actions}
    >
      <p>
        {any
          ? 'Pick another folder, or clear the search.'
          : 'Create reusable tests, or import the test cases your issues already have. Each test can cover several issues.'}
      </p>
    </EmptyState>
  );
}

export function TestsList({ g }: { g: Repo }) {
  return (
    <section className="xr-list">
      <Toolbar g={g} />
      {g.list.length ? (
        <table className="tbl xr-tests">
          <thead>
            <tr>
              <th>Key</th>
              <th>Test</th>
              <th>Status</th>
              <th>Type</th>
              <th>Steps</th>
              <th>Issues</th>
              <th>Latest result</th>
            </tr>
          </thead>
          <tbody>
            {g.list.map((t: Any) => (
              <TestRow key={t.id} p={g.p} t={t} />
            ))}
          </tbody>
        </table>
      ) : (
        <Empty g={g} />
      )}
    </section>
  );
}
