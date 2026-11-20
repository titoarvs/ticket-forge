'use client';
// A backlog row. Rows are memoised on their signature (row-data.ts), so with thousands of issues
// only the rows that changed are drawn again.
import { memo } from 'react';
import { type Any, S, emit, release } from '../../core';
import {
  rowContextMenu,
  StatusCell,
  AssigneeCell,
  PointsCell,
  PriorityCell,
  MoreCell,
} from '../../RowActions';
import { TypeIcon, Ico, I, ELoz, StatusLoz, Avatar, LayerChip, PriorityIcon } from '../../ui';
import { openDrawer } from '../../actions';
import { CodeChip } from '../../codeStatus';
import { rowDnd } from '../row-dnd';
import { type RowData, rowData, pageSig } from './row-data';
import { showChecks, pickRange, toggleCheck } from './selection';

type RowProps = RowData & { zoneKey: string };

/** Up to two fix versions. */
function FixVersions({ t }: { t: Any }) {
  const list = (t.fixVersions || [])
    .map((v: string) => release(v))
    .filter(Boolean)
    .slice(0, 2);
  return (
    <span className="fixv-row">
      {list.map((r: Any) => (
        <span
          key={r.id}
          className={`ver-chip ${r.status === 'released' ? 'rel-done' : ''}`}
          title={`Fix version ${r.name}`}
        >
          {r.name}
        </span>
      ))}
    </span>
  );
}

/** Flagged, Blocked, versions, labels, sub-task progress, code and pull requests. */
function Badges({
  t,
  kc,
  blocked,
  full,
  compact,
}: {
  t: Any;
  kc: [number, number];
  blocked: boolean;
  full: boolean;
  compact: boolean;
}) {
  return (
    <>
      {t.flagged && (
        <span className="flag is-flag" title="Flagged">
          <Ico svg={I.flag} />
          Flagged
        </span>
      )}
      {blocked && (
        <span className="flag" title="Blocked by an open issue">
          <Ico svg={I.flag} />
          Blocked
        </span>
      )}
      {full && (t.fixVersions || []).length > 0 && <FixVersions t={t} />}
      {full && (
        <span className="lbls">
          {(t.labels || []).slice(0, 2).map((l: string) => (
            <span key={l} className="label-chip">
              {l}
            </span>
          ))}
        </span>
      )}
      {kc[1] > 0 && (
        <span className="mini" title={`${kc[0]} of ${kc[1]} sub-tasks done`}>
          <Ico svg={I.subtask} />
          {kc[0]}/{kc[1]}
        </span>
      )}
      <CodeChip t={t} compact={compact} />
      {t.prs.length > 0 && (
        <span className="mini" title={`${t.prs.length} pull request(s)`}>
          <Ico svg={I.pr} />
          {t.prs.length}
        </span>
      )}
    </>
  );
}

/** Full rows edit in place (status, assignee, points, priority); compact rows only show them. */
function Fields({ t, full }: { t: Any; full: boolean }) {
  if (!full)
    return (
      <>
        <StatusLoz s={t.status} />
        <Avatar name={t.assignee} />
        <span className="sp" title="Story points">
          {t.storyPoints ?? '–'}
        </span>
        <PriorityIcon p={t.priority} />
      </>
    );
  return (
    <>
      <StatusCell t={t} />
      <AssigneeCell t={t} />
      <LayerChip layer={t.layer} short />
      <PointsCell t={t} />
      <PriorityCell t={t} />
      <MoreCell t={t} />
    </>
  );
}

function RowCheck({ t, checked }: { t: Any; checked: boolean }) {
  return (
    <input
      type="checkbox"
      className="row-check"
      aria-label={`Select ${t.key}`}
      checked={checked}
      onClick={(ev) => {
        ev.stopPropagation();
        if (ev.shiftKey) {
          pickRange(t.id);
          emit();
          ev.preventDefault();
        }
      }}
      onChange={(ev) => toggleCheck(t.id, ev.target.checked)}
    />
  );
}

/** ⌘/Ctrl-click toggles the row, Shift-click selects a range, a plain click opens the issue. */
function rowClick(t: Any, full: boolean) {
  return (ev: React.MouseEvent) => {
    const selecting = full && showChecks();
    if (selecting && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      toggleCheck(t.id, !S.checked.has(t.id));
      return;
    }
    if (selecting && ev.shiftKey) {
      ev.preventDefault();
      window.getSelection()?.removeAllRanges();
      pickRange(t.id);
      emit();
      return;
    }
    openDrawer('issue', t.id);
  };
}

const RowView = memo(
  function RowView({ t, e, kc, blocked, active, checked, compact, zoneKey }: RowProps) {
    const zone = zoneKey ? JSON.parse(zoneKey) : null;
    const full = !compact;
    const cls = `irow ${active ? 'active' : ''} ${checked ? 'checked' : ''} ${t.flagged ? 'flagged' : ''}`;
    return (
      <div
        className={cls}
        onClick={rowClick(t, full)}
        onContextMenu={full ? (ev) => rowContextMenu(ev, t) : undefined}
        {...(zone && full ? rowDnd(t, zone) : {})}
      >
        {full && showChecks() && <RowCheck t={t} checked={checked} />}
        <TypeIcon type={t.type} />
        <span className="key">{t.key}</span>
        <span className="sum" title={t.title}>
          {t.title}
        </span>
        <span className="right">
          <Badges t={t} kc={kc} blocked={blocked} full={full} compact={compact} />
          {e && <ELoz e={e} />}
          <Fields t={t} full={full} />
        </span>
      </div>
    );
  },
  (a, b) => a.sig === b.sig && a.page === b.page && a.zoneKey === b.zoneKey && a.t === b.t,
);

/** One issue row, wherever it is used (Backlog, Epics …). */
export function IssueRow({
  t,
  showEpic = true,
  zone,
  compact = false,
}: {
  t: Any;
  showEpic?: boolean;
  zone?: Any;
  compact?: boolean;
}) {
  return (
    <RowView
      {...rowData(t, showEpic, compact, pageSig())}
      zoneKey={zone ? JSON.stringify(zone) : ''}
    />
  );
}

/**
 * A group's rows. Skipped entirely when none of its rows changed (sig), so opening a menu, a toast
 * or "Saved" doesn't redraw hundreds of rows; when one row changes, only that row redraws.
 */
export const GroupRows = memo(
  function GroupRows({ rows, zoneKey }: { rows: RowData[]; zoneKey: string; sig: string }) {
    return (
      <>
        {rows.map((r) => (
          <RowView key={r.t.id} {...r} zoneKey={zoneKey} />
        ))}
      </>
    );
  },
  (a, b) => a.sig === b.sig && a.zoneKey === b.zoneKey,
);
