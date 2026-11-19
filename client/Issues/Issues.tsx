'use client';
// The issue navigator: views on the left; filters, bulk changes and the issues table on the right.
// The parts are in client/Issues/navigator/.
import { useStore, can } from '../core';
import { Ico, I } from '../ui';
import { openCreateIssue } from '../actions';
import { BulkBar } from '../views';
import { useIssues } from './navigator/use-issues';
import { exportIssuesCsv } from './navigator/filter';
import { ViewsSide } from './navigator/views-side';
import { FiltersBar } from './navigator/filters-bar';
import { SumLine, IssuesTable } from './navigator/issues-table';

export function Issues() {
  useStore();
  const g = useIssues();
  return (
    <div className="page">
      <div className="page-inner iss-page">
        <div className="page-h">
          <h1>Issues</h1>
          <span className="spacer" />
          <button
            className="btn"
            onClick={() => exportIssuesCsv(g.p.key, g.rows, g.cols)}
            disabled={!g.rows.length}
          >
            <Ico svg={I.download} />
            Export CSV
          </button>
          {can('issue.create') && (
            <button className="btn primary" onClick={() => openCreateIssue()}>
              <Ico svg={I.plus} />
              Create issue
            </button>
          )}
        </div>
        <div className="iss-layout">
          <ViewsSide g={g} />
          <div className="iss-main">
            <FiltersBar g={g} />
            <BulkBar />
            <SumLine rows={g.rows} />
            <IssuesTable g={g} />
          </div>
        </div>
      </div>
    </div>
  );
}
