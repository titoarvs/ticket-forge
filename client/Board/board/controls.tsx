'use client';
// Above the board: filters with the swimlane grouping, collapsing / expanding every lane, and the
// column tabs on tablets and phones.
import { S, type Any, saveUi, emit, wCls } from '../../core';
import { Ico, I } from '../../ui';
import { FilterBar } from '../../views';
import { laneClosed, laneKey, type BoardModel } from './use-board';

const GROUPS: [string, string][] = [
  ['none', 'None'],
  ['epic', 'Epic'],
  ['assignee', 'Assignee'],
];

function LanesToggle({ b }: { b: BoardModel }) {
  const { lanes } = b;
  const allClosed = lanes.every((l) => laneClosed(l.id));
  const toggleAll = () => {
    lanes.forEach((l) =>
      allClosed ? S.collapsed.delete(laneKey(l.id)) : S.collapsed.add(laneKey(l.id)),
    );
    saveUi();
    emit();
  };
  return (
    <button className="btn subtle sm board-lanes-toggle" onClick={toggleAll}>
      <Ico svg={allClosed ? I.expand : I.collapse} />
      {allClosed ? 'Expand all lanes' : 'Collapse all lanes'}
    </button>
  );
}

function ColumnTabs({ b }: { b: BoardModel }) {
  return (
    <div className="board-tabs" role="tablist" aria-label="Board columns">
      {b.wf.map((w: Any) => (
        <button
          key={w.id}
          role="tab"
          aria-selected={w.id === b.tab}
          className={`board-tab ${w.id === b.tab ? 'on' : ''}`}
          onClick={() => {
            S.boardTab = w.id;
            emit();
          }}
        >
          <span className={`dot-cat ${wCls(w)}`} />
          <span className="board-tab-name">{w.name}</span>
          <span className="board-tab-n">{b.all.get(w.name)!.length}</span>
        </button>
      ))}
    </div>
  );
}

export function BoardControls({ b }: { b: BoardModel }) {
  const group = {
    value: b.group,
    options: GROUPS,
    onChange: (v: string) => {
      S.boardGroup = v;
      saveUi();
      emit();
    },
  };
  return (
    <>
      <FilterBar status={false} group={group} />
      {b.lanes.length > 1 && <LanesToggle b={b} />}
      {b.narrow && b.wf.length > 1 && <ColumnTabs b={b} />}
    </>
  );
}
