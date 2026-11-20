'use client';
// The repository chooser's state: which source is being picked, the check of the current folder,
// a clone in progress, and the actions that change the repository.
import { useState, useRef, useEffect } from 'react';
import { type Any, toast } from '../../core';
import { type Side, repoFacts, firstMode } from './repo-facts';
import { saveRepo, inspectFolder, cloneRepo } from './repo-actions';

export function useRepo(side: Side, canEdit: boolean, env: Any) {
  const f = repoFacts(side, env);
  const [mode, setMode] = useState<string>(firstMode(side, f));
  const [status, setStatus] = useState<Any>(null);
  const [busy, setBusy] = useState('');
  const [step, setStep] = useState('');
  const [err, setErr] = useState('');
  // Once the environment is known: on this computer start with a Git URL (it needs no GitHub
  // sign-in) unless GitHub is already usable — until the person picks a source themselves.
  const picked = useRef(false);
  useEffect(() => {
    if (!env || f.has || picked.current || side === 'backend') return;
    setMode(env.local !== false && !f.canList ? 'url' : 'github');
  }, [env]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (rr: Any, source: Any) => saveRepo(side, f.key, canEdit, rr, source);
  /** Checks a folder; quiet: no busy marker and no error line (the status shows it). */
  const inspect = async (path: string, quiet = false) => {
    if (!quiet) setBusy('check');
    try {
      const r = await inspectFolder(path);
      setStatus({ ok: true, ...r });
      return r;
    } catch (e: Any) {
      setStatus({ ok: false, error: e.message });
      if (!quiet) setErr(e.message);
      return null;
    } finally {
      if (!quiet) setBusy('');
    }
  };
  useEffect(() => {
    if (f.lpath && f.local && f.src?.type !== 'github') inspect(f.lpath, true);
  }, [f.lpath, f.local]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseFolder = async (path: string) => {
    setErr('');
    const r = await inspect(path);
    if (!r) return;
    await save(r, { type: 'local' });
    setMode('');
    toast(`Using ${r.repo || r.path}`);
  };
  /** Clones (or updates) a repository and uses it. Returns true when it worked. */
  const clone = async (source: string, branch: string) => {
    setBusy('clone');
    setErr('');
    setStep('Starting…');
    try {
      const got = await cloneRepo(side, source, branch, setStep);
      if (!got) return false;
      await save(got, { type: 'clone', url: source, branch, clonedAt: new Date().toISOString() });
      setStatus({ ok: true, ...got });
      setMode('');
      const updated = f.isClone && f.src?.url === source;
      toast(`${updated ? 'Updated' : 'Cloned'} ${got.repo || 'the repository'}`);
      return true;
    } catch (e: Any) {
      setErr(e.message);
      return false;
    } finally {
      setBusy('');
      setStep('');
    }
  };
  /** Deployed: a GitHub repository is used through GitHub (Actions and the API), with no copy here. */
  const pickRemote = (fullName: string, defaultBranch = '') => {
    save(
      { path: '', repo: fullName, provider: 'GitHub', defaultBranch: defaultBranch || 'main' },
      { type: 'github' },
    );
    setStatus(null);
    setMode('');
    toast(`Using ${fullName} on GitHub`);
  };
  return {
    f,
    side,
    canEdit,
    env,
    mode,
    /** The person picked a source: the environment no longer chooses one for them. */
    pickMode: (m: string) => {
      picked.current = true;
      setMode(m);
      setErr('');
    },
    setMode,
    status,
    busy,
    step,
    err,
    setErr,
    working: busy === 'clone',
    /** On this computer everyone sets up their own copy; shared choices need the settings permission. */
    allowed: canEdit || f.local,
    inspect,
    chooseFolder,
    clone,
    pickRemote,
  };
}
export type Repo = ReturnType<typeof useRepo>;
