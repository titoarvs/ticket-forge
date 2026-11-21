// Ticket ↔ board values. Both sides are compared in the board's terms (option names, iteration
// titles), so several workflow statuses that share one board column (In Progress, In Review → "In
// Progress") don't flip back and forth. A ticket value the board can't show is `undefined` and
// that field is left alone.
import type { Board, Values } from './board';

const norm = (s: any) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const named = <T extends { name: string }>(list: T[] = [], name: any) =>
  list.find((o) => norm(o.name) === norm(name));

const TODO = /todo|backlog|new|open|ready/;
const DONE = /done|closed|complete|shipped|resolved/;
const DOING = /progress|doing|review|test|qa|started/;

/** The board's Status option for a workflow status: same name, else the same kind of column. */
export function statusOption(board: Board, status: string, workflow: any[]) {
  const options = board.fields.status?.options || [];
  if (!options.length) return undefined;
  const same = named(options, status);
  if (same) return same.name;
  const kind = workflow.find((w) => w.name === status)?.category;
  const like = (re: RegExp) => options.find((o) => re.test(norm(o.name)));
  if (kind === 'done') return (like(DONE) || options[options.length - 1]).name;
  if (kind === 'inprogress') return (like(DOING) || options[1] || options[0]).name;
  return (like(TODO) || options[0]).name;
}

/** The workflow status for a Status option: same name, else the first status of that kind. */
export function statusFor(option: string, workflow: any[]) {
  const same = named(workflow, option);
  if (same) return same.name;
  const n = norm(option);
  const first = (kind: string) => workflow.find((w) => w.category === kind)?.name;
  if (DONE.test(n)) return first('done') || workflow[workflow.length - 1]?.name;
  if (DOING.test(n)) return first('inprogress');
  if (TODO.test(n)) return workflow[0]?.name;
  return undefined;
}

const PRIORITY_NAMES: Record<string, string[]> = {
  Highest: ['highest', 'urgent', 'critical', 'blocker', 'p0'],
  High: ['high', 'p1'],
  Medium: ['medium', 'normal', 'p2'],
  Low: ['low', 'lowest', 'minor', 'p3', 'p4'],
};

/** The board's Priority option for a ticket priority (Highest/High/Medium/Low, P0–P3, …). */
export function priorityOption(board: Board, priority: string) {
  const names = PRIORITY_NAMES[priority] || [];
  return board.fields.priority?.options?.find((o) => names.includes(norm(o.name)))?.name;
}

export function priorityFor(option: string) {
  const n = norm(option);
  return Object.keys(PRIORITY_NAMES).find((p) => PRIORITY_NAMES[p].includes(n));
}

/** The ticket's values in the board's terms (undefined: the board can't show it). */
export function ticketValues(board: Board, t: any, workflow: any[], sprints: any[]) {
  const f = board.fields;
  const sprintName = sprints.find((s) => s.id === t.sprintId)?.name;
  const iteration = sprintName ? named(f.sprint?.options, sprintName)?.name : '';
  const v: Partial<Values> = {
    status: f.status ? statusOption(board, t.status, workflow) : undefined,
    priority: f.priority ? priorityOption(board, t.priority) : undefined,
    points: f.points ? (typeof t.storyPoints === 'number' ? t.storyPoints : null) : undefined,
    sprint: f.sprint ? iteration : undefined,
  };
  return v;
}

/**
 * Copies board values onto the ticket `t` (changed in place); a value with no match in Ticket
 * Forge (an unknown option or iteration) is skipped. Returns the fields that really changed.
 */
export function applyValues(
  t: any,
  v: Partial<Values>,
  board: Board,
  workflow: any[],
  sprints: any[],
) {
  const changed: string[] = [];
  const set = (field: string, key: string, value: any) => {
    if ((t[key] ?? null) === value) return;
    t[key] = value;
    changed.push(field);
  };
  if (v.status && statusOption(board, t.status, workflow) !== v.status) {
    const s = statusFor(v.status, workflow);
    if (s) set('status', 'status', s);
  }
  const p = v.priority ? priorityFor(v.priority) : undefined;
  if (p) set('priority', 'priority', p);
  if (v.points !== undefined) set('points', 'storyPoints', v.points);
  if (v.sprint !== undefined) {
    const id = v.sprint ? named(sprints, v.sprint)?.id : null;
    if (id !== undefined) set('sprint', 'sprintId', id);
  }
  return changed;
}
