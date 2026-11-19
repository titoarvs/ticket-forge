'use client';
// What is known about one side's repository: where it is (a folder of yours or the project's, a
// clone, or GitHub), its name, and what this computer can do with it.
import { type Any, S, P } from '../../core';
import { be } from '../FolderPicker';
import { dev } from '../dev';

export type Side = 'frontend' | 'backend';

/**
 * The folder on disk is each person's own (Project settings are shared, the copy on your computer
 * is yours); the project's shared folder only counts when it works here.
 */
function folderOf(side: Side, env: Any, d: Any) {
  const mine = S.auth?.prefs?.local?.[P().id]?.[side];
  const sharedOk = env ? Boolean(env.sharedUsable?.[side]) : true;
  const lpath: string = mine?.path || (sharedOk ? d.localPath : '') || '';
  return { lpath, src: mine?.source || (sharedOk ? d.source : null) };
}

/**
 * On the deployed app a GitHub repository is used through GitHub, even when it was cloned on
 * someone's computer.
 */
const usedThroughGitHub = (d: Any, local: boolean) =>
  d.source?.type === 'github' ||
  (!local && Boolean(d.repo) && (d.provider || 'GitHub') === 'GitHub');

export function repoFacts(side: Side, env: Any) {
  const d = side === 'backend' ? be() : dev();
  const local = env?.local !== false;
  const { lpath, src } = folderOf(side, env, d);
  const isGh = usedThroughGitHub(d, local);
  return {
    d,
    /** Where the project keeps this side's settings. */
    key: side === 'backend' ? 'devBackend' : 'dev',
    local,
    lpath,
    src,
    isClone: src?.type === 'clone',
    isGh,
    has: Boolean(lpath || (isGh && d.repo)),
    name:
      d.repo ||
      String(lpath || '')
        .split('/')
        .pop(),
    /** Whether GitHub can list this person's repositories. */
    canList: Boolean(env?.hasToken || env?.ghSignedIn || env?.envToken),
  };
}
export type RepoFacts = ReturnType<typeof repoFacts>;

/** "owner/name" from a GitHub URL or "owner/name", or ''. */
export const ghName = (u: string) =>
  (u
    .trim()
    .match(/^(?:https?:\/\/github\.com\/|git@github\.com:)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i) ||
    [])[1] || '';

/** The chooser opens on: nothing (a repository is set), a Git URL (backend) or GitHub. */
export function firstMode(side: Side, f: RepoFacts) {
  if (f.lpath || (f.d.source?.type === 'github' && f.d.repo)) return '';
  return side === 'backend' ? 'url' : 'github';
}

/** "Change" opens on where the current repository came from. */
export function changeMode(f: RepoFacts) {
  if (f.isGh) return 'github';
  if (!f.isClone) return 'folder';
  return f.src?.url && /github/i.test(f.src.url) ? 'github' : 'url';
}
