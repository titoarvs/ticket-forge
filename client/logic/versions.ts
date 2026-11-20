// Issue versions logic: which fields are compared, in what order, and how a value reads as text. No
// UI, no requests.
import { P, fmtField, FIELD_LABEL, type Any } from '../core';

export type Version = {
  number: number;
  at: string;
  author: string;
  status: string;
  restoredFrom: number | null;
  data: Any;
};

/** Fields that are bookkeeping, not content: never shown as a difference. */
const SKIP = new Set(['id', 'updatedAt', 'createdAt', 'descriptionRich', 'comments', 'history']);
/** The order fields are listed in (anything else follows, alphabetically). */
const ORDER = [
  'status',
  'assignee',
  'priority',
  'title',
  'type',
  'reporter',
  'storyPoints',
  'labels',
  'sprintId',
  'epicId',
  'parentId',
  'fixVersions',
  'layer',
  'flagged',
  'description',
  'userStory',
  'acceptanceCriteria',
  'testCases',
  'dependencies',
  'links',
  'prs',
];
const EXTRA_LABEL: Record<string, string> = {
  key: 'Key',
  layer: 'Implementation',
  links: 'Linked issues',
  prs: 'Pull requests',
};
export const labelOf = (k: string) =>
  FIELD_LABEL[k] ||
  EXTRA_LABEL[k] ||
  k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
export const same = (a: Any, b: Any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const fullTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function fieldKeys(...datas: Any[]) {
  const keys = new Set<string>();
  for (const d of datas) for (const k of Object.keys(d || {})) if (!SKIP.has(k)) keys.add(k);
  const known = ORDER.filter((k) => keys.has(k));
  return [...known, ...[...keys].filter((k) => !ORDER.includes(k)).sort()];
}

/** A field's value as readable text. */
export function show(k: string, v: Any): string {
  if (k === 'acceptanceCriteria' || k === 'dependencies')
    return (v || []).length
      ? (v as string[])
          .map((x, i) => (k === 'acceptanceCriteria' ? `AC${i + 1}: ${x}` : x))
          .join('\n')
      : 'None';
  if (k === 'testCases')
    return (v || []).length
      ? (v as Any[])
          .map(
            (tc, i) =>
              `${i + 1}. ${tc.title || 'Untitled test case'}${tc.status ? ` (${tc.status})` : ''}`,
          )
          .join('\n')
      : 'None';
  if (k === 'links')
    return (v || []).length
      ? (v as Any[])
          .map(
            (l) =>
              `${l.type} ${P()?.tickets.find((x: Any) => x.id === l.targetId)?.key || 'a deleted issue'}`,
          )
          .join('\n')
      : 'None';
  if (k === 'prs')
    return (v || []).length ? (v as Any[]).map((r) => r.title || r.url).join('\n') : 'None';
  if (k === 'storyPoints') return v === null || v === undefined || v === '' ? 'None' : String(v);
  if (Array.isArray(v) && !['labels', 'fixVersions'].includes(k))
    return v.length
      ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('\n')
      : 'None';
  if (v && typeof v === 'object' && !Array.isArray(v)) return JSON.stringify(v);
  return fmtField(k, v);
}

/**
 * Whether the issue as it is now has the same fields as a version (then restoring it would change
 * nothing).
 */
export const matchesIssue = (t: Any, v: Version) =>
  fieldKeys(t, v.data).every((k) => same(t[k], v.data[k]));
