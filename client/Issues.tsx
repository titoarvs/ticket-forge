'use client';
// Issues: every issue of the project in one flat, sortable table (an issue navigator). Quick views (Open, Assigned to me,
// Bugs, Blocked…), filters, a column chooser and saved views (per browser), inline status and assignee, bulk changes
// and CSV export. Click a row to open the issue.
import { useState } from 'react';
import {
  S,
  P,
  useStore,
  emit,
  can,
  me,
  epic,
  sprint,
  isDone,
  isBlocked,
  isSub,
  statusNames,
  peopleNames,
  TYPES,
  PRIORITIES,
  saveBlob,
  toast,
  ago,
  fmtDate,
  type Any,
} from './core';
import { Ico, I, TypeIcon, PriorityIcon, Avatar, ELoz, StatusLoz, LayerChip, EmptyState, LAYER_LABEL } from './ui';
import { TF, SF, CB, MenuItem, opts } from './fields';
import { openDrawer, openCreateIssue } from './actions';
import { BulkBar, RowStatus, RowAssignee } from './views';

type Col = {
  key: string;
  label: string;
  sort?: (t: Any) => Any;
  cell: (t: Any) => React.ReactNode;
  csv: (t: Any) => string;
  always?: boolean;
  num?: boolean;
};
const PRIO_RANK: Record<string, number> = { Highest: 0, High: 1, Medium: 2, Low: 3 };
const passing = (t: Any) => t.testCases.filter((x: Any) => x.status === 'Pass').length;
const openPrs = (t: Any) => (t.prs || []).filter((r: Any) => ['Open', 'Draft'].includes(r.status)).length;

