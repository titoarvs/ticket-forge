'use client';
import { memo } from 'react';
import {
  P,
  filtered,
  type Any,
  isSub,
  S,
  statusNames,
  epic,
  filtersActive,
  openSprints,
  sprint,
  isDone,
  can,
  emit,
  releases,
  idx,
  release,
  activeSprint,
  saveUi,
  openModal,
  fmtDate,
  spSum,
  EMPTY_FILTER,
} from '../core';
import {
  rowContextMenu,
  StatusCell,
  AssigneeCell,
  PointsCell,
  PriorityCell,
  MoreCell,
} from '../RowActions';
import {
  TypeIcon,
  Ico,
  I,
  ELoz,
  StatusLoz,
  Avatar,
  LayerChip,
  PriorityIcon,
  Swatch,
  EmptyState,
} from '../ui';
import {
  openDrawer,
  NewWithClaudeModal,
  SprintModal,
  CompleteSprintModal,
  deleteSprint,
  createSprint,
  openCreateIssue,
  addEpic,
} from '../actions';
import { FeatureModal } from '../FeatureModal';
import { useAutoTour } from '../tour';
import { codeSig, CodeChip } from '../codeStatus';
import { openDevOrder } from '../DevPlan';
import { rowDnd, Header, FilterBar, zoneDnd, Tally } from './row-dnd';
import { BulkBar, InlineCreate } from './BulkBar';

// ---------------------------------------------------------------- backlog
function backlogGroups() {
  const p = P();
  const list = filtered(p.tickets).filter((t: Any) => !isSub(t) || S.filter.type === 'Sub-task');
  if (S.groupBy === 'status')
    return statusNames().map((s) => ({
      id: `s:${s}`,
      kind: 'status',
      title: s,
      items: list.filter((t: Any) => t.status === s),
    }));
  if (S.groupBy === 'none') return [{ id: 'all', kind: 'none', title: 'All issues', items: list }];
  if (S.groupBy === 'epic') {
    const groups: Any[] = p.epics.map((e: Any) => ({
      id: `e:${e.id}`,
      kind: 'epic',
      epic: e,
      title: e.title,
      items: list.filter((t: Any) => t.epicId === e.id),
    }));
    groups.push({
      id: 'e:none',
      kind: 'epic',
      title: 'Issues without epic',
      items: list.filter((t: Any) => !epic(t.epicId)),
    });
    return groups.filter((g) => g.items.length || (!filtersActive() && g.epic));
  }
  const sp = [...openSprints()].sort((a: Any, b: Any) =>
    a.state === 'active' ? -1 : b.state === 'active' ? 1 : 0,
  );
  const inOpen = (t: Any) => sp.some((s: Any) => s.id === t.sprintId);
  const groups: Any[] = sp.map((s: Any) => ({
    id: `sp:${s.id}`,
    kind: 'sprint',
    sprint: s,
    title: s.name,
    items: list.filter((t: Any) => t.sprintId === s.id),
  }));
  groups.push({
    id: 'sp:none',
    kind: 'sprint',
    title: 'Backlog',
    items: list.filter(
      (t: Any) => !inOpen(t) && !(sprint(t.sprintId)?.state === 'closed' && isDone(t)),
    ),
  });
  return groups;
}
const showChecks = () =>
  can('issue.edit') || can('issue.delete') || can('sprint.manage') || can('test.run');
// ---- selection, Jira-style: tick boxes, ⌘/Ctrl-click a row to add or remove it, Shift-click to
// select a range.
let lastPick: string | null = null;
let visibleIds: string[] = [];
function pickRange(id: string) {
  const a = lastPick ? visibleIds.indexOf(lastPick) : -1,
    b = visibleIds.indexOf(id);
  if (a < 0 || b < 0) {
    S.checked.add(id);
    lastPick = id;
    return;
  }
  for (const x of visibleIds.slice(Math.min(a, b), Math.max(a, b) + 1)) S.checked.add(x);
}
function toggleCheck(id: string, on: boolean) {
  if (on) S.checked.add(id);
  else S.checked.delete(id);
  lastPick = id;
  emit();
}
/**
 * What a row shows, as one string: the row redraws only when this changes (thousands of rows stay
 * fast).
 */
