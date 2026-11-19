'use client';
import { useState } from 'react';
import { api, P, type Any, readNdjson, toast, ago, saveBlob } from '../core';
import { Spinner, Ico, I, SetCard } from '../ui';
import { TA, TF } from '../fields';
import { Markdown } from '../GuideCard';
import { be, setBe, setDev, myPath } from './FolderPicker';
import { dev } from './dev';

/**
 * Project settings → Code & GitHub → Repository profile: "Learn from repository" runs a read-only
 * agent that writes how this codebase is built (stack, structure, how features are built,
 * conventions, tests, commands). Every code job gets it, so new code follows the repo. It can be
 * edited by hand and learned again after big changes.
 */
export function RepoProfile({ side, ed }: { side: 'frontend' | 'backend'; ed: boolean }) {
  const d = side === 'backend' ? be() : dev();
  const set = side === 'backend' ? setBe : setDev;
  const prof = d.repoProfile;
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [steps, setSteps] = useState(0);
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState('');
  const learn = async () => {
    setBusy(true);
    setStep('Starting Claude Code…');
    setSteps(0);
    try {
      const res = await api(`/api/projects/${P().id}/dev`, {
        method: 'POST',
        raw: true,
        body: { action: 'learn', side },
      });
      let got: Any = null;
      await readNdjson(res, (ev) => {
        if (ev.type === 'step') {
          setStep(ev.text);
          setSteps((n) => n + 1);
        } else if (ev.type === 'profile') got = ev;
        else if (ev.type === 'error') throw new Error(ev.message);
      });
      if (got) {
        set('repoProfile', {
          markdown: got.markdown,
          commit: got.commit,
          learnedAt: got.learnedAt,
        });
        toast(
          `Learned ${side === 'backend' ? 'the backend repository' : 'the repository'}${got.costUsd ? ` ($${got.costUsd.toFixed(2)})` : ''}. Code jobs follow it now.`,
        );
      }
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
      setStep('');
    }
  };
  return (
    <div className="rp">
      <div className="rp-h">
        <b>Repository profile</b>
        <span className="muted small">
          {prof ? (
            <>
              Learned {ago(prof.learnedAt)}
              {prof.commit ? (
                <>
                  {' '}
                  at <code>{prof.commit}</code>
                </>
              ) : null}
              {prof.editedAt ? ' · edited' : ''} · {Math.round(prof.markdown.length / 100) / 10}k
              characters
            </>
          ) : (
            'Not learned yet: agents only see the conventions above.'
          )}
        </span>
        <span className="spacer" />
        {ed && (
          <button
            className="btn sm ai"
            disabled={busy || !myPath(side)}
            onClick={learn}
            title="A read-only Claude Code agent reads the repository and writes how it’s built"
          >
            {busy ? (
              <>
                <Spinner />
                Learning…
              </>
            ) : (
              <>
                <Ico svg={I.sparkle} />
                {prof ? 'Learn again' : 'Learn from repository'}
              </>
            )}
          </button>
        )}
      </div>
      {busy && (
        <div className="rp-step small muted">
          <Spinner /> {step}
          {steps ? ` · ${steps} files and searches` : ''}
        </div>
      )}
      {!busy && (
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          A read-only agent reads the code (never changes it) and writes its stack, structure, how a
          feature is built end to end, conventions, tests and commands. Every code job gets it, so
          new code is built the way this repository already works. Learn again after big changes.
        </p>
      )}
      {prof && !busy && (
        <details className="rp-view" open={edit}>
          <summary className="small">View{ed ? ' or edit' : ''} the profile</summary>
          {edit ? (
            <>
              <TA
                mono
                rows={18}
                value={text}
                spellCheck={false}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button
                  className="btn sm primary"
                  onClick={() => {
                    set('repoProfile', {
                      ...prof,
                      markdown: text.slice(0, 14000),
                      editedAt: new Date().toISOString(),
                    });
                    setEdit(false);
                    toast('Profile saved');
                  }}
                >
                  Save
                </button>
                <button className="btn sm subtle" onClick={() => setEdit(false)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="rp-md small code-md">
                <Markdown text={prof.markdown} />
              </div>
              {ed && (
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <button
                    className="btn sm"
                    onClick={() => {
                      setText(prof.markdown);
                      setEdit(true);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="btn sm subtle"
                    onClick={() =>
                      saveBlob(
                        new Blob([prof.markdown], { type: 'text/markdown' }),
                        `repository-profile-${side}.md`,
                      )
                    }
                  >
                    Download .md
                  </button>
                  <button className="btn sm danger-subtle" onClick={() => set('repoProfile', null)}>
                    Clear profile
                  </button>
                </div>
              )}
            </>
          )}
        </details>
      )}
    </div>
  );
}
/**
 * Project settings → Code & GitHub → CodeRabbit: the CLI's status and an optional Agentic API key.
 */
export function CodeRabbitCard({
  ed,
  env,
  setEnv,
}: {
  ed: boolean;
  env: Any;
  setEnv: (e: Any) => void;
}) {
  const cr = env?.coderabbit;
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState('');
  const recheck = async () => {
    setBusy('check');
    try {
      setEnv(await api(`/api/projects/${P().id}/dev?fresh=1`));
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const save = async (clear = false) => {
    setBusy('key');
    try {
      const r = await api(`/api/projects/${P().id}/dev`, {
        method: 'POST',
        body: clear ? { action: 'clearCoderabbitKey' } : { action: 'saveCoderabbitKey', key },
      });
      setEnv({ ...env, coderabbit: { ...cr, hasKey: r.hasKey } });
      setKey('');
      toast(clear ? 'CodeRabbit key removed' : 'CodeRabbit key saved (encrypted)');
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  return (
    <SetCard
      id="coderabbit"
      title="CodeRabbit"
      desc="An independent AI review of the code the agents write, before you open the pull request. Findings come with a severity and fix instructions: send them to the Build agent, or file them as Bug issues. They are kept on the issue and counted in Reports → Code review findings."
    >
      {!env ? (
        <p className="muted small">Checking…</p>
      ) : cr === null ? (
        <p className="muted small">
          Works when TicketForge runs on your computer (opened at localhost).
        </p>
      ) : (
        <>
          <p
            className="small"
            style={{
              margin: '0 0 8px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span className={`dot ${cr?.installed && (cr.signedIn || cr.hasKey) ? 'ok' : 'bad'}`} />
            {!cr?.installed
              ? 'The CodeRabbit CLI isn’t installed on this computer.'
              : `CodeRabbit CLI ${cr.version} · ${cr.signedIn ? 'signed in' : cr.hasKey ? 'uses the saved API key' : 'not signed in'}`}
            <button className="btn sm subtle" disabled={!!busy} onClick={recheck}>
              {busy === 'check' ? <Spinner /> : <Ico svg={I.refresh} />}Check again
            </button>
          </p>
          {!cr?.installed && (
            <div className="cr-install small">
              <span>Install it in a terminal, then sign in once:</span>
              <code>brew install coderabbit</code>
              <span className="muted">or</span>
              <code>curl -fsSL https://cli.coderabbit.ai/install.sh | sh</code>
              <code>coderabbit auth login</code>
            </div>
          )}
          {cr?.installed && !cr.signedIn && !cr.hasKey && (
            <p className="small muted" style={{ margin: '0 0 8px' }}>
              Run <code>coderabbit auth login</code> in a terminal, or save an Agentic API key
              below.
            </p>
          )}
          {ed && (
            <div className="dev-path">
              <TF
                type="password"
                autoComplete="off"
                value={key}
                placeholder={
                  cr?.hasKey
                    ? 'Replace the saved Agentic API key'
                    : 'Agentic API key (optional), cr-…'
                }
                onChange={(e) => setKey(e.target.value)}
              />
              <button className="btn" disabled={!key.trim() || !!busy} onClick={() => save()}>
                Save key
              </button>
              {cr?.hasKey && (
                <button className="btn subtle" disabled={!!busy} onClick={() => save(true)}>
                  Remove
                </button>
              )}
            </div>
          )}
        </>
      )}
    </SetCard>
  );
}
