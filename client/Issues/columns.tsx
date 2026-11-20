'use client';
import {
  type Any,
  isBlocked,
  statusNames,
  can,
  epic,
  sprint,
  fmtDate,
  ago,
  isDone,
  me,
} from '../core';
import {
  TypeIcon,
  Ico,
  I,
  StatusLoz,
  PriorityIcon,
  Avatar,
  ELoz,
  LayerChip,
  LAYER_LABEL,
} from '../ui';
import { RowStatus, RowAssignee } from '../views';

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
const openPrs = (t: Any) =>
  (t.prs || []).filter((r: Any) => ['Open', 'Draft'].includes(r.status)).length;
export const COLS: Col[] = [
  {
    key: 'type',
    label: 'Type',
    sort: (t) => t.type,
    cell: (t) => <TypeIcon type={t.type} />,
    csv: (t) => t.type,
  },
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
  {
    key: 'reporter',
    label: 'Reporter',
    sort: (t) => t.reporter || '',
    cell: (t) => t.reporter || '',
    csv: (t) => t.reporter || '',
  },
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
export const DEFAULT_COLS = [
  'type',
  'key',
  'title',
  'status',
  'priority',
  'assignee',
  'epic',
  'sprint',
  'points',
  'tests',
  'updated',
];
/** Built-in quick views. */
export const QUICK: { key: string; label: string; test: (t: Any) => boolean }[] = [
  { key: 'all', label: 'All issues', test: () => true },
  { key: 'open', label: 'Open', test: (t) => !isDone(t) },
  { key: 'mine', label: 'Assigned to me', test: (t) => t.assignee === me() && !isDone(t) },
  { key: 'unassigned', label: 'Unassigned', test: (t) => !t.assignee && !isDone(t) },
  { key: 'bugs', label: 'Open bugs', test: (t) => t.type === 'Bug' && !isDone(t) },
  { key: 'blocked', label: 'Blocked', test: (t) => isBlocked(t) },
  {
    key: 'failing',
    label: 'Failing tests',
    test: (t) => t.testCases.some((x: Any) => x.status === 'Fail'),
  },
  {
    key: 'recent',
    label: 'Updated this week',
    test: (t) => Date.now() - new Date(t.updatedAt || 0).getTime() < 7 * 864e5,
  },
  { key: 'done', label: 'Done', test: (t) => isDone(t) },
];
export const EMPTY = {
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
export const read = (k: string, d: Any) => {
  try {
    const v = JSON.parse(localStorage.getItem(k) || 'null');
    return v ?? d;
  } catch {
    return d;
  }
};
export const write = (k: string, v: Any) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode */
  }
};
