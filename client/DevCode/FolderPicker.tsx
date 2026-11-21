'use client';
import { useState, useEffect, useRef } from 'react';
import { P, type Any, mutate, S, api, closeModal, toast, can } from '../core';
import { Modal, Spinner, Ico, I } from '../ui';
import { TF } from '../fields';
import { dev } from './dev';

export const be = () => P().devBackend || {};
export const setBe = (k: string, v: Any) =>
  mutate(
    (pp) => {
      pp.devBackend = { ...(pp.devBackend || {}), [k]: v };
    },
    { tag: `devBackend.${k}` },
  );
/** The project has a separate backend repository set up. */
/**
 * This person's own folder for a repository (set up on their computer), else the project's shared
 * one.
 */
export const myPath = (side: 'frontend' | 'backend'): string =>
  S.auth?.prefs?.local?.[P().id]?.[side]?.path ||
  (side === 'backend' ? be().localPath : dev().localPath) ||
  '';
export const hasBackend = () => Boolean(be().enabled && myPath('backend'));
export const setDev = (k: string, v: Any) =>
  mutate(
    (pp) => {
      pp.dev = { ...(pp.dev || {}), [k]: v };
    },
    { tag: `dev.${k}` },
  );
/**
 * Pick a folder on this computer: click through folders (git repositories are marked), then choose
 * one.
 */
