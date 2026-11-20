'use client';
// The Pull requests page. This component only puts the parts in client/PullRequests/list/
// together.
import { useState } from 'react';
import { useStore, P, type Any, can, openModal } from '../core';
import { Ico, I, EmptyState } from '../ui';
import { codeReady } from '../DevCode';
import { ACTIVE } from './PrDetails';
import { LinkModal } from './ReviewModal';
import { type PrRow, type PrGroup, usePrFilters, filterRows, groupRows } from './list/filters';
import { usePrRefresh } from './list/use-refresh';
import { PrListRow } from './list/pr-row';
import { PageHead, Intro, StatusTabs, FocusChips, Tools } from './list/page-top';

function NoPullRequests() {
  return (
    <EmptyState
      icon={I.pr}
      title="No pull requests yet"
      actions={
        can('issue.edit') ? (
          <button className="btn primary" onClick={() => openModal(<LinkModal />)}>
            <Ico svg={I.plus} />
            Link pull request
          </button>
        ) : undefined
      }
    >
      <p>
        Pull requests appear here when a coding agent opens one (Write code with AI on an issue), or
        when you link one to an issue.
      </p>
    </EmptyState>
  );
}

function NoMatch({ onShowAll }: { onShowAll: () => void }) {
  return (
    <EmptyState
      compact
      icon={I.search}
      tone="neutral"
      title="No pull requests match"
      actions={
        <button className="btn" onClick={onShowAll}>
          Show all
        </button>
      }
    />
  );
}

type ListProps = { groups: PrGroup[]; ai: boolean; refreshing: boolean };

/** The groups of rows; one row's details are open at a time. */
function PrList({ groups, ai, refreshing }: ListProps) {
  const [open, setOpen] = useState<string | null>(null);
  const row = ({ t, r }: PrRow) => {
    const id = `${t.id}-${r.id}`;
    return (
      <PrListRow
        key={id}
        t={t}
        r={r}
        ai={ai}
        open={open === id}
        onToggle={() => setOpen(open === id ? null : id)}
        refreshing={refreshing}
      />
    );
  };
  return (
    <>
      {groups.map((g) => (
        <div key={g.key} className="pr-group">
          {g.title && (
            <h3 className="pr-group-h">
              {g.title}
              <span className="count">{g.items.length}</span>
            </h3>
          )}
          <div className="pr-list">{g.items.map(row)}</div>
        </div>
      ))}
    </>
  );
}

export function PullRequests() {
  useStore();
  const p = P();
  const rows: PrRow[] = p.tickets.flatMap((t: Any) => (t.prs || []).map((r: Any) => ({ t, r })));
  const f = usePrFilters();
  const { progress, refreshList } = usePrRefresh(rows, p.id, can('issue.edit'));
  const ai = can('ai.use') && codeReady();
  const shown = filterRows(rows, f);
  const refreshOpen = () =>
    refreshList(
      rows.filter((x) => ACTIVE.includes(x.r.status)),
      false,
    );
  return (
    <div className="page">
      <div className="page-inner">
        <PageHead rows={rows} ai={ai} progress={progress} refreshOpen={refreshOpen} />
        <Intro ai={ai} />
        <StatusTabs rows={rows} f={f} />
        <FocusChips rows={rows} f={f} />
        <Tools rows={rows} shown={shown.length} f={f} />
        {!rows.length ? (
          <NoPullRequests />
        ) : !shown.length ? (
          <NoMatch onShowAll={f.clearAll} />
        ) : (
          <PrList groups={groupRows(shown, f.group)} ai={ai} refreshing={Boolean(progress)} />
        )}
      </div>
    </div>
  );
}
