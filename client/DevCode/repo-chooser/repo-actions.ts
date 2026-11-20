'use client';
// Saving a chosen repository, checking a folder, and cloning one (with its progress).
import { type Any, S, P, api, emit, mutate, readNdjson } from '../../core';
import type { Side } from './repo-facts';

export const devApi = () => `/api/projects/${P().id}/dev`;

/** Saves the folder as this person's own (each person's copy is theirs). */
async function saveMyFolder(side: Side, path: string, source: Any) {
  const out = await api(devApi(), {
    method: 'POST',
    body: { action: 'setMyLocal', side, path, source },
  });
  S.auth.prefs = {
    ...(S.auth.prefs || {}),
    local: { ...(S.auth.prefs?.local || {}), [P().id]: out.local },
  };
  emit();
}

/**
 * A new repository: the folder is saved as this person's own, and (with the settings permission)
 * the repository's name, provider and base branch become the project's, unless it's the same one.
 */
export async function saveRepo(side: Side, key: string, canEdit: boolean, rr: Any, source: Any) {
  const onDisk = Boolean(rr.path) && source?.type !== 'github';
  if (onDisk) await saveMyFolder(side, rr.path, source);
  if (!canEdit) return;
  mutate((pp: Any) => {
    const cur = pp[key] || {};
    const same = Boolean(cur.repo && rr.repo && cur.repo === rr.repo);
    pp[key] = {
      ...cur,
      ...(side === 'backend' ? { enabled: true } : {}),
      ...(onDisk ? {} : { localPath: '' }),
      repo: rr.repo || (same ? cur.repo : ''),
      provider: rr.provider || '',
      baseBranch: source?.branch || (same && cur.baseBranch) || rr.defaultBranch,
      ...(source?.type === 'github' ? { source } : {}),
    };
  });
}

/** Reads a folder's repository: its name, provider, branches and uncommitted changes. */
export const inspectFolder = (path: string) =>
  api(devApi(), { method: 'POST', body: { action: 'inspect', localPath: path } });

/** Clones a repository (or updates the clone), reporting each step; returns what was cloned. */
export async function cloneRepo(
  side: Side,
  source: string,
  branch: string,
  onStep: (text: string) => void,
) {
  const res = await api(devApi(), {
    method: 'POST',
    raw: true,
    body: { action: 'clone', side, source, branch },
  });
  let got: Any = null;
  await readNdjson(res, (ev) => {
    if (ev.type === 'step') onStep(ev.text);
    else if (ev.type === 'repo') got = ev;
    else if (ev.type === 'error') throw new Error(ev.message);
  });
  return got;
}
