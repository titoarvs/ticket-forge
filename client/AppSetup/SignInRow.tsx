'use client';
import { useState } from 'react';
import { type Any, P, api, S, emit, toast, startTask, saveNow, readNdjson } from '../core';
import { Spinner } from '../ui';
import { SF, MenuItem, TF } from '../fields';
import { edit } from './AppSetup';
import { ago } from './SourceSection';

/**
 * How a role signs in: login form, single sign-on, or a saved session; plus its authenticator (MFA)
 * secret.
 */
export function SignInRow({
  r,
  i,
  canEdit,
  cred,
}: {
  r: Any;
  i: number;
  canEdit: boolean;
  cred: Any;
}) {
  const p = P();
  const method = r.signIn || 'form';
  const [totp, setTotp] = useState('');
  const [editTotp, setEditTotp] = useState(false);
  const [busy, setBusy] = useState('');
  const put = async (bodyIn: Any, done: string) => {
    try {
      const st = await api(`/api/projects/${p.id}/credentials`, {
        method: 'PUT',
        body: { roleId: r.id, ...bodyIn },
      });
      S.creds = { pid: p.id, roles: st };
      emit();
      toast(done);
      return true;
    } catch (e: Any) {
      toast(e.message, 'err');
      return false;
    }
  };
  const saveTotp = async () => {
    setBusy('totp');
    if (await put({ totp }, `Authenticator secret saved for ${r.name || 'the role'}`)) {
      setTotp('');
      setEditTotp(false);
    }
    setBusy('');
  };
  const captureSession = async () => {
    if (!r.name) {
      toast('Name the role first.', 'err');
      return;
    }
    setBusy('session');
    const ctrl = new AbortController();
    const task = startTask(`Saving a session for ${r.name}`, {
      detail: 'Opening a browser window…',
      kind: 'test',
      cancel: () => ctrl.abort(),
    });
    try {
      await saveNow();
      const res = await api(`/api/projects/${p.id}/credentials/session`, {
        method: 'POST',
        raw: true,
        signal: ctrl.signal,
        body: { roleId: r.id },
      });
      let out: Any = null;
      await readNdjson(res, (ev) => {
        if (ev.type === 'progress') task.update({ detail: ev.message });
        else if (ev.type === 'done') out = ev;
        else if (ev.type === 'error') throw new Error(ev.error);
      });
      if (!out) throw new Error('No session came back.');
      S.creds = { pid: p.id, roles: out.status };
      emit();
      task.finish(`Signed in, landed on ${out.landing}`);
      toast(
        `Tests that sign in as ${r.name} now start signed in${out.expires ? `, until about ${new Date(out.expires).toLocaleDateString()}` : ''}.`,
        'ok',
        { title: 'Session saved' },
      );
    } catch (e: Any) {
      if (e.name === 'AbortError') {
        task.fail('');
        toast('No session was saved.', 'info', { title: 'Stopped' });
      } else task.fail(`Couldn’t save a session for ${r.name}: ${e.message}`);
    } finally {
      setBusy('');
    }
  };
  const expired = cred?.sessionExpires && new Date(cred.sessionExpires).getTime() < Date.now();
  return (
    <div className="signin-row">
      <span className="signin-label">Sign-in</span>
      <SF
        disabled={!canEdit}
        value={method}
        onChange={(e) =>
          edit((x) => {
            x.roles[i] = { ...x.roles[i], signIn: e.target.value };
          })
        }
        sx={{ minWidth: 170 }}
      >
        <MenuItem value="form">Login form</MenuItem>
        <MenuItem value="sso">Single sign-on (SSO)</MenuItem>
        <MenuItem value="session">Saved session</MenuItem>
      </SF>
      {method === 'sso' && (
        <TF
          disabled={!canEdit}
          value={r.ssoButton || ''}
          placeholder="SSO button text, e.g. Sign in with Google (found automatically)"
          sx={{ minWidth: 300 }}
          onChange={(e) =>
            edit((x) => {
              x.roles[i] = { ...x.roles[i], ssoButton: e.target.value };
            }, `rl${r.id}sso`)
          }
        />
      )}
      {method === 'session' && (
        <span className="row" style={{ gap: 6 }}>
          {cred?.hasSession ? (
            <>
              <span className={`loz ${expired ? 't-fail' : 't-pass'}`}>
                {expired ? 'Expired' : 'Saved'}
              </span>
              <span className="muted small">
                {ago(cred.sessionAt)}
                {cred.sessionBy ? ` by ${cred.sessionBy}` : ''}
                {cred.sessionExpires && !expired
                  ? ` · until ${new Date(cred.sessionExpires).toLocaleDateString()}`
                  : ''}
              </span>
            </>
          ) : (
            <span className="loz">None yet</span>
          )}
          {canEdit && (
            <button
              className="btn sm"
              disabled={!!busy}
              onClick={captureSession}
              title="Opens a browser window on this computer. Sign in there any way the app allows; the session is saved for this role."
            >
              {busy === 'session' ? (
                <>
                  <Spinner />
                  Waiting for you to sign in…
                </>
              ) : cred?.hasSession ? (
                'Sign in again'
              ) : (
                'Sign in in a browser'
              )}
            </button>
          )}
          {canEdit && cred?.hasSession && (
            <button
              className="btn sm subtle"
              onClick={() => put({ session: '' }, 'Saved session removed')}
            >
              Forget
            </button>
          )}
        </span>
      )}
      {method !== 'session' && (
        <span className="row" style={{ gap: 6 }}>
          <span className="muted small">MFA</span>
          {cred?.hasTotp && !editTotp ? (
            <>
              <span className="loz t-pass">Authenticator saved</span>
              {canEdit && (
                <>
                  <button className="btn sm subtle" onClick={() => setEditTotp(true)}>
                    Change
                  </button>
                  <button
                    className="btn sm subtle"
                    onClick={() => put({ totp: '' }, 'Authenticator secret removed')}
                  >
                    Clear
                  </button>
                </>
              )}
            </>
          ) : canEdit && (editTotp || !cred?.hasTotp) ? (
            <>
              <TF
                type="password"
                value={totp}
                autoComplete="off"
                placeholder="Authenticator secret or otpauth:// link (optional)"
                sx={{ minWidth: 280 }}
                onChange={(e) => setTotp(e.target.value)}
                onKeyDown={(e: Any) => {
                  if (e.key === 'Enter' && totp) saveTotp();
                }}
              />
              <button className="btn sm" disabled={!totp || !!busy} onClick={saveTotp}>
                {busy === 'totp' ? <Spinner /> : 'Save'}
              </button>
              {editTotp && (
                <button
                  className="btn sm subtle"
                  onClick={() => {
                    setEditTotp(false);
                    setTotp('');
                  }}
                >
                  Cancel
                </button>
              )}
            </>
          ) : (
            <span className="muted small">None</span>
          )}
        </span>
      )}
      <span className="muted small signin-help">
        {method === 'form'
          ? 'Fills the app’s login form, then the authentication code if one is asked for.'
          : method === 'sso'
            ? 'Clicks the SSO button and fills the identity provider’s pages (Microsoft, Google, Okta, Auth0, Keycloak…) with this username and password. If the provider blocks automated browsers, use a saved session.'
            : 'Sign in once by hand in a real browser window (works with Google, passkeys and push approvals). Tests reuse that session until it expires.'}
      </span>
    </div>
  );
}
