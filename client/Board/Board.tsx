'use client';
import Link from 'next/link';
import {
  P,
  activeSprint,
  S,
  type Any,
  filtered,
  saveUi,
  emit,
  can,
  isDone,
  epic,
  openModal,
  wCls,
  filtersActive,
  EMPTY_FILTER,
} from '../core';
import { TypeIcon, Avatar, Ico, I, EmptyState } from '../ui';
import { CompleteSprintModal } from '../actions';
import { SF, MenuItem } from '../fields';
import { daysLeft, Header, FilterBar, zoneDnd } from '../views';
import { codeSig } from '../codeStatus';
import { useNarrow, COLLAPSED_W, Card, QuickCreate } from './Card';

export function Board() {
  const p = P();
  const act = activeSprint();
  const useSprint = act && !S.boardAll;
  const wf: Any[] = p.workflow;
  const list = filtered(
    useSprint ? p.tickets.filter((t: Any) => t.sprintId === act.id) : p.tickets,
  );
  const collapsed: Set<string> = S.boardCollapsed;
  const toggleCol = (id: string) => {
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    saveUi();
    emit();
  };
  const createOk = can('issue.create');
  const group = S.boardGroup;

  // Tablets and phones: one column at a time, picked with the tabs above the board (collapsing
  // doesn't apply there).
  const narrow = useNarrow();
  const tab: string = wf.some((w) => w.id === S.boardTab) ? S.boardTab : wf[0]?.id;
  const shown = narrow ? wf.filter((w) => w.id === tab) : wf;
  const isCollapsed = (id: string) => !narrow && collapsed.has(id);
  // Column widths: collapsed columns are a narrow strip.
  const cols = shown
    .map((w) =>
      narrow ? 'minmax(0, 1fr)' : isCollapsed(w.id) ? `${COLLAPSED_W}px` : 'minmax(264px, 1fr)',
    )
    .join(' ');

  const byStatus = (items: Any[]) => {
    const m = new Map<string, Any[]>(wf.map((w) => [w.name, []]));
    for (const t of items) m.get(t.status)?.push(t);
    return m;
  };
  const all = byStatus(list);
  // Sub-task progress per issue, counted once per render rather than per card.
  const kidCount = new Map<string, [number, number]>();
  for (const k of p.tickets)
    if (k.parentId) {
      const c = kidCount.get(k.parentId) || [0, 0];
      c[1]++;
      if (isDone(k)) c[0]++;
      kidCount.set(k.parentId, c);
    }

  // Swimlanes.
  type Lane = { id: string; title: React.ReactNode; items: Any[]; zone: Any; fields: Any };
  let lanes: Lane[];
  if (group === 'epic') {
    lanes = [
      ...p.epics.map((e: Any) => ({
        id: `e:${e.id}`,
        title: (
          <>
            <TypeIcon type="Epic" />
            <span className="key">{e.key}</span> {e.title}
          </>
        ),
        items: list.filter((t: Any) => t.epicId === e.id),
        zone: { epic: e.id },
        fields: { epicId: e.id },
      })),
      {
        id: 'e:none',
        title: 'Issues without epic',
        items: list.filter((t: Any) => !epic(t.epicId)),
        zone: { epic: null },
        fields: {},
      },
    ];
  } else if (group === 'assignee') {
    const names = [...new Set(list.map((t: Any) => t.assignee).filter(Boolean))].sort() as string[];
    lanes = [
      ...names.map((n) => ({
        id: `a:${n}`,
        title: (
          <>
            <Avatar name={n} /> {n}
          </>
        ),
        items: list.filter((t: Any) => t.assignee === n),
        zone: { assignee: n },
        fields: { assignee: n },
      })),
      {
        id: 'a:none',
        title: (
          <>
            <Avatar name="" /> Unassigned
          </>
        ),
        items: list.filter((t: Any) => !t.assignee),
        zone: { assignee: null },
        fields: {},
      },
    ];
  } else lanes = [{ id: 'all', title: null, items: list, zone: {}, fields: {} }];
  lanes = lanes.filter((l) => l.items.length || l.id === 'all');
  const sprintFields = useSprint ? { sprintId: act.id } : {};

  const left = useSprint ? daysLeft(act) : null;
  const noSprint = p.sprints.length > 0 && !act && !S.boardAll;
  const openCreate = (w: Any) => {
    const l = lanes.find((x) => !S.collapsed.has(`lane:${x.id}`));
    if (l) {
      S.boardCreate = `${l.id}|${w.id}`;
      emit();
    }
  };
  const allCollapsed = lanes.length > 1 && lanes.every((l) => S.collapsed.has(`lane:${l.id}`));

  return (
    <>
      <Header
        title={useSprint ? act.name : 'Board'}
        right={
          <>
            {p.sprints.length > 0 && (
              <SF
                filter
                aria-label="Board scope"
                value={S.boardAll ? 'all' : 'sprint'}
                onChange={(e) => {
                  S.boardAll = e.target.value === 'all';
                  emit();
                }}
              >
                <MenuItem value="sprint">Active sprint</MenuItem>
                <MenuItem value="all">All issues</MenuItem>
              </SF>
            )}
            {useSprint && (
              <>
                <span className="muted small row" style={{ gap: 4 }}>
                  <Ico svg={I.clock} />
                  {left === null
                    ? 'No end date'
                    : left >= 0
                      ? `${left} days remaining`
                      : `${-left} days overdue`}
                </span>
                {can('sprint.manage') && (
                  <button
                    className="btn"
                    onClick={() => openModal(<CompleteSprintModal s={act} />)}
                  >
                    Complete sprint
                  </button>
                )}
              </>
            )}
          </>
        }
      />
      {useSprint && act.goal && (
        <p className="muted board-goal">
          <Ico svg={I.flag} /> {act.goal}
        </p>
      )}
      {noSprint ? (
        <EmptyState
          icon={I.board}
          title="No active sprint"
          actions={
            <>
              <Link className="btn primary" href={`/p/${p.id}/backlog`}>
                Go to backlog
              </Link>
              <button
                className="btn"
                onClick={() => {
                  S.boardAll = true;
                  emit();
                }}
              >
                Show all issues
              </button>
            </>
          }
        >
          <p>
            Start a sprint from the backlog to track its issues here, or show every issue on the
            board.
          </p>
        </EmptyState>
      ) : (
        <>
          <FilterBar
            status={false}
            group={{
              value: group,
              options: [
                ['none', 'None'],
                ['epic', 'Epic'],
                ['assignee', 'Assignee'],
              ],
              onChange: (v) => {
                S.boardGroup = v;
                saveUi();
                emit();
              },
            }}
          />
          {lanes.length > 1 && (
            <button
              className="btn subtle sm board-lanes-toggle"
              onClick={() => {
                lanes.forEach((l) =>
                  allCollapsed
                    ? S.collapsed.delete(`lane:${l.id}`)
                    : S.collapsed.add(`lane:${l.id}`),
                );
                saveUi();
                emit();
              }}
            >
              <Ico svg={allCollapsed ? I.expand : I.collapse} />
              {allCollapsed ? 'Expand all lanes' : 'Collapse all lanes'}
            </button>
          )}
          {narrow && wf.length > 1 && (
            <div className="board-tabs" role="tablist" aria-label="Board columns">
              {wf.map((w) => (
                <button
                  key={w.id}
                  role="tab"
                  aria-selected={w.id === tab}
                  className={`board-tab ${w.id === tab ? 'on' : ''}`}
                  onClick={() => {
                    S.boardTab = w.id;
                    emit();
                  }}
                >
                  <span className={`dot-cat ${wCls(w)}`} />
                  <span className="board-tab-name">{w.name}</span>
                  <span className="board-tab-n">{all.get(w.name)!.length}</span>
                </button>
              ))}
            </div>
          )}
          <div className={`board-wrap ${narrow ? 'narrow' : ''}`} tabIndex={-1}>
            <div
              className={`board ${narrow ? 'narrow' : ''}`}
              style={{ ['--cols' as string]: cols }}
            >
              {/* Column headers (sticky) */}
              {shown.map((w) => {
                const n = all.get(w.name)!.length;
                const over = w.wip && n > w.wip;
                const c = isCollapsed(w.id);
                return (
                  <div
                    key={`h-${w.id}`}
                    className={`bcol-h ${c ? 'collapsed' : ''} ${over ? 'over' : ''}`}
                    data-drop-status={w.name}
                    {...zoneDnd({ status: w.name })}
                  >
                    {c ? (
                      <button
                        className="bcol-strip"
                        onClick={() => toggleCol(w.id)}
                        title={`Expand ${w.name}`}
                        aria-label={`Expand column ${w.name} (${n} issues)`}
                      >
                        <span className={`bcol-n ${over ? 'over' : ''}`}>{n}</span>
                      </button>
                    ) : (
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
                        {!narrow && (
                          <button
                            className="icon-btn bcol-collapse"
                            onClick={() => toggleCol(w.id)}
                            title="Collapse column"
                            aria-label={`Collapse column ${w.name}`}
                          >
                            <Ico svg={I.chevron} />
                          </button>
                        )}
                        {createOk && lanes.some((l) => !S.collapsed.has(`lane:${l.id}`)) && (
                          <button
                            className="icon-btn bcol-add"
                            title={`Create issue in ${w.name}`}
                            aria-label={`Create issue in ${w.name}`}
                            onClick={() => openCreate(w)}
                          >
                            <Ico svg={I.plus} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}

              {lanes.map((l, li) => {
                const closed = S.collapsed.has(`lane:${l.id}`);
                const m = byStatus(l.items);
                return [
                  l.title && (
                    <div key={`lh-${l.id}`} className={`lane-h ${closed ? 'closed' : ''}`}>
                      <button
                        className="lane-toggle"
                        aria-expanded={!closed}
                        onClick={() => {
                          if (closed) S.collapsed.delete(`lane:${l.id}`);
                          else S.collapsed.add(`lane:${l.id}`);
                          saveUi();
                          emit();
                        }}
                      >
                        <Ico svg={I.chevron} />
                        {l.title}
                        <span className="muted small">
                          {l.items.length} issue{l.items.length === 1 ? '' : 's'}
                        </span>
                      </button>
                    </div>
                  ),
                  ...(closed
                    ? []
                    : shown.map((w, wi) => {
                        const zone = { status: w.name, ...l.zone };
                        const items = m.get(w.name)!;
                        const c = isCollapsed(w.id);
                        const zk = JSON.stringify(zone);
                        return (
                          <div
                            key={`${l.id}-${w.id}`}
                            className={`bcol ${c ? 'collapsed' : ''} ${wi === 0 ? 'first' : ''} ${li === lanes.length - 1 ? 'last' : ''}`}
                            data-drop-status={w.name}
                            {...zoneDnd(zone)}
                          >
                            {c && (
                              <button
                                className="bcol-strip body"
                                onClick={() => toggleCol(w.id)}
                                title={`Expand ${w.name}`}
                                aria-label={`Expand column ${w.name}`}
                              >
                                <span className="bcol-vname">{w.name}</span>
                                {items.length > 0 && <span className="bcol-n">{items.length}</span>}
                              </button>
                            )}
                            {!c &&
                              items.map((t: Any) => (
                                <Card
                                  key={t.id}
                                  t={t}
                                  kidsDone={kidCount.get(t.id)?.[0] || 0}
                                  kids={kidCount.get(t.id)?.[1] || 0}
                                  showEpic={group !== 'epic'}
                                  zoneKey={zk}
                                  active={S.drawer?.id === t.id}
                                  v={`${codeSig(t)}|${t.updatedAt}|${t.flagged ? 1 : 0}|${t.status}|${t.title}|${t.assignee}|${t.storyPoints}|${t.priority}|${t.epicId}|${t.prs.length}|${(t.links || []).length}|${(t.labels || []).join()}|${(t.comments || []).length}|${(t.testCases || []).map((x: Any) => x.status).join()}`}
                                />
                              ))}
                            {!c && createOk && (
                              <QuickCreate
                                id={`${l.id}|${w.id}`}
                                status={w.name}
                                fields={{ ...sprintFields, ...l.fields }}
                              />
                            )}
                          </div>
                        );
                      })),
                ];
              })}
            </div>
          </div>
          {!list.length &&
            (filtersActive() ? (
              <EmptyState
                compact
                icon={I.search}
                tone="neutral"
                title="No issues match your filters"
                actions={
                  <button
                    className="btn"
                    onClick={() => {
                      S.filter = EMPTY_FILTER();
                      emit();
                    }}
                  >
                    Clear filters
                  </button>
                }
              />
            ) : (
              <EmptyState
                compact
                icon={I.board}
                tone="neutral"
                title={useSprint ? 'No issues in this sprint yet' : 'No issues yet'}
                actions={
                  <Link className="btn" href={`/p/${p.id}/backlog`}>
                    Go to backlog
                  </Link>
                }
              >
                <p>
                  {useSprint
                    ? 'Drag issues into the sprint from the backlog, or create one in a column.'
                    : 'Create issues in the backlog or in a column to see them here.'}
                </p>
              </EmptyState>
            ))}
        </>
      )}
    </>
  );
}
