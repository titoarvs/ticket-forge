'use client';
import type { Any } from '../core';

export const TYPE_LABEL: Record<string, string> = {
  index: 'Index',
  project: 'Project',
  context: 'App context',
  repo: 'Repository',
  epic: 'Epic',
  issue: 'Issue',
  release: 'Release',
  source: 'Source',
  doc: 'Document',
  decision: 'Decision',
  question: 'Question',
  note: 'Note',
};
export const TYPE_ORDER = [
  'note',
  'epic',
  'issue',
  'decision',
  'question',
  'doc',
  'release',
  'source',
  'project',
  'context',
  'repo',
  'index',
];
export const USER_TYPES = ['note', 'decision', 'question', 'doc'];
export const base = (id: string) => String(id).split('/').pop() || id;
export const lc = (s: string) =>
  String(s || '')
    .trim()
    .toLowerCase();
export type Note = {
  id: string;
  kind: 'auto' | 'user';
  type: string;
  key: string;
  ref: string;
  title: string;
  status: string;
  tags: string[];
  updatedAt: string;
  updatedBy?: string | null;
  out: string[];
  excerpt: string;
};
export type List = {
  rev: number;
  builtAt: string | null;
  notes: Note[];
  sync: Any;
  useInAi: boolean;
  local: boolean;
  can: { write: boolean; export: boolean; settings: boolean };
};
/** Resolves [[targets]] like the server (and Obsidian): path, file name, title, key. */
export function makeResolver(notes: Note[]) {
  const by = new Map<string, string>();
  const put = (k: string, id: string) => {
    const x = lc(k);
    if (x && !by.has(x)) by.set(x, id);
  };
  for (const n of notes) put(n.id, n.id);
  for (const n of notes) put(base(n.id), n.id);
  for (const n of notes) {
    put(n.title, n.id);
    put(n.key, n.id);
  }
  return (t: string) =>
    by.get(lc(t).replace(/\.md$/, '')) || by.get(lc(t).split('/').pop() || '') || null;
}
export const readUrlNote = () => {
  try {
    return new URLSearchParams(window.location.search).get('note') || '';
  } catch {
    return '';
  }
};
export const writeUrlNote = (id: string) => {
  try {
    const u = new URL(window.location.href);
    if (id) u.searchParams.set('note', id);
    else u.searchParams.delete('note');
    window.history.replaceState(window.history.state, '', u.toString());
  } catch {
    /* ignore */
  }
};
