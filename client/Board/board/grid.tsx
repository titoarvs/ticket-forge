'use client';
// The board grid: a sticky header per column (count, limit, collapse, create), then per lane its
// header and one cell per column holding the cards and quick create. Cards drop on any cell.
import { S, type Any, wCls } from '../../core';
import { Ico, I } from '../../ui';
import { zoneDnd } from '../../views';
import { Card, QuickCreate } from '../Card';
import { byStatus, cardSig, type Lane } from './lanes';
import { flip, laneClosed, laneKey, type BoardModel } from './use-board';

type ColProps = { b: BoardModel; w: Any };

function ColumnHead({ b, w }: ColProps) {
  const n = b.all.get(w.name)!.length;
  const over = w.wip && n > w.wip;
  const collapsed = b.isCollapsed(w.id);
  return (
    <div
      className={`bcol-h ${collapsed ? 'collapsed' : ''} ${over ? 'over' : ''}`}
      data-drop-status={w.name}
      {...zoneDnd({ status: w.name })}
    >
      {collapsed ? (
        <button
          className="bcol-strip"
          onClick={() => b.toggleCol(w.id)}
          title={`Expand ${w.name}`}
          aria-label={`Expand column ${w.name} (${n} issues)`}
        >
          <span className={`bcol-n ${over ? 'over' : ''}`}>{n}</span>
        </button>
      ) : (
        <OpenColumnHead b={b} w={w} n={n} over={Boolean(over)} />
      )}
    </div>
  );
}

function OpenColumnHead({ b, w, n, over }: ColProps & { n: number; over: boolean }) {
  return (
    <>
      <span className={`dot-cat ${wCls(w)}`} />
      <span className="bcol-name" title={w.name}>
        {w.name}
      </span>
      <span
        className={`bcol-count ${over ? 'over' : ''}`}
        title={w.wip ? `${n} issues · column limit ${w.wip}` : `${n} issues`}
      >
        ({n}
        {w.wip ? <span className="muted"> / {w.wip}</span> : null})
      </span>
      {w.category === 'done' && <Ico svg={I.check} className="bcol-done" />}
      {!b.narrow && (
        <button
          className="icon-btn bcol-collapse"
          onClick={() => b.toggleCol(w.id)}
          title="Collapse column"
          aria-label={`Collapse column ${w.name}`}
        >
          <Ico svg={I.chevron} />
        </button>
      )}
      {b.createOk && b.lanes.some((l) => !laneClosed(l.id)) && (
        <button
          className="icon-btn bcol-add"
          title={`Create issue in ${w.name}`}
          aria-label={`Create issue in ${w.name}`}
          onClick={() => b.openCreate(w)}
        >
          <Ico svg={I.plus} />
        </button>
      )}
    </>
  );
}

function LaneHead({ l }: { l: Lane }) {
  const closed = laneClosed(l.id);
  return (
    <div className={`lane-h ${closed ? 'closed' : ''}`}>
      <button
        className="lane-toggle"
        aria-expanded={!closed}
        onClick={() => flip(S.collapsed, laneKey(l.id))}
      >
        <Ico svg={I.chevron} />
        {l.title}
        <span className="muted small">
          {l.items.length} issue{l.items.length === 1 ? '' : 's'}
        </span>
      </button>
    </div>
  );
}

type CellProps = ColProps & { l: Lane; items: Any[]; first: boolean; last: boolean };

function LaneCell({ b, w, l, items, first, last }: CellProps) {
  const zone = { status: w.name, ...l.zone };
  const collapsed = b.isCollapsed(w.id);
  const zk = JSON.stringify(zone);
  return (
    <div
      className={`bcol ${collapsed ? 'collapsed' : ''} ${first ? 'first' : ''} ${last ? 'last' : ''}`}
      data-drop-status={w.name}
      {...zoneDnd(zone)}
    >
      {collapsed && (
        <button
          className="bcol-strip body"
          onClick={() => b.toggleCol(w.id)}
          title={`Expand ${w.name}`}
          aria-label={`Expand column ${w.name}`}
        >
          <span className="bcol-vname">{w.name}</span>
          {items.length > 0 && <span className="bcol-n">{items.length}</span>}
        </button>
      )}
      {!collapsed &&
        items.map((t: Any) => (
          <Card
            key={t.id}
            t={t}
            kidsDone={b.kidCount.get(t.id)?.[0] || 0}
            kids={b.kidCount.get(t.id)?.[1] || 0}
            showEpic={b.group !== 'epic'}
            zoneKey={zk}
            active={S.drawer?.id === t.id}
            v={cardSig(t)}
          />
        ))}
      {!collapsed && b.createOk && (
        <QuickCreate
          id={`${l.id}|${w.id}`}
          status={w.name}
          fields={{ ...b.sprintFields, ...l.fields }}
        />
      )}
    </div>
  );
}

/** A lane's header (when grouped) and, unless collapsed, its cells. */
function laneParts(b: BoardModel, l: Lane, li: number) {
  const m = byStatus(b.wf, l.items);
  const head = l.title && <LaneHead key={`lh-${l.id}`} l={l} />;
  if (laneClosed(l.id)) return [head];
  return [
    head,
    ...b.shown.map((w: Any, wi: number) => (
      <LaneCell
        key={`${l.id}-${w.id}`}
        b={b}
        w={w}
        l={l}
        items={m.get(w.name)!}
        first={wi === 0}
        last={li === b.lanes.length - 1}
      />
    )),
  ];
}

export function BoardGrid({ b }: { b: BoardModel }) {
  const narrow = b.narrow ? 'narrow' : '';
  return (
    <div className={`board-wrap ${narrow}`} tabIndex={-1}>
      <div className={`board ${narrow}`} style={{ ['--cols' as string]: b.cols }}>
        {b.shown.map((w: Any) => (
          <ColumnHead key={`h-${w.id}`} b={b} w={w} />
        ))}
        {b.lanes.map((l, li) => laneParts(b, l, li))}
      </div>
    </div>
  );
}