const COLS: Col[] = [
  { key: 'type', label: 'Type', sort: (t) => t.type, cell: (t) => <TypeIcon type={t.type} />, csv: (t) => t.type },
  {
    key: 'key',
    label: 'Key',
    always: true,
    sort: (t) => [t.key.replace(/\d+$/, ''), Number(t.key.match(/\d+$/)?.[0] || 0)],
    cell: (t) => <span className="key">{t.key}</span>,
    csv: (t) => t.key,
  },
  {
    key: 'title',
    label: 'Summary',
    always: true,
    sort: (t) => t.title.toLowerCase(),
    cell: (t) => (
      <span className="iss-sum" title={t.title}>
        {t.title}
        {isBlocked(t) && (
          <span className="flag" title="Blocked by an open issue">
            <Ico svg={I.flag} />
            Blocked
          </span>
        )}
      </span>
    ),
    csv: (t) => t.title,
  },
  {
    key: 'status',
    label: 'Status',
    sort: (t) => statusNames().indexOf(t.status),
    cell: (t) => (can('issue.edit') ? <RowStatus t={t} /> : <StatusLoz s={t.status} />),
    csv: (t) => t.status,
  },
  {
    key: 'priority',
    label: 'Priority',
    sort: (t) => PRIO_RANK[t.priority] ?? 9,
    cell: (t) => (
      <span className="iss-prio">
        <PriorityIcon p={t.priority} />
        {t.priority}
      </span>
    ),
    csv: (t) => t.priority || '',
  },
  {
    key: 'assignee',
    label: 'Assignee',
    sort: (t) => (t.assignee || '~').toLowerCase(),
    cell: (t) => (
      <span className="iss-who">
        {can('issue.edit') ? <RowAssignee t={t} /> : <Avatar name={t.assignee} />}
        <span>{t.assignee || <span className="muted">Unassigned</span>}</span>
      </span>
    ),
    csv: (t) => t.assignee || '',
  },
  {
    key: 'epic',
    label: 'Epic',
    sort: (t) => epic(t.epicId)?.title || '~',
    cell: (t) => <ELoz e={epic(t.epicId)} />,
    csv: (t) => epic(t.epicId)?.title || '',
  },
  {
    key: 'sprint',
    label: 'Sprint',
    sort: (t) => sprint(t.sprintId)?.name || '~',
    cell: (t) => sprint(t.sprintId)?.name || <span className="muted">Backlog</span>,
    csv: (t) => sprint(t.sprintId)?.name || '',
  },
  {
    key: 'layer',
    label: 'Layer',
    sort: (t) => t.layer || '~',
    cell: (t) => <LayerChip layer={t.layer} short />,
    csv: (t) => LAYER_LABEL[t.layer] || '',
  },
  {
    key: 'points',
    label: 'Points',
    num: true,
    sort: (t) => t.storyPoints ?? -1,
    cell: (t) => <span className="sp">{t.storyPoints ?? '–'}</span>,
    csv: (t) => String(t.storyPoints ?? ''),
  },
  {
    key: 'labels',
    label: 'Labels',
    sort: (t) => (t.labels || []).join(','),
    cell: (t) => (
      <span className="lbls">
        {(t.labels || []).slice(0, 3).map((l: string) => (
          <span key={l} className="label-chip">
            {l}
          </span>
        ))}
      </span>
    ),
    csv: (t) => (t.labels || []).join('; '),
  },
  {
    key: 'tests',
    label: 'Tests',
    num: true,
    sort: (t) => (t.testCases.length ? passing(t) / t.testCases.length : -1),
    cell: (t) =>
      t.testCases.length ? (
        <span className={passing(t) === t.testCases.length ? 'ok-text' : ''}>
          {passing(t)}/{t.testCases.length}
        </span>
      ) : (
        <span className="muted">–</span>
      ),
    csv: (t) => (t.testCases.length ? `${passing(t)}/${t.testCases.length}` : ''),
  },
  {
    key: 'prs',
    label: 'PRs',
    num: true,
    sort: (t) => (t.prs || []).length,
    cell: (t) =>
      (t.prs || []).length ? (
        <span title={`${openPrs(t)} open`}>
          <Ico svg={I.pr} /> {(t.prs || []).length}
        </span>
      ) : (
        <span className="muted">–</span>
      ),
    csv: (t) => String((t.prs || []).length),
  },
  { key: 'reporter', label: 'Reporter', sort: (t) => t.reporter || '', cell: (t) => t.reporter || '', csv: (t) => t.reporter || '' },
  {
    key: 'due',
    label: 'Due',
    sort: (t) => t.dueDate || '9999',
    cell: (t) => (t.dueDate ? fmtDate(t.dueDate) : ''),
    csv: (t) => t.dueDate || '',
  },
  {
    key: 'updated',
    label: 'Updated',
    sort: (t) => t.updatedAt || '',
    cell: (t) => <span className="muted">{ago(t.updatedAt)}</span>,
    csv: (t) => t.updatedAt || '',
  },
  {
    key: 'created',
    label: 'Created',
    sort: (t) => t.createdAt || '',
    cell: (t) => <span className="muted">{fmtDate(t.createdAt)}</span>,
    csv: (t) => t.createdAt || '',
  },
];
const DEFAULT_COLS = ['type', 'key', 'title', 'status', 'priority', 'assignee', 'epic', 'sprint', 'points', 'tests', 'updated'];

/** Built-in quick views. */
const QUICK: { key: string; label: string; test: (t: Any) => boolean }[] = [
  { key: 'all', label: 'All issues', test: () => true },
  { key: 'open', label: 'Open', test: (t) => !isDone(t) },
  { key: 'mine', label: 'Assigned to me', test: (t) => t.assignee === me() && !isDone(t) },
  { key: 'unassigned', label: 'Unassigned', test: (t) => !t.assignee && !isDone(t) },
  { key: 'bugs', label: 'Open bugs', test: (t) => t.type === 'Bug' && !isDone(t) },
  { key: 'blocked', label: 'Blocked', test: (t) => isBlocked(t) },
  { key: 'failing', label: 'Failing tests', test: (t) => t.testCases.some((x: Any) => x.status === 'Fail') },
  { key: 'recent', label: 'Updated this week', test: (t) => Date.now() - new Date(t.updatedAt || 0).getTime() < 7 * 864e5 },
  { key: 'done', label: 'Done', test: (t) => isDone(t) },
];

