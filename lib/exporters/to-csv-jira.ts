// ---------- helpers ----------
const epicOf = (p, t) => p.epics.find((e) => e.id === t.epicId);
export const ticketsOf = (p, e) => p.tickets.filter((t) => t.epicId === e.id);
const unassigned = (p) => p.tickets.filter((t) => !p.epics.some((e) => e.id === t.epicId));
export function groups(p) {
  const g = p.epics.map((e) => ({ epic: e, tickets: ticketsOf(p, e) }));
  const u = unassigned(p);
  if (u.length) g.push({ epic: { key: '—', title: 'Unassigned', description: '' }, tickets: u });
  return g;
}
export const sprintOf = (p, t) => (p.sprints || []).find((s) => s.id === t.sprintId)?.name || '';
export const keyOf = (p, id) => p.tickets.find((x) => x.id === id)?.key || '';
export const linksText = (p, t) =>
  (t.links || []).map((l) => `${l.type} ${keyOf(p, l.targetId)}`).join('; ');
export const prsText = (t) => (t.prs || []).map((r) => `${r.url} (${r.status})`).join('\n');
export const lastRun = (tc) =>
  tc.lastRun ? `${tc.lastRun.status} ${new Date(tc.lastRun.at).toLocaleString()}` : '';
export const numbered = (list) => list.map((x, i) => `${i + 1}. ${x}`).join('\n');
export const stepsText = (tc) => numbered(tc.steps || []);
export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const slug = (s) =>
  String(s || 'project')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'project';
// ---------- CSV ----------
function csv(rows) {
  const cell = (v) => {
    const s = Array.isArray(v) ? v.join('\n') : String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
export function toCsvTickets(p) {
  const rows = [
    [
      'Epic Key',
      'Epic',
      'Ticket Key',
      'Title',
      'Type',
      'Priority',
      'Story Points',
      'Status',
      'Assignee',
      'Reporter',
      'Sprint',
      'Parent',
      'Labels',
      'User Story',
      'Description',
      'Acceptance Criteria',
      'Dependencies',
      'Linked Issues',
      'Pull Requests',
      'Comments',
      'Test Case Count',
    ],
  ];
  for (const { epic, tickets } of groups(p))
    for (const t of tickets) {
      rows.push([
        epic.key,
        epic.title,
        t.key,
        t.title,
        t.type,
        t.priority,
        t.storyPoints ?? '',
        t.status,
        t.assignee || '',
        t.reporter || '',
        sprintOf(p, t),
        keyOf(p, t.parentId),
        t.labels.join(', '),
        t.userStory,
        t.description,
        numbered(t.acceptanceCriteria),
        t.dependencies.join('; '),
        linksText(p, t),
        prsText(t),
        (t.comments || []).length,
        t.testCases.length,
      ]);
    }
  return csv(rows);
}
export function toCsvTestCases(p) {
  const rows = [
    [
      'Test Case Key',
      'Ticket Key',
      'Ticket',
      'Epic',
      'Title',
      'Type',
      'Priority',
      'Preconditions',
      'Steps',
      'Expected Result',
      'Covers AC',
      'Status',
      'Automated',
      'Last Automated Run',
      'Last Run Error',
    ],
  ];
  for (const t of p.tickets)
    for (const tc of t.testCases) {
      rows.push([
        tc.key,
        t.key,
        t.title,
        epicOf(p, t)?.title || '',
        tc.title,
        tc.type,
        tc.priority,
        tc.preconditions,
        stepsText(tc),
        tc.expected,
        (tc.acRef || []).map((n) => `AC${n}`).join(', '),
        tc.status,
        tc.script ? 'Yes' : 'No',
        lastRun(tc),
        tc.lastRun?.error || '',
      ]);
    }
  return csv(rows);
}
/** Jira Cloud CSV import: epics, issues and sub-tasks linked with Issue Id / Parent. */
export function toCsvJira(p) {
  const rows = [
    [
      'Issue Id',
      'Parent',
      'Issue Type',
      'Summary',
      'Description',
      'Priority',
      'Story Points',
      'Labels',
      'Epic Name',
      'Sprint',
      'Assignee',
      'Status',
      'Start date',
      'Due Date',
    ],
  ];
  const ids: Map<any, any> = new Map();
  let n = 0;
  p.epics.forEach((e) => {
    n += 1;
    ids.set(e.id, String(n));
  });
  p.tickets.forEach((t) => {
    n += 1;
    ids.set(t.id, String(n));
  });
  p.epics.forEach((e) =>
    rows.push([
      ids.get(e.id),
      '',
      'Epic',
      e.title,
      e.description,
      '',
      '',
      '',
      e.title,
      '',
      '',
      '',
      e.startDate || '',
      e.dueDate || '',
    ]),
  );
  for (const t of p.tickets) {
    const desc = [
      t.userStory && `*User story*\n${t.userStory}`,
      t.description && `*Description*\n${t.description}`,
      t.acceptanceCriteria.length &&
        `*Acceptance criteria*\n${t.acceptanceCriteria.map((a) => `# ${a}`).join('\n')}`,
      t.testCases.length &&
        `*Test cases*\n${t.testCases.map((tc) => `* ${tc.key} ${tc.title} — expected: ${tc.expected}`).join('\n')}`,
      (t.prs || []).length &&
        `*Pull requests*\n${t.prs.map((r) => `* ${r.url} (${r.status})`).join('\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const parent = t.parentId ? ids.get(t.parentId) : ids.get(t.epicId);
    const type = t.type === 'Sub-task' ? 'Sub-task' : t.type === 'Spike' ? 'Task' : t.type;
    rows.push([
      ids.get(t.id),
      parent || '',
      type,
      t.title,
      desc,
      t.priority,
      t.storyPoints ?? '',
      t.labels.map((l) => l.replace(/\s+/g, '-')).join(' '),
      '',
      sprintOf(p, t),
      t.assignee || '',
      t.status,
      '',
      '',
    ]);
  }
  return csv(rows);
}
