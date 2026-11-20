'use client';
// The repository screen's state: the chosen folder (or epic / issue), how the tree is organized
// (remembered on this device), the search, the workflow filter, and the tests that match.
import { useState } from 'react';
import { P, type Any } from '../../core';
import { repo } from '../run-status';
import { wfOf } from '../TestManagement';
import { addFolder } from './folder-ops';

const MODE_KEY = 'tf.repoMode';

function savedMode() {
  try {
    return localStorage.getItem(MODE_KEY) || 'epics';
  } catch {
    return 'epics';
  }
}

function saveMode(m: string) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* private mode */
  }
}

/** The epics of the issues a test covers ('none' for no issue or no epic). */
export function epicsOf(p: Any, t: Any) {
  const epicOf = (id: string) => p.tickets.find((x: Any) => x.id === id)?.epicId || 'none';
  const ids = new Set((t.issueIds || []).map(epicOf));
  if (!ids.size) ids.add('none');
  return ids;
}

function inFolder(p: Any, t: Any, folder: string, mode: string) {
  if (folder === 'all') return true;
  if (mode === 'epics') {
    if (folder.startsWith('epic:')) return epicsOf(p, t).has(folder.slice(5));
    if (folder.startsWith('issue:')) return (t.issueIds || []).includes(folder.slice(6));
    if (folder === 'unlinked') return !(t.issueIds || []).length;
    return true;
  }
  return folder === 'none' ? !t.folderId : t.folderId === folder;
}

/** No filter: everything but deprecated tests; 'all': everything. */
const wfMatches = (t: Any, wf: string) =>
  !wf ? wfOf(t) !== 'Deprecated' : wf === 'all' || wfOf(t) === wf;

const textMatches = (t: Any, q: string) =>
  !q.trim() ||
  `${t.key} ${t.title} ${t.labels?.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase());

export function useRepository() {
  const p = P();
  const r = repo(p);
  const [folder, setFolder] = useState<string>('all');
  const [q, setQ] = useState('');
  const [wf, setWf] = useState('');
  const [newFolder, setNewFolder] = useState<string | null>(null);
  // Epics view (default): the tree follows the backlog — epic → its issues — from the issues each
  // test covers.
  const [mode, setModeState] = useState<string>(savedMode);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const setMode = (m: string) => {
    setModeState(m);
    setFolder('all');
    saveMode(m);
  };
  const list = r.tests.filter(
    (t: Any) => inFolder(p, t, folder, mode) && wfMatches(t, wf) && textMatches(t, q),
  );
  const cur = mode === 'folders' ? r.folders.find((f: Any) => f.id === folder) : null;
  const selIssue = folder.startsWith('issue:')
    ? p.tickets.find((x: Any) => x.id === folder.slice(6))
    : null;
  /** Saves the typed folder name (inside the chosen folder); an empty name just closes the box. */
  const saveNewFolder = () => {
    const name = String(newFolder || '').trim();
    if (name) addFolder(name, folder !== 'all' && folder !== 'none' ? folder : null);
    setNewFolder(null);
  };
  return {
    p,
    r,
    folder,
    setFolder,
    q,
    setQ,
    wf,
    setWf,
    mode,
    setMode,
    open,
    setOpen,
    newFolder,
    setNewFolder,
    saveNewFolder,
    list,
    cur,
    selIssue,
  };
}

export type Repo = ReturnType<typeof useRepository>;