const EMPTY = {
  quick: 'open',
  q: '',
  type: '',
  status: '',
  priority: '',
  assignee: '',
  epic: '',
  sprint: '',
  layer: '',
  label: '',
  subtasks: false,
};
const read = (k: string, d: Any) => {
  try {
    const v = JSON.parse(localStorage.getItem(k) || 'null');
    return v ?? d;
  } catch {
    return d;
  }
};
const write = (k: string, v: Any) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode */
  }
};

export function Issues() {
  useStore();
  const p = P();
  const store = `tf.issues.${p.id}`;
  const [f, setF] = useState<Any>(() => ({ ...EMPTY, ...read(`${store}.filter`, {}) }));
  const [cols, setCols] = useState<string[]>(() => read('tf.issues.cols', DEFAULT_COLS));
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>(() => read(`${store}.sort`, { key: 'updated', dir: -1 }));
  const [views, setViews] = useState<Any[]>(() => read(`${store}.views`, []));
  const [colsOpen, setColsOpen] = useState(false);
  const set = (patch: Any) =>
    setF((x: Any) => {
      const n = { ...x, ...patch };
      write(`${store}.filter`, n);
      return n;
    });
  const setSortKey = (key: string) =>
    setSort((s) => {
      const n = { key, dir: (s.key === key ? -s.dir : ['updated', 'created', 'points', 'tests', 'prs'].includes(key) ? -1 : 1) as 1 | -1 };
      write(`${store}.sort`, n);
      return n;
    });
  const toggleCol = (k: string) =>
    setCols((c) => {
      const n = c.includes(k) ? c.filter((x) => x !== k) : COLS.map((x) => x.key).filter((x) => x === k || c.includes(x));
      write('tf.issues.cols', n);
      return n;
    });

  const quick = QUICK.find((x) => x.key === f.quick) || QUICK[0];
  const ql = f.q.trim().toLowerCase();
  const labels = [...new Set(p.tickets.flatMap((t: Any) => t.labels || []))].sort() as string[];
  const people = peopleNames();
  const list = p.tickets.filter(
    (t: Any) =>
      (f.subtasks || !isSub(t)) &&
      quick.test(t) &&
      (!ql ||
        t.key.toLowerCase().includes(ql) ||
        t.title.toLowerCase().includes(ql) ||
        String(t.description || '')
          .toLowerCase()
          .includes(ql)) &&
      (!f.type || t.type === f.type) &&
      (!f.status || t.status === f.status) &&
      (!f.priority || t.priority === f.priority) &&
      (!f.assignee || (f.assignee === '__none' ? !t.assignee : t.assignee === f.assignee)) &&
      (!f.epic || (f.epic === '__none' ? !t.epicId : t.epicId === f.epic)) &&
      (!f.sprint || (f.sprint === '__none' ? !t.sprintId : t.sprintId === f.sprint)) &&
      (!f.layer || (f.layer === '__none' ? !t.layer : t.layer === f.layer)) &&
      (!f.label || (t.labels || []).includes(f.label)),
  );
  const sc = COLS.find((c) => c.key === sort.key) || COLS[0];
  const cmp = (a: Any, b: Any): number =>
    Array.isArray(a) ? (a[0] === b[0] ? cmp(a[1], b[1]) : a[0] < b[0] ? -1 : 1) : a === b ? 0 : a < b ? -1 : 1;
  const rows = [...list].sort((a, b) => cmp(sc.sort!(a), sc.sort!(b)) * sort.dir);
  const shown = COLS.filter((c) => c.always || cols.includes(c.key));
  const extra = ['type', 'status', 'priority', 'assignee', 'epic', 'sprint', 'layer', 'label'].filter((k) => f[k]).length + (ql ? 1 : 0);
  const checks = can('issue.edit') || can('issue.delete') || can('sprint.manage') || can('test.run');
  const allChecked = rows.length > 0 && rows.every((t: Any) => S.checked.has(t.id));
  const pts = rows.reduce((n: number, t: Any) => n + (t.storyPoints || 0), 0);

  const exportCsv = () => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const cs = COLS.filter((c) => c.always || cols.includes(c.key));
    const text = [cs.map((c) => c.label).join(','), ...rows.map((t: Any) => cs.map((c) => esc(c.csv(t))).join(','))].join('\n');
    saveBlob(new Blob([`﻿${text}`], { type: 'text/csv' }), `${p.key}-issues.csv`);
    toast(`Exported ${rows.length} issue${rows.length === 1 ? '' : 's'}`);
  };
  const saveView = () => {
    const name = window.prompt('Name this view', quick.label + (extra ? ' (filtered)' : ''));
    if (!name?.trim()) return;
    const n = [...views.filter((v) => v.name !== name.trim()), { name: name.trim(), f, sort, cols }];
    setViews(n);
    write(`${store}.views`, n);
    toast(`Saved the view “${name.trim()}”`);
  };
  const openView = (v: Any) => {
    set({ ...EMPTY, ...v.f });
    setSort(v.sort);
    write(`${store}.sort`, v.sort);
    if (v.cols) {
      setCols(v.cols);
      write('tf.issues.cols', v.cols);
    }
  };
  const dropView = (name: string) => {
    const n = views.filter((v) => v.name !== name);
    setViews(n);
    write(`${store}.views`, n);
  };

  const sel = (k: string, label: string, items: React.ReactNode) => (
    <SF filter value={f[k]} onChange={(e) => set({ [k]: e.target.value })} aria-label={label}>
      <MenuItem value="">{label}</MenuItem>
      {items}
    </SF>
  );

  return (
    <div className="page">
      <div className="page-inner iss-page">
        <div className="page-h">
          <h1>Issues</h1>
          <span className="spacer" />
          <button className="btn" onClick={exportCsv} disabled={!rows.length}>
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
          <aside className="iss-views" aria-label="Views">
            {QUICK.map((v) => (
              <button
                key={v.key}
                type="button"
                className={f.quick === v.key && !extra ? 'on' : f.quick === v.key ? 'on part' : ''}
                onClick={() => set({ ...EMPTY, quick: v.key, subtasks: f.subtasks })}
              >
                <span>{v.label}</span>
                <span className="n">{p.tickets.filter((t: Any) => !isSub(t) && v.test(t)).length}</span>
              </button>
            ))}
            {views.length > 0 && (
              <>
                <div className="iss-views-h">Saved views</div>
                {views.map((v) => (
                  <div key={v.name} className="iss-saved">
                    <button type="button" onClick={() => openView(v)}>
                      {v.name}
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Delete view ${v.name}`}
                      title="Delete view"
                      onClick={() => dropView(v.name)}
                    >
                      <Ico svg={I.close} />
                    </button>
                  </div>
                ))}
              </>
            )}
          </aside>

          <div className="iss-main">
            <div className="iss-filters">
              <TF
                filter
                value={f.q}
                placeholder="Search key, summary, description"
                onChange={(e) => set({ q: e.target.value })}
                aria-label="Search issues"
              />
              {sel('type', 'Type', opts(TYPES))}
              {sel('status', 'Status', opts(statusNames()))}
              {sel('priority', 'Priority', opts(PRIORITIES))}
              {sel('assignee', 'Assignee', [
                <MenuItem key="__none" value="__none">
                  Unassigned
                </MenuItem>,
                ...people.map((n) => (
                  <MenuItem key={n} value={n}>
                    {n}
                  </MenuItem>
                )),
              ])}
              {sel('epic', 'Epic', [
                ...p.epics.map((e: Any) => (
                  <MenuItem key={e.id} value={e.id}>
                    {e.key} {e.title}
                  </MenuItem>
                )),
                <MenuItem key="__none" value="__none">
                  No epic
                </MenuItem>,
              ])}
              {sel('sprint', 'Sprint', [
                ...p.sprints.map((s: Any) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                  </MenuItem>
                )),
                <MenuItem key="__none" value="__none">
                  Backlog
                </MenuItem>,
              ])}
              {sel('layer', 'Layer', [
                ...Object.entries(LAYER_LABEL).map(([k, l]) => (
                  <MenuItem key={k} value={k}>
                    {l}
                  </MenuItem>
                )),
                <MenuItem key="__none" value="__none">
                  Not set
                </MenuItem>,
              ])}
              {labels.length > 0 && sel('label', 'Label', opts(labels))}
              <CB label="Sub-tasks" checked={f.subtasks} onChange={(e: Any) => set({ subtasks: e.target.checked })} />
              {extra > 0 && (
                <button className="btn sm subtle" onClick={() => set({ ...EMPTY, quick: f.quick, subtasks: f.subtasks })}>
                  Clear {extra} filter{extra > 1 ? 's' : ''}
                </button>
              )}
              <span className="spacer" />
              <button className="btn sm subtle" onClick={saveView} title="Save these filters, sort and columns as a view (this browser)">
                <Ico svg={I.plus} />
                Save view
              </button>
              <div className="iss-cols-wrap">
                <button className="btn sm subtle" aria-expanded={colsOpen} onClick={() => setColsOpen(!colsOpen)}>
                  <Ico svg={I.settings} />
                  Columns
                </button>
                {colsOpen && (
                  <div className="iss-cols" role="menu">
                    {COLS.filter((c) => !c.always).map((c) => (
                      <CB key={c.key} label={c.label} checked={cols.includes(c.key)} onChange={() => toggleCol(c.key)} />
                    ))}
                    <button
                      className="link-btn small"
                      onClick={() => {
                        setCols(DEFAULT_COLS);
                        write('tf.issues.cols', DEFAULT_COLS);
                      }}
                    >
                      Reset columns
                    </button>
                  </div>
                )}
              </div>
            </div>

            <BulkBar />
            <div className="iss-sumline muted small">
              {rows.length} issue{rows.length === 1 ? '' : 's'} · {pts} points · {rows.filter(isDone).length} done
              {S.checked.size ? ` · ${S.checked.size} selected` : ''}
            </div>

            {!p.tickets.length ? (
              <EmptyState
                icon={I.backlog}
                title="No issues yet"
                actions={
                  can('issue.create') && (
                    <button className="btn primary" onClick={() => openCreateIssue()}>
                      <Ico svg={I.plus} />
                      Create issue
                    </button>
                  )
                }
              >
                <p>Create issues here or in the Backlog, or start the project from a requirements document.</p>
              </EmptyState>
            ) : !rows.length ? (
              <EmptyState
                compact
                icon={I.search}
                tone="neutral"
                title="No issues match"
                actions={
                  <button className="btn" onClick={() => set({ ...EMPTY, quick: 'all' })}>
                    Show all issues
                  </button>
                }
              >
                <p>Try another view, or clear the filters.</p>
              </EmptyState>
            ) : (
              <div className="iss-scroll">
                <table className="iss-tbl">
                  <thead>
                    <tr>
                      {checks && (
                        <th className="iss-chk">
                          <CB
                            aria-label="Select all shown"
                            checked={allChecked}
                            onChange={() => {
                              rows.forEach((t: Any) => (allChecked ? S.checked.delete(t.id) : S.checked.add(t.id)));
                              emit();
                            }}
                          />
                        </th>
                      )}
                      {shown.map((c) => (
                        <th
                          key={c.key}
                          className={`${c.num ? 'num' : ''} c-${c.key}`}
                          aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                        >
                          <button type="button" onClick={() => setSortKey(c.key)}>
                            {c.label}
                            {sort.key === c.key && <span className="iss-arrow">{sort.dir === 1 ? '▲' : '▼'}</span>}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t: Any) => (
                      <tr
                        key={t.id}
                        className={`${S.drawer?.kind === 'issue' && S.drawer.id === t.id ? 'active' : ''} ${isDone(t) ? 'done' : ''}`}
                        onClick={(e) => {
                          if (!(e.target as HTMLElement).closest('input,button,.MuiInputBase-root,.MuiSelect-select,a'))
                            openDrawer('issue', t.id);
                        }}
                      >
                        {checks && (
                          <td className="iss-chk">
                            <CB
                              aria-label={`Select ${t.key}`}
                              checked={S.checked.has(t.id)}
                              onChange={(e: Any) => {
                                if (e.target.checked) S.checked.add(t.id);
                                else S.checked.delete(t.id);
                                emit();
                              }}
                            />
                          </td>
                        )}
                        {shown.map((c) => (
                          <td key={c.key} className={`${c.num ? 'num' : ''} c-${c.key}`}>
                            {c.cell(t)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