export function FolderPicker({
  start,
  onPick,
  title = 'Choose the repository folder',
  hint,
}: {
  start: string;
  onPick: (path: string) => void;
  title?: string;
  hint?: string;
}) {
  const [at, setAt] = useState<Any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (path: string) => {
    setBusy(true);
    setErr('');
    try {
      setAt(
        await api(`/api/projects/${P().id}/dev`, {
          method: 'POST',
          body: { action: 'browse', path },
        }),
      );
    } catch (e: Any) {
      setErr(e.message);
      if (!at)
        setAt(
          await api(`/api/projects/${P().id}/dev`, {
            method: 'POST',
            body: { action: 'browse', path: '' },
          }).catch(() => null),
        );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    go(start);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const crumbs = at
    ? at.path
        .split('/')
        .filter(Boolean)
        .map((part: string, i: number, all: string[]) => ({
          name: part,
          path: `/${all.slice(0, i + 1).join('/')}`,
        }))
    : [];
  return (
    <Modal
      title={title}
      wide
      actions={[
        { label: 'Cancel' },
        {
          label: at?.git && !hint ? 'Use this repository' : 'Use this folder',
          kind: 'primary',
          disabled: !at,
          onClick: () => {
            closeModal();
            onPick(at.path);
          },
        },
      ]}
    >
      {at && (
        <>
          <div className="fp-places">
            {at.places.map((p: Any) => (
              <button
                key={p.path}
                className={`btn sm ${at.path === p.path ? 'primary' : 'subtle'}`}
                onClick={() => go(p.path)}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="fp-crumbs">
            {crumbs.map((c: Any, i: number) => (
              <span key={c.path}>
                {i > 0 && <span className="muted">/</span>}
                <button className="link-btn" onClick={() => go(c.path)}>
                  {c.name}
                </button>
              </span>
            ))}
            {at.git && <span className="label-chip fp-git">git repository</span>}
            {busy && <Spinner />}
          </div>
          {err && (
            <div className="warn-banner danger" style={{ margin: '0 0 8px' }}>
              <Ico svg={I.warn} />
              <span>{err}</span>
            </div>
          )}
          <div className="fp-list">
            {at.parent && (
              <button className="fp-item" onClick={() => go(at.parent)}>
                <Ico svg={I.up} />
                <span>..</span>
              </button>
            )}
            {at.entries.map((e: Any) => (
              <button key={e.path} className="fp-item" onClick={() => go(e.path)} title={e.path}>
                <Ico svg={I.folder} />
                <span className="fp-name">{e.name}</span>
                {e.git && <span className="label-chip fp-git">git</span>}
              </button>
            ))}
            {!at.entries.length && (
              <p className="muted small" style={{ padding: 10, margin: 0 }}>
                No folders in here.
              </p>
            )}
          </div>
          <p className="muted small" style={{ margin: '8px 0 0' }}>
            {hint || (
              <>
                Open the folder of the project’s clone (marked <b>git</b>), then choose it.
              </>
            )}{' '}
            Only folder names are shown; files are never read here.
          </p>
        </>
      )}
      {!at && (
        <div className="muted">
          <Spinner /> Loading…
        </div>
      )}
    </Modal>
  );
}
/**
 * Connect GitHub: device sign-in (a code you approve on github.com). Admins can set the OAuth App
 * client ID here.
 */
export function GitHubConnectModal({
  env,
  onDone,
  route = 'dev',
}: {
  env: Any;
  onDone: (account: Any) => void;
  /** The API route under /api/projects/:id that handles ghClientId, ghConnectStart and ghConnectPoll. */
  route?: string;
}) {
  const [configured, setConfigured] = useState(Boolean(env?.githubConnect?.configured));
  const [clientId, setClientId] = useState('');
  const [flow, setFlow] = useState<Any>(null);
  const [state, setState] = useState('');
  const [err, setErr] = useState('');
  const stop = useRef(false);
  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );
  const base = `/api/projects/${P().id}/${route}`;
  const start = async () => {
    setErr('');
    setState('starting');
    try {
      const f = await api(base, { method: 'POST', body: { action: 'ghConnectStart' } });
      setFlow(f);
      setState('waiting');
      let wait = f.interval;
      while (!stop.current) {
        await new Promise((r) => setTimeout(r, wait * 1000));
        if (stop.current) return;
        const r = await api(base, { method: 'POST', body: { action: 'ghConnectPoll', id: f.id } });
        if (r.state === 'slow_down') {
          wait = r.interval || wait + 5;
          continue;
        }
        if (r.state === 'pending') continue;
        if (r.state === 'done') {
          onDone(r.account);
          closeModal();
          toast(`Connected as @${r.account.login}`, 'ok', { title: 'GitHub connected' });
          return;
        }
        setState('');
        setFlow(null);
        setErr(
          r.state === 'denied'
            ? 'The sign-in was cancelled on GitHub.'
            : 'The code expired. Start again.',
        );
        return;
      }
    } catch (e: Any) {
      setState('');
      setErr(e.message);
    }
  };
  const saveId = async () => {
    setErr('');
    try {
      const r = await api(base, { method: 'POST', body: { action: 'ghClientId', clientId } });
      setConfigured(r.configured);
      if (r.configured) start();
    } catch (e: Any) {
      setErr(e.message);
    }
  };
  const copy = () => {
    try {
      navigator.clipboard.writeText(flow.userCode);
      toast('Code copied');
    } catch {
      /* clipboard off */
    }
  };
  return (
    <Modal title="Connect GitHub" actions={[{ label: state === 'waiting' ? 'Cancel' : 'Close' }]}>
      {!configured ? (
        <>
          <p className="small" style={{ marginTop: 0 }}>
            Connecting a GitHub account uses a <b>GitHub OAuth App</b> that belongs to your
            organisation (one per TicketForge, made once by an administrator):
          </p>
          <ol className="small gc-steps">
            <li>
              On GitHub:{' '}
              <a
                href="https://github.com/settings/applications/new"
                target="_blank"
                rel="noopener noreferrer"
              >
                Settings → Developer settings → OAuth Apps → New OAuth App
              </a>
              . Any name; homepage and callback URL can be this TicketForge’s address.
            </li>
            <li>
              In the new app, tick <b>Enable Device Flow</b> and save.
            </li>
            <li>
              Copy its <b>Client ID</b> (not a secret) here.
            </li>
          </ol>
          {can('users.manage') ? (
            <div className="dev-path">
              <TF
                value={clientId}
                spellCheck={false}
                placeholder="Ov23li… or Iv1.…"
                onChange={(e) => setClientId(e.target.value)}
              />
              <button className="btn primary" disabled={!clientId.trim()} onClick={saveId}>
                Save and connect
              </button>
            </div>
          ) : (
            <p className="muted small">
              Ask an administrator to do this (or set <code>TICKETFORGE_GITHUB_CLIENT_ID</code> on
              the server).
            </p>
          )}
          <p className="muted small">
            Other ways that work now: sign in with <code>gh auth login</code> on this computer, or
            save a personal access token under GitHub access.
          </p>
        </>
      ) : !flow ? (
        <>
          <p className="small" style={{ marginTop: 0 }}>
            Sign in with your GitHub account to pick any of your repositories (personal and
            organisations), clone them, and open pull requests. TicketForge asks for{' '}
            <code>repo</code>, <code>read:org</code> and <code>workflow</code> access; the token is
            stored encrypted for this project and you can disconnect at any time.
          </p>
          <button className="btn primary" disabled={state === 'starting'} onClick={start}>
            {state === 'starting' ? (
              <>
                <Spinner />
                Starting…
              </>
            ) : (
              <>
                <Ico svg={I.pr} />
                Sign in with GitHub
              </>
            )}
          </button>
        </>
      ) : (
        <div className="gc-code">
          <p className="small" style={{ margin: 0 }}>
            1. Copy this code
          </p>
          <button className="gc-user-code" onClick={copy} title="Copy">
            {flow.userCode}
          </button>
          <p className="small" style={{ margin: 0 }}>
            2. Open GitHub, paste it and approve TicketForge
          </p>
          <a
            className="btn primary"
            href={flow.verificationUri}
            target="_blank"
            rel="noopener noreferrer"
            onClick={copy}
          >
            <Ico svg={I.external} />
            Open {flow.verificationUri.replace(/^https?:\/\//, '')}
          </a>
          <p className="muted small" style={{ margin: 0 }}>
            <Spinner /> Waiting for you to approve on GitHub…
          </p>
        </div>
      )}
      {err && (
        <div className="warn-banner danger" style={{ marginTop: 10 }}>
          <Ico svg={I.warn} />
          <span>{err}</span>
        </div>
      )}
    </Modal>
  );
}
