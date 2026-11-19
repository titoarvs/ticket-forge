'use client';
import { useState, useRef, useEffect } from 'react';
import {
  type Any,
  S,
  P,
  api,
  emit,
  mutate,
  toast,
  readNdjson,
  ago,
  openModal,
  runPlace,
} from '../core';
import { Ico, I, Spinner } from '../ui';
import { TF } from '../fields';
import { be, GitHubConnectModal, setDev, FolderPicker } from './FolderPicker';
import { dev } from './dev';
import { SOURCES, DEPLOYED_HINT, RepoPickerModal } from './GitHubAccountCard';

/**
 * The repository of one side (frontend = the project's main repository, or backend): a summary of
 * the one in use (where it is, its branch, its state) and a chooser for a new one from GitHub, a
 * Git URL or a local folder.
 */
export function RepoChooser({
  side,
  ed,
  env,
  setEnv,
}: {
  side: 'frontend' | 'backend';
  ed: boolean;
  env: Any;
  setEnv: (e: Any) => void;
}) {
  const d = side === 'backend' ? be() : dev();
  const key = side === 'backend' ? 'devBackend' : 'dev';
  const local = env?.local !== false;
  // The folder on disk is each person's own (Project settings are shared, the copy on your computer
  // is yours).
  const mineE = S.auth?.prefs?.local?.[P().id]?.[side];
  const sharedOk = env ? Boolean(env.sharedUsable?.[side]) : true;
  const lpath: string = mineE?.path || (sharedOk ? d.localPath : '') || '';
  const src = mineE?.source || (sharedOk ? d.source : null);
  const isClone = src?.type === 'clone';
  const mineOk = local; // on this computer everyone sets up their own copy; the project's shared choices need the settings permission
  // On the deployed app a GitHub repository is used through GitHub, even when it was cloned on
  // someone's computer.
  const isGh =
    d.source?.type === 'github' ||
    (!local && Boolean(d.repo) && (d.provider || 'GitHub') === 'GitHub');
  const has = Boolean(lpath || (isGh && d.repo));
  const [mode, setMode] = useState<string>(
    lpath || (d.source?.type === 'github' && d.repo) ? '' : side === 'backend' ? 'url' : 'github',
  );
  // Once the environment is known: on this computer start with a Git URL (it needs no GitHub
  // sign-in) unless GitHub is already usable.
  const picked = useRef(false);
  useEffect(() => {
    if (!env || has || picked.current || side === 'backend') return;
    setMode(
      env.local !== false && !(env.hasToken || env.ghSignedIn || env.envToken) ? 'url' : 'github',
    );
  }, [env]); // eslint-disable-line react-hooks/exhaustive-deps
  const [status, setStatus] = useState<Any>(null);
  const [busy, setBusy] = useState('');
  const [step, setStep] = useState('');
  const [err, setErr] = useState('');
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [folder, setFolder] = useState(lpath && !isClone ? lpath : '');
  const base = `/api/projects/${P().id}/dev`;
  const canList = Boolean(env?.hasToken || env?.ghSignedIn || env?.envToken);
  // A new repository: the folder is saved as this person's own, and (with the settings permission)
  // the repository's name, provider and base branch become the project's, unless it's the same
  // repository.
  const apply = async (rr: Any, source: Any) => {
    if (rr.path && source?.type !== 'github') {
      const out = await api(base, {
        method: 'POST',
        body: { action: 'setMyLocal', side, path: rr.path, source },
      });
      S.auth.prefs = {
        ...(S.auth.prefs || {}),
        local: { ...(S.auth.prefs?.local || {}), [P().id]: out.local },
      };
      emit();
    }
    if (ed)
      mutate((pp: Any) => {
        const cur = pp[key] || {};
        const same = Boolean(cur.repo && rr.repo && cur.repo === rr.repo);
        pp[key] = {
          ...cur,
          ...(side === 'backend' ? { enabled: true } : {}),
          ...(rr.path && source?.type !== 'github' ? {} : { localPath: '' }),
          repo: rr.repo || (same ? cur.repo : ''),
          provider: rr.provider || '',
          baseBranch: source?.branch || (same && cur.baseBranch) || rr.defaultBranch,
          ...(source?.type === 'github' ? { source } : {}),
        };
      });
  };
  const inspect = async (p: string, quiet = false) => {
    if (!quiet) setBusy('check');
    try {
      const r = await api(base, { method: 'POST', body: { action: 'inspect', localPath: p } });
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
    if (lpath && local && src?.type !== 'github') inspect(lpath, true);
  }, [lpath, local]); // eslint-disable-line react-hooks/exhaustive-deps
  const chooseFolder = async (p: string) => {
    setErr('');
    const r = await inspect(p);
    if (r) {
      await apply(r, { type: 'local' });
      setMode('');
      toast(`Using ${r.repo || r.path}`);
    }
  };
  const clone = async (source: string, br: string) => {
    setBusy('clone');
    setErr('');
    setStep('Starting…');
    try {
      const res = await api(base, {
        method: 'POST',
        raw: true,
        body: { action: 'clone', side, source, branch: br },
      });
      let got: Any = null;
      await readNdjson(res, (ev) => {
        if (ev.type === 'step') setStep(ev.text);
        else if (ev.type === 'repo') got = ev;
        else if (ev.type === 'error') throw new Error(ev.message);
      });
      if (got) {
        await apply(got, {
          type: 'clone',
          url: source,
          branch: br,
          clonedAt: new Date().toISOString(),
        });
        setStatus({ ok: true, ...got });
        setMode('');
        setUrl('');
        toast(
          `${isClone && src?.url === source ? 'Updated' : 'Cloned'} ${got.repo || 'the repository'}`,
        );
      }
    } catch (e: Any) {
      setErr(e.message);
    } finally {
      setBusy('');
      setStep('');
    }
  };
  // Deployed: a GitHub repository is used through GitHub (Actions and the API), with no copy on
  // this server.
  const pickRemote = (fullName: string, defaultBranch = '') => {
    apply(
      { path: '', repo: fullName, provider: 'GitHub', defaultBranch: defaultBranch || 'main' },
      { type: 'github' },
    );
    setStatus(null);
    setMode('');
    setUrl('');
    toast(`Using ${fullName} on GitHub`);
  };
  const ghName = (u: string) =>
    (u
      .trim()
      .match(/^(?:https?:\/\/github\.com\/|git@github\.com:)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i) ||
      [])[1] || '';
  const working = busy === 'clone';
  const name =
    d.repo ||
    String(lpath || '')
      .split('/')
      .pop();
  void has;
  return (
    <div className="rc">
      {has && !mode && (
        <div className="rc-current">
          <div className="rc-top">
            <span className="rc-icon">
              <Ico svg={isClone || isGh ? I.pr : I.folder} />
            </span>
            <div className="rc-name">
              <b>{name}</b>
              <span className="rc-badges">
                <span className="ag-chip tiny">
                  {isGh ? 'On GitHub' : isClone ? 'Cloned by TicketForge' : 'Local folder'}
                </span>
                {d.provider && <span className="ag-chip tiny">{d.provider}</span>}
              </span>
            </div>
            <span className="spacer" />
            {(ed || mineOk) && (
              <>
                {isGh ? null : isClone ? (
                  <button
                    className="btn sm"
                    disabled={!local || !!busy}
                    onClick={() => clone(src.url, src.branch || '')}
                  >
                    {working ? <Spinner /> : <Ico svg={I.refresh} />}Update
                  </button>
                ) : (
                  <button
                    className="btn sm"
                    disabled={!local || !!busy}
                    onClick={() => inspect(lpath)}
                  >
                    {busy === 'check' ? <Spinner /> : null}Check
                  </button>
                )}
                <button
                  className="btn sm subtle"
                  disabled={!!busy}
                  onClick={() => {
                    setErr('');
                    setMode(
                      isGh
                        ? 'github'
                        : isClone
                          ? src?.url && /github/i.test(src.url)
                            ? 'github'
                            : 'url'
                          : 'folder',
                    );
                  }}
                >
                  Change
                </button>
              </>
            )}
          </div>
          <div className="rc-meta small muted">
            {isGh ? (
              <span>
                Used through GitHub: code jobs use your AI provider and GitHub
                {d.baseBranch ? (
                  <>
                    {' '}
                    · base branch <code>{d.baseBranch}</code>
                  </>
                ) : null}
              </span>
            ) : (
              <code title={lpath}>{lpath}</code>
            )}
            {status?.ok && (
              <span>
                default branch <code>{status.defaultBranch}</code> · on{' '}
                <code>{status.currentBranch}</code>
                {status.uncommitted
                  ? ` · ${status.uncommitted} uncommitted change${status.uncommitted === 1 ? '' : 's'} (never touched)`
                  : ''}
              </span>
            )}
            {isClone && src?.clonedAt && <span>updated {ago(src.clonedAt)}</span>}
          </div>
          {status && !status.ok && (
            <div className="warn-banner danger" style={{ marginTop: 8 }}>
              <Ico svg={I.warn} />
              <span>{status.error}</span>
            </div>
          )}
        </div>
      )}
      {(mode || !has) && (
        <div className="rc-pick">
          <div
            className="rc-sources"
            role="radiogroup"
            aria-label="Where the repository comes from"
          >
            {SOURCES.map(([k, l, h]) => (
              <button
                key={k}
                role="radio"
                aria-checked={mode === k}
                className={mode === k ? 'on' : ''}
                disabled={!(ed || mineOk) || (k === 'folder' && !local)}
                onClick={() => {
                  picked.current = true;
                  setMode(k);
                  setErr('');
                }}
              >
                <Ico svg={k === 'folder' ? I.folder : I.pr} />
                <b>{l}</b>
                <span className="muted small">{local ? h : DEPLOYED_HINT[k]}</span>
              </button>
            ))}
          </div>
          {mode === 'github' && (
            <div className="rc-form">
              {canList ? (
                <>
                  <p className="small muted" style={{ margin: 0 }}>
                    Personal and organisation repositories your GitHub sign-in can see.
                  </p>
                  <button
                    className="btn primary"
                    disabled={!(ed || mineOk) || working}
                    onClick={() =>
                      openModal(
                        <RepoPickerModal
                          onPick={(r) =>
                            local && runPlace() !== 'github'
                              ? clone(r.cloneUrl, '')
                              : pickRemote(r.fullName, r.defaultBranch)
                          }
                        />,
                      )
                    }
                  >
                    <Ico svg={I.search} />
                    Choose a repository
                  </button>
                </>
              ) : (
                <>
                  <p className="small muted" style={{ margin: 0 }}>
                    {local
                      ? 'Listing your repositories needs a GitHub sign-in (optional on this computer). Or use a Git URL: it is cloned with your own git sign-in, no token needed.'
                      : 'Connect GitHub first (GitHub account, above), or use a GitHub URL.'}
                  </p>
                  <button
                    className={local ? 'btn' : 'btn primary'}
                    disabled={!ed}
                    onClick={() =>
                      openModal(
                        <GitHubConnectModal
                          env={env}
                          onDone={(a) => {
                            setDev('githubAccount', {
                              ...a,
                              connectedAt: new Date().toISOString(),
                            });
                            setEnv({ ...env, hasToken: true });
                          }}
                        />,
                      )
                    }
                  >
                    <Ico svg={I.pr} />
                    {local ? 'Connect GitHub (optional)' : 'Connect GitHub'}
                  </button>
                </>
              )}
            </div>
          )}
          {mode === 'url' && (
            <div className="rc-form dev-path">
              <label className="field" style={{ flex: 2, margin: 0 }}>
                <span>Repository URL</span>
                <TF
                  disabled={!(ed || mineOk) || working}
                  value={url}
                  spellCheck={false}
                  placeholder="https://github.com/owner/repo, git@gitlab.com:group/repo.git or owner/repo"
                  onChange={(e) => setUrl(e.target.value)}
                />
              </label>
              <label className="field" style={{ flex: 1, margin: 0 }}>
                <span>Branch (optional)</span>
                <TF
                  disabled={!(ed || mineOk) || working}
                  value={branch}
                  spellCheck={false}
                  placeholder="default branch"
                  onChange={(e) => setBranch(e.target.value)}
                />
              </label>
              <button
                className="btn primary"
                disabled={!(ed || mineOk) || working || !url.trim()}
                onClick={() => {
                  if (local) clone(url.trim(), branch.trim());
                  else if (ghName(url)) pickRemote(ghName(url), branch.trim());
                  else
                    setErr(
                      'From the deployed TicketForge, use a GitHub repository (owner/name or its GitHub URL).',
                    );
                }}
              >
                {local ? 'Clone' : 'Use'}
              </button>
            </div>
          )}
          {mode === 'folder' && (
            <div className="rc-form dev-path">
              <label className="field" style={{ flex: 1, margin: 0 }}>
                <span>Folder</span>
                <TF
                  disabled={!(ed || mineOk)}
                  value={folder}
                  spellCheck={false}
                  placeholder="/Users/you/code/my-app"
                  onChange={(e) => setFolder(e.target.value)}
                />
              </label>
              <button
                className="btn"
                disabled={!(ed || mineOk) || !local}
                onClick={() =>
                  openModal(
                    <FolderPicker
                      start={folder || lpath || ''}
                      onPick={(p) => {
                        setFolder(p);
                        chooseFolder(p);
                      }}
                    />,
                  )
                }
              >
                <Ico svg={I.folder} />
                Browse…
              </button>
              <button
                className="btn primary"
                disabled={!(ed || mineOk) || !local || !folder.trim() || !!busy}
                onClick={() => chooseFolder(folder.trim())}
              >
                {busy === 'check' ? (
                  <>
                    <Spinner />
                    Checking…
                  </>
                ) : (
                  'Use this folder'
                )}
              </button>
            </div>
          )}
          {!local && env?.saasBlocksLocal && (
            <div className="warn-banner" style={{ marginTop: 8 }}>
              <Ico svg={I.warn} />
              <span>
                You opened TicketForge on this computer, but it is running in hosted mode (
                <code>TICKETFORGE_MODE=saas</code> in <code>.env</code>), which keeps this
                computer’s folders off. To use a folder here, add{' '}
                <code>TICKETFORGE_ALLOW_LOCAL=1</code> to <code>.env</code> (or remove{' '}
                <code>TICKETFORGE_MODE=saas</code>) and restart TicketForge.
              </span>
            </div>
          )}
          {!local && (
            <p className="small muted" style={{ margin: '8px 0 0' }}>
              Deployed: your GitHub repositories and GitHub URLs are used through GitHub (no copy
              here); folders on a computer work when TicketForge runs on that computer.
            </p>
          )}
          {has && mode && (
            <button
              className="btn sm subtle"
              style={{ marginTop: 8 }}
              disabled={working}
              onClick={() => {
                setMode('');
                setErr('');
              }}
            >
              Keep {name}
            </button>
          )}
        </div>
      )}
      {working && (
        <div className="rp-step small muted">
          <Spinner /> {step}
        </div>
      )}
      {err && (
        <div className="warn-banner danger" style={{ marginTop: 8 }}>
          <Ico svg={I.warn} />
          <span>{err}</span>
        </div>
      )}
    </div>
  );
}