function rowSig(
  t: Any,
  x: {
    e: Any;
    kids: [number, number];
    blocked: boolean;
    active: boolean;
    checked: boolean;
    showEpic: boolean;
    compact: boolean;
    popped: boolean;
  },
) {
  return [
    t.updatedAt,
    t.key,
    t.type,
    t.title,
    t.status,
    t.assignee,
    t.storyPoints,
    t.priority,
    t.flagged ? 1 : 0,
    t.layer,
    (t.labels || []).slice(0, 2).join(','),
    (t.fixVersions || []).join(','),
    x.e ? `${x.e.id}${x.e.title}${x.e.color}` : '',
    t.prs.length,
    codeSig(t),
    x.kids[0],
    x.kids[1],
    +x.blocked,
    +x.active,
    +x.checked,
    +x.showEpic,
    +x.compact,
    +x.popped,
  ].join('|');
}
/**
 * Things every row depends on (workflow colours and transitions, permissions, the current user).
 */
const pageSig = () =>
  `${JSON.stringify(P().workflow)}|${P().flowMode}|${S.user?.id}|${(S.user?.permissions || []).length}|${S.user?.name}|${releases()
    .map((r: Any) => r.id + r.name + r.status)
    .join()}`;
/** Everything a row shows, worked out from the project (cheap; drawing is what costs). */
function rowData(t: Any, showEpic: boolean, compact: boolean, page: string) {
  const { byId, kids: kidMap } = idx();
  const e = epic(t.epicId);
  const kids: Any[] = isSub(t) ? [] : kidMap.get(t.id) || [];
  const kc: [number, number] = [kids.filter(isDone).length, kids.length];
  const blocked = (t.links || []).some(
    (l: Any) => l.type === 'is blocked by' && byId.get(l.targetId) && !isDone(byId.get(l.targetId)),
  );
  const active = S.drawer?.kind === 'issue' && S.drawer.id === t.id;
  const checked = S.checked.has(t.id);
  const popped = Boolean(S.pop?.ids?.includes(t.id));
  return {
    t,
    e: showEpic ? e : null,
    kc,
    blocked,
    active,
    checked,
    compact,
    page,
    sig: rowSig(t, { e, kids: kc, blocked, active, checked, showEpic, compact, popped }),
  };
}
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
 * or "Saved" doesn't redraw hundreds of rows; when one row changes, only that row redraws
 * (RowView).
 */
