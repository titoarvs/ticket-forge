'use client';
// Your avatar → My AI: your own Claude subscription for your own AI requests and code jobs. The
// token is stored encrypted and only you can use it; everyone else sets up their own (or uses the
// team's AI).
import { useEffect, useState } from 'react';
import { api, toast, ago, closeModal, type Any } from './core';
import { Ico, I, Modal, Spinner } from './ui';
import { TF, SF, CB, MenuItem } from './fields';

export function MyAiModal() {
  const [d, setD] = useState<Any>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState<Any>(null);
  const [v, setV] = useState<Any>({
    enabled: true,
    model: 'sonnet',
    teamFallback: true,
    codeJobs: true,
  });
  useEffect(() => {
    api('/api/me/ai')
      .then((r) => {
        setD(r);
        setV({
          enabled: r.enabled,
          model: r.model,
          teamFallback: r.teamFallback,
          codeJobs: r.codeJobs,
        });
      })
      .catch((e) => toast(e.message, 'err'));
  }, []);
  const bad = token.trim() && !/^sk-ant-oat/i.test(token.trim());
  const save = async (clear = false) => {
    setBusy(clear ? 'clear' : 'save');
    try {
      const r = await api('/api/me/ai', {
        method: 'PUT',
        body: clear ? { clear: true } : { token: token.trim() || undefined, ...v },
      });
      setD({ ...d, ...r });
      setToken('');
      toast(clear ? 'Your token is removed' : 'My AI saved');
      if (clear) closeModal();
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const run = async () => {
    setBusy('test');
    setTest(null);
    try {
      setTest(
        await api('/api/me/ai', {
          method: 'POST',
          body: { token: token.trim() || undefined, model: 'haiku' },
        }),
      );
    } catch (e: Any) {
      setTest({ ok: false, error: e.message });
    } finally {
      setBusy('');
    }
  };
  const copy = () => {
    try {
      navigator.clipboard.writeText('claude setup-token');
      toast('Command copied');
    } catch {
      /* clipboard off */
    }
  };
  return (
    <Modal
      title="My AI: your Claude subscription"
      wide
      actions={[
        { label: 'Close' },
        {
          label: busy === 'save' ? 'Saving…' : 'Save',
          kind: 'primary',
          disabled: !!busy || !d || Boolean(bad),
          onClick: () => save(),
        },
      ]}
      left={
        d?.hasToken ? (
          <button className="btn danger-subtle" disabled={!!busy} onClick={() => save(true)}>
            Remove my token
          </button>
        ) : undefined
      }
    >
      {!d ? (
        <p className="muted">
          <Spinner /> Loading…
        </p>
      ) : (
        <>
          <div className={`gha-row ${d.hasToken ? 'ok' : ''}`}>
            <span className="gha-icon">
              <Ico svg={I.user} />
            </span>
            <div className="gha-text">
              {d.hasToken ? (
                <>
                  <b>Your Claude subscription is set up</b>
                  <span className="muted small">
                    Token ends with {d.hint}
                    {d.updatedAt ? ` · saved ${ago(d.updatedAt)}` : ''} ·{' '}
                    {v.enabled ? 'in use for your AI requests' : 'turned off'}
                  </span>
                </>
              ) : (
                <>
                  <b>Not set up</b>
                  <span className="muted small">
                    Your AI requests use the team’s AI (Administration → AI).
                  </span>
                </>
              )}
            </div>
          </div>
          <p className="small" style={{ margin: '12px 0 8px' }}>
            Use <b>your own Claude Pro or Max plan</b> for your AI requests: it’s stored encrypted,
            only you can use it, and nobody else’s requests ever touch it. Each person sets up their
            own here.
          </p>
          <ol className="small ck-steps">
            <li>
              On your computer, in a terminal: <code className="ck-cmd">claude setup-token</code>{' '}
              <button className="btn sm subtle" onClick={copy}>
                Copy
              </button>
            </li>
            <li>Sign in with your Claude account in the browser window it opens.</li>
            <li>
              Paste the token it prints (it starts with <code>sk-ant-oat01-</code>; shown once,
              valid for a year).
            </li>
          </ol>
          <div className="dev-path">
            <TF
              type="password"
              autoComplete="off"
              value={token}
              placeholder={
                d.hasToken
                  ? `Saved, ends with ${d.hint}. Paste a new one to replace it`
                  : 'sk-ant-oat01-…'
              }
              onChange={(e) => {
                setToken(e.target.value);
                setTest(null);
              }}
            />
            <button
              className="btn"
              disabled={!!busy || Boolean(bad) || (!token.trim() && !d.hasToken)}
              onClick={run}
            >
              {busy === 'test' ? (
                <>
                  <Spinner />
                  Testing…
                </>
              ) : (
                'Test'
              )}
            </button>
          </div>
          {bad && (
            <small className="bad-text">
              That isn’t a subscription token (they start with sk-ant-oat01-). API keys don’t go
              here.
            </small>
          )}
          {test &&
            (test.ok ? (
              <div className="ok-banner" style={{ marginTop: 8 }}>
                <Ico svg={I.check} />
                <span>Works: Claude answered in {(test.ms / 1000).toFixed(1)}s.</span>
              </div>
            ) : (
              <div className="warn-banner danger" style={{ marginTop: 8 }}>
                <Ico svg={I.warn} />
                <span>{test.error}</span>
              </div>
            ))}
          {!d.claudeCode && (
            <div className="warn-banner" style={{ marginTop: 10 }}>
              <Ico svg={I.warn} />
              <span>
                {d.serverless
                  ? 'This TicketForge runs on serverless hosting (e.g. Vercel), which can’t run Claude Code, so your subscription is used for your code jobs on GitHub Actions but not for the other AI features here. On a VPS or your computer it’s used for everything.'
                  : 'Claude Code isn’t installed on this server, so only your code jobs on GitHub Actions can use your subscription. Install it here (npm install -g @anthropic-ai/claude-code) to use it for everything.'}
              </span>
            </div>
          )}
          <div className="myai-opts">
            <CB
              label="Use my subscription for my AI requests"
              checked={v.enabled}
              onChange={(e: Any) => setV({ ...v, enabled: e.target.checked })}
            />
            <CB
              label="Use it for my code jobs on GitHub Actions (Write code with AI)"
              checked={v.codeJobs}
              onChange={(e: Any) => setV({ ...v, codeJobs: e.target.checked })}
            />
            <CB
              label="When my subscription isn’t available (usage limit, expired token), use the team’s AI"
              checked={v.teamFallback}
              onChange={(e: Any) => setV({ ...v, teamFallback: e.target.checked })}
            />
            <label className="field" style={{ maxWidth: 260, margin: '6px 0 0' }}>
              <span>Model when nothing else is chosen</span>
              <SF value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })}>
                {['sonnet', 'opus', 'haiku'].map((m) => (
                  <MenuItem key={m} value={m}>
                    {m}
                  </MenuItem>
                ))}
              </SF>
            </label>
          </div>
        </>
      )}
    </Modal>
  );
}
