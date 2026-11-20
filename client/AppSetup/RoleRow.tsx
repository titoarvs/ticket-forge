'use client';
import { useState } from 'react';
import { type Any, P, api, S, emit, toast, saveNow, openModal, can } from '../core';
import { Confirm, Spinner, Ico, I } from '../ui';
import { TF } from '../fields';
import { credOf, edit } from './AppSetup';
import { SignInRow } from './SignInRow';

export function RoleRow({ r, i, canEdit }: { r: Any; i: number; canEdit: boolean }) {
  const cred = credOf(r.id);
  const [pw, setPw] = useState('');
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<Any>(null);
  const p = P();
  const savePw = async (value: string) => {
    setBusy('pw');
    try {
      const st = await api(`/api/projects/${p.id}/credentials`, {
        method: 'PUT',
        body: { roleId: r.id, password: value },
      });
      S.creds = { pid: p.id, roles: st };
      emit();
      setPw('');
      setChanging(false);
      toast(value ? `Password saved for ${r.name || 'the role'}` : 'Password removed');
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const testLogin = async () => {
    setBusy('test');
    setResult(null);
    try {
      await saveNow(); // the test uses the saved setup
      setResult(
        await api(`/api/projects/${p.id}/login-test`, { method: 'POST', body: { roleId: r.id } }),
      );
    } catch (e: Any) {
      setResult({ ok: false, error: e.message });
    } finally {
      setBusy('');
    }
  };
  const remove = () =>
    openModal(
      <Confirm
        title={`Remove ${r.name || 'this role'}?`}
        label="Remove"
        text="The role and its saved password are removed. Scripts that sign in as this role will fail."
        onYes={async () => {
          edit((x) => {
            x.roles.splice(i, 1);
          });
          if (cred)
            await api(`/api/projects/${p.id}/credentials`, {
              method: 'PUT',
              body: { roleId: r.id, clearAll: true },
            })
              .then((st) => {
                S.creds = { pid: p.id, roles: st };
                emit();
              })
              .catch(() => {});
        }}
      />,
    );
  const editingPw = canEdit && (!cred?.hasPassword || changing);
  const method = r.signIn || 'form';
  const ready =
    method === 'session' ? Boolean(cred?.hasSession) : Boolean(r.username && cred?.hasPassword);
  const notReady =
    method === 'session'
      ? 'Save a session first: Sign in in a browser'
      : 'Add a username and password first';
  return (
    <div className="role-card">
      <div className="role-fields">
        <label className="field">
          <span>Role</span>
          <TF
            disabled={!canEdit}
            value={r.name}
            placeholder="e.g. Admin"
            onChange={(e) =>
              edit((x) => {
                x.roles[i] = { ...x.roles[i], name: e.target.value };
              }, `rl${r.id}n`)
            }
          />
        </label>
        <label className="field">
          <span>What they can do</span>
          <TF
            disabled={!canEdit}
            value={r.description || ''}
            placeholder="e.g. Manages products and refunds"
            onChange={(e) =>
              edit((x) => {
                x.roles[i] = { ...x.roles[i], description: e.target.value };
              }, `rl${r.id}d`)
            }
          />
        </label>
        <label className="field">
          <span>Username</span>
          <TF
            disabled={!canEdit}
            value={r.username || ''}
            placeholder="Email or username"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) =>
              edit((x) => {
                x.roles[i] = { ...x.roles[i], username: e.target.value.trim() };
              }, `rl${r.id}u`)
            }
          />
        </label>
        <div className="field">
          <span>Password</span>
          {method === 'session' ? (
            <span className="muted small">Not needed: uses the saved session</span>
          ) : editingPw ? (
            <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
              <TF
                type="password"
                value={pw}
                placeholder={cred?.hasPassword ? 'New password' : 'Password'}
                autoComplete="new-password"
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e: Any) => {
                  if (e.key === 'Enter' && pw) savePw(pw);
                }}
              />
              <button
                className="btn sm primary"
                disabled={!pw || !!busy}
                onClick={() => savePw(pw)}
              >
                {busy === 'pw' ? <Spinner /> : 'Save'}
              </button>
              {changing && (
                <button
                  className="btn sm subtle"
                  onClick={() => {
                    setChanging(false);
                    setPw('');
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          ) : cred?.hasPassword ? (
            <span className="row" style={{ gap: 6 }}>
              <span className="loz t-pass">Saved</span>
              {canEdit && (
                <>
                  <button className="btn sm subtle" onClick={() => setChanging(true)}>
                    Change
                  </button>
                  <button className="btn sm subtle" disabled={!!busy} onClick={() => savePw('')}>
                    Clear
                  </button>
                </>
              )}
            </span>
          ) : (
            <span className="loz">Not set</span>
          )}
        </div>
        <div className="role-actions">
          {can('test.run') && (
            <button
              className="btn sm subtle"
              disabled={!!busy || !ready}
              title={!ready ? notReady : 'Sign in as this role on the application URL'}
              onClick={testLogin}
            >
              {busy === 'test' ? (
                <>
                  <Spinner />
                  Signing in…
                </>
              ) : (
                'Test login'
              )}
            </button>
          )}
          {canEdit && (
            <button
              className="icon-btn"
              aria-label={`Remove ${r.name || 'role'}`}
              title="Remove"
              onClick={remove}
            >
              <Ico svg={I.trash} />
            </button>
          )}
        </div>
      </div>
      <SignInRow r={r} i={i} canEdit={canEdit} cred={cred} />
      {result && (
        <div className="role-result">
          {result.ok ? (
            <div className="ok-banner">
              <Ico svg={I.check} />
              <span>
                Signed in as <b>{r.name}</b>. Landed on <code>{new URL(result.url).pathname}</code>
                {result.title ? ` (“${result.title}”)` : ''}.
              </span>
              {result.screenshot && (
                <a
                  href={`${result.screenshot}?t=${Date.now()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ marginLeft: 'auto' }}
                >
                  <Ico svg={I.external} /> Screenshot
                </a>
              )}
            </div>
          ) : (
            <div className="warn-banner danger">
              <Ico svg={I.warn} />
              <span>
                {result.error}
                {result.url ? (
                  <>
                    {' '}
                    (on{' '}
                    <code>
                      {(() => {
                        try {
                          return new URL(result.url).pathname;
                        } catch {
                          return result.url;
                        }
                      })()}
                    </code>
                    )
                  </>
                ) : (
                  ''
                )}
                . Check the username and password, or the <b>Login form</b> settings.
              </span>
              {result.screenshot && (
                <a
                  href={`${result.screenshot}?t=${Date.now()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}
                >
                  <Ico svg={I.external} /> Screenshot
                </a>
              )}
            </div>
          )}
          {result.notes?.length > 0 && (
            <ul className="login-notes small">
              {result.notes.map((n: string, i: number) => (
                <li key={i}>
                  <Ico svg={I.warn} />
                  {n}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