const GroupRows = memo(
  function GroupRows({ rows, zoneKey }: { rows: Any[]; zoneKey: string; sig: string }) {
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
const RowView = memo(
  function RowView({
    t,
    e,
    kc,
    blocked,
    active,
    checked,
    compact,
    zoneKey,
  }: {
    t: Any;
    e: Any;
    kc: [number, number];
    blocked: boolean;
    active: boolean;
    checked: boolean;
    compact: boolean;
    zoneKey: string;
    sig: string;
    page: string;
  }) {
    const zone = zoneKey ? JSON.parse(zoneKey) : null;
    const full = !compact;
    const onClick = (ev: React.MouseEvent) => {
      if (full && showChecks() && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        toggleCheck(t.id, !S.checked.has(t.id));
        return;
      }
      if (full && showChecks() && ev.shiftKey) {
        ev.preventDefault();
        window.getSelection()?.removeAllRanges();
        pickRange(t.id);
        emit();
        return;
      }
      openDrawer('issue', t.id);
    };
    return (
      <div
        className={`irow ${active ? 'active' : ''} ${checked ? 'checked' : ''} ${t.flagged ? 'flagged' : ''}`}
        onClick={onClick}
        onContextMenu={full ? (ev) => rowContextMenu(ev, t) : undefined}
        {...(zone && full ? rowDnd(t, zone) : {})}
      >
        {full && showChecks() && (
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
        )}
        <TypeIcon type={t.type} />
        <span className="key">{t.key}</span>
        <span className="sum" title={t.title}>
          {t.title}
        </span>
        <span className="right">
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
          {full && (t.fixVersions || []).length > 0 && (
            <span className="fixv-row">
              {(t.fixVersions || [])
                .map((v: string) => release(v))
                .filter(Boolean)
                .slice(0, 2)
                .map((r: Any) => (
                  <span
                    key={r.id}
                    className={`ver-chip ${r.status === 'released' ? 'rel-done' : ''}`}
                    title={`Fix version ${r.name}`}
                  >
                    {r.name}
                  </span>
                ))}
            </span>
          )}
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
          {e && <ELoz e={e} />}
          {full ? <StatusCell t={t} /> : <StatusLoz s={t.status} />}
          {full ? <AssigneeCell t={t} /> : <Avatar name={t.assignee} />}
          {full && <LayerChip layer={t.layer} short />}
          {full ? (
            <PointsCell t={t} />
          ) : (
            <span className="sp" title="Story points">
              {t.storyPoints ?? '–'}
            </span>
          )}
          {full ? <PriorityCell t={t} /> : <PriorityIcon p={t.priority} />}
          {full && <MoreCell t={t} />}
        </span>
      </div>
    );
  },
  (a, b) => a.sig === b.sig && a.page === b.page && a.zoneKey === b.zoneKey && a.t === b.t,
);
/**
 * Rows drawn per group at first; "Show more" draws the next ones (a backlog of thousands opens at
 * once).
 */
const ROW_CAP = 200;
export function Backlog() {
  useAutoTour('project');
  const groups = backlogGroups();
  const act = activeSprint();
  const toggle = (id: string) => {
    if (S.collapsed.has(id)) S.collapsed.delete(id);
    else S.collapsed.add(id);
    saveUi();
    emit();
  };
  S.rowCap ??= {};
  const capOf = (g: Any) => S.rowCap[g.id] || ROW_CAP;
  const page = pageSig();
  visibleIds = groups.flatMap((g: Any) =>
    S.collapsed.has(g.id) ? [] : g.items.slice(0, capOf(g)).map((t: Any) => t.id),
  );
  return (
    <>
      <Header
        title="Backlog"
        right={
          can('ai.use') &&
          can('issue.create') && (
            <>
              <button
                className="btn ai"
                data-tour="backlog-ai"
                onClick={() => openModal(<FeatureModal />)}
                title="Plan new epics and issues from a description or document"
              >
                <Ico svg={I.plus} />
                Add feature with AI
              </button>
              <button className="btn ai" onClick={() => openModal(<NewWithClaudeModal />)}>
                <Ico svg={I.sparkle} />
                Write issue with AI
              </button>
            </>
          )
        }
      />
      <FilterBar
        group={{
          value: S.groupBy,
          options: [
            ['sprint', 'Sprint'],
            ['epic', 'Epic'],
            ['status', 'Status'],
            ['none', 'None'],
          ],
          onChange: (v) => {
            S.groupBy = v;
            saveUi();
            emit();
          },
        }}
      />
      <BulkBar />
      {groups.length ? (
        groups.map((g: Any) => {
          const closed = S.collapsed.has(g.id);
          const s = g.sprint;
          return (
            <div
              key={g.id}
              className={`section ${g.kind === 'sprint' && !s ? 'backlog-sec' : ''}`}
              data-drop-status={g.kind === 'status' ? g.title : undefined}
              {...zoneDnd({ group: g.id })}
            >
              <div
                className={`sec-h ${closed ? 'closed' : ''}`}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest('button, a, select')) toggle(g.id);
                }}
              >
                <Ico svg={I.chevron} />
                {g.kind === 'status' ? (
                  <StatusLoz s={g.title} />
                ) : g.epic ? (
                  <>
                    <TypeIcon type="Epic" />
                    <Swatch color={g.epic.color} />
                    <b>{g.title}</b>
                  </>
                ) : s ? (
                  <>
                    <b>{s.name}</b>
                    {s.state === 'active' && <span className="loz s-inprogress">Active</span>}
                  </>
                ) : (
                  <b>{g.title}</b>
                )}
                <span className="meta">
                  {s &&
                    (s.startDate ? (
                      `${fmtDate(s.startDate)} – ${fmtDate(s.endDate)} · `
                    ) : can('sprint.manage') ? (
                      <>
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            openModal(<SprintModal s={s} mode="edit" />);
                          }}
                        >
                          Add dates
                        </a>{' '}
                        ·{' '}
                      </>
                    ) : null)}
                  {g.items.length} issue{g.items.length === 1 ? '' : 's'} · {spSum(g.items)} pts
                </span>
                <span className="sec-actions">
                  <Tally items={g.items} />
                  {g.epic && (
                    <button className="btn sm subtle" onClick={() => openDrawer('epic', g.epic.id)}>
                      Details
                    </button>
                  )}
                  {s && g.items.length > 1 && (
                    <button
                      className="btn sm subtle"
                      title="The order to build this sprint’s issues in, with a reason for each"
                      onClick={() => openDevOrder({ sprintId: s.id, title: s.name })}
                    >
                      Development order
                    </button>
                  )}
                  {s && can('sprint.manage') && (
                    <>
                      {s.state === 'active' ? (
                        <button
                          className="btn sm"
                          onClick={() => openModal(<CompleteSprintModal s={s} />)}
                        >
                          Complete sprint
                        </button>
                      ) : (
                        <button
                          className={`btn sm ${act ? '' : 'primary'}`}
                          disabled={Boolean(act)}
                          title={act ? 'Complete the active sprint first' : ''}
                          onClick={() => openModal(<SprintModal s={s} mode="start" />)}
                        >
                          Start sprint
                        </button>
                      )}
                      <button
                        className="icon-btn"
                        title="Edit sprint"
                        aria-label="Edit sprint"
                        onClick={() => openModal(<SprintModal s={s} mode="edit" />)}
                      >
                        <Ico svg={I.pencil} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Delete sprint"
                        aria-label="Delete sprint"
                        onClick={() => deleteSprint(s)}
                      >
                        <Ico svg={I.trash} />
                      </button>
                    </>
                  )}
                  {g.kind === 'sprint' && !s && can('sprint.manage') && (
                    <button className="btn sm" onClick={createSprint}>
                      Create sprint
                    </button>
                  )}
                </span>
              </div>
              {s?.goal && !closed && <div className="sprint-goal">{s.goal}</div>}
              {!closed && (
                <>
                  {g.items.length ? (
                    <div className="rows">
                      {(() => {
                        const rows = g.items
                          .slice(0, capOf(g))
                          .map((t: Any) => rowData(t, g.kind !== 'epic', false, page));
                        return (
                          <GroupRows
                            rows={rows}
                            zoneKey={JSON.stringify({ group: g.id })}
                            sig={`${page}\n${rows.map((r: Any) => r.sig).join('\n')}`}
                          />
                        );
                      })()}
                      {g.items.length > capOf(g) && (
                        <button
                          className="show-more"
                          onClick={() => {
                            S.rowCap[g.id] = capOf(g) + 500;
                            emit();
                          }}
                        >
                          Show {Math.min(500, g.items.length - capOf(g))} more{' '}
                          <span className="muted">· {g.items.length - capOf(g)} not shown</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="drop-hint">
                      {s
                        ? 'Plan this sprint by dragging issues here from the backlog.'
                        : 'No issues. Drag issues here or create one.'}
                    </div>
                  )}
                  {can('issue.create') && <InlineCreate group={g.id} />}
                </>
              )}
            </div>
          );
        })
      ) : filtersActive() ? (
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
        >
          <p>Try a different search, or clear the filters to see every issue.</p>
        </EmptyState>
      ) : (
        <EmptyState
          icon={I.backlog}
          title="Your backlog is empty"
          actions={
            can('issue.create') && (
              <button className="btn primary" onClick={() => openCreateIssue()}>
                <Ico svg={I.plus} />
                Create issue
              </button>
            )
          }
        >
          <p>
            Create issues one by one, or start a project from a requirements document and Claude
            writes them for you.
          </p>
        </EmptyState>
      )}
      {S.groupBy === 'epic' && !filtersActive() && can('epic.manage') && (
        <button className="inline-create" onClick={addEpic}>
          <Ico svg={I.plus} />
          Create epic
        </button>
      )}
    </>
  );
}
