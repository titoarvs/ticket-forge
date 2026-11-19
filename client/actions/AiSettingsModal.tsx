'use client';
import Link from 'next/link';
import { useState } from 'react';
import {
  mutate,
  can,
  tcKey,
  closeModal,
  toast,
  P,
  ago,
  logEvent,
  useStore,
  S,
  api,
  store,
} from '../core';
import { Modal, Spinner, Ico, I } from '../ui';
import { aiInactive, refreshStatus } from '../AppShell';
import { TA, PeopleF } from '../fields';
import { findTc } from './move-ticket';
import { runTests } from './run-tests';

export function ScriptModal({ tid, tcid }: { tid: string; tcid: string }) {
  const { t, tc } = findTc(tid, tcid);
  const [code, setCode] = useState(tc?.script || '');
  if (!tc) return null;
  const save = () =>
    mutate(() => {
      tc.script = code;
    });
  const editable = can('test.run') || can('issue.edit');
  return (
    <Modal
      title={`${tcKey(t, t.testCases.indexOf(tc))} automation script`}
      wide
      actions={[
        { label: 'Cancel' },
        {
          label: '✨ Rewrite and run',
          kind: 'ai',
          hidden: !can('ai.use') || !can('test.run'),
          onClick: () => {
            closeModal();
            runTests([{ t, tc }], { regenerate: true });
          },
        },
        {
          label: 'Save and run',
          hidden: !can('test.run'),
          onClick: () => {
            save();
            closeModal();
            runTests([{ t, tc }]);
          },
        },
        {
          label: 'Save',
          kind: 'primary',
          hidden: !editable,
          onClick: () => {
            save();
            closeModal();
            toast('Script saved');
          },
        },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Body of <code>{'async ({ page, expect, baseURL }) => { … }'}</code> — runs with Playwright
        against {P().automation.baseUrl || 'your app'}.
      </p>
      <TA
        mono
        spellCheck={false}
        style={{ minHeight: 280 }}
        max={480}
        value={code}
        disabled={!editable}
        onChange={(e) => setCode(e.target.value)}
      />
      {tc.healed?.previous && (
        <div className="heal-note small">
          <b>🩹 Self-healed {ago(tc.healed.at)}</b>: {tc.healed.reason}
          {editable && (
            <button
              className="link-btn small"
              onClick={() => {
                mutate(() => {
                  tc.script = tc.healed.previous;
                  tc.healed = null;
                  logEvent(
                    t,
                    `reverted the self-healed script of ${tcKey(t, t.testCases.indexOf(tc))}`,
                    'Automation',
                  );
                });
                setCode(tc.script);
                toast('Reverted to the script before healing');
              }}
            >
              Revert to the previous script
            </button>
          )}
        </div>
      )}
      {tc.lastRun?.error && (
        <>
          <h5 style={{ margin: '12px 0 4px' }}>Last error</h5>
          <pre className="err-box">{tc.lastRun.error}</pre>
        </>
      )}
    </Modal>
  );
}
// ---------------------------------------------------------------- AI connection
/** Which AI this address uses. On your own computer you can also pick the Claude model. */
export function AiSettingsModal() {
  useStore(); // follow the status while the dialog is open
  const st = S.status || {};
  const [model, setModel] = useState(S.settings.model || '');
  const [busy, setBusy] = useState('');
  const inactive = aiInactive(S.status);
  const refresh = async () => {
    setBusy('refresh');
    await refreshStatus(0, true);
    setBusy('');
    toast(
      aiInactive(S.status)
        ? 'Checked again: the AI is still inactive'
        : 'Checked again: the AI is ready',
    );
  };
  // Administrators: forget the usage-limit pauses and use the main AI again right away.
  const retryMain = async () => {
    setBusy('retry');
    try {
      await api('/api/admin/ai', { method: 'POST', body: { action: 'reset' } });
    } catch (e: any) {
      toast(e.message, 'err');
    }
    await refreshStatus(0, true);
    setBusy('');
  };
  const account = st.mode === 'account';
  const models = [
    'opus',
    'sonnet',
    'haiku',
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
    'claude-fable-5-1',
  ];
  const admin = can('users.manage');
  const goAdmin = (
    <Link href="/admin/ai" onClick={() => closeModal()}>
      Administration → AI
    </Link>
  );
  return (
    <Modal
      title="AI connection"
      actions={
        account
          ? [
              { label: 'Cancel' },
              {
                label: 'Save',
                kind: 'primary',
                onClick: () => {
                  S.settings = { ...S.settings, provider: '', model: model.trim() };
                  store.set('tf.settings', S.settings);
                  closeModal();
                },
              },
            ]
          : [{ label: 'Close' }]
      }
    >
      <div className={`ai-check ${inactive ? 'inactive' : ''}`}>
        <span className="small">
          {!S.status ? (
            'Not checked yet.'
          ) : inactive ? (
            st.ready ? (
              <>
                <b>On a backup:</b> the main AI is limited right now.
              </>
            ) : (
              <>
                <b>The AI is inactive.</b> Fix the cause below, then check again.
              </>
            )
          ) : (
            <>
              <b>Ready.</b>
            </>
          )}
          {S.statusAt ? (
            <span className="muted"> Checked {ago(new Date(S.statusAt).toISOString())}.</span>
          ) : null}
        </span>
        <span className="spacer" />
        {inactive && admin && st.switched && (
          <button
            className="btn sm"
            disabled={!!busy}
            onClick={retryMain}
            title="Clear the usage-limit pause and use the main AI again"
          >
            {busy === 'retry' ? (
              <>
                <Spinner />
                Retrying…
              </>
            ) : (
              'Try the main AI again'
            )}
          </button>
        )}
        <button
          className={`btn sm ${inactive ? 'primary' : ''}`}
          disabled={!!busy || S.statusBusy}
          onClick={refresh}
        >
          {busy === 'refresh' ? (
            <>
              <Spinner />
              Checking…
            </>
          ) : (
            <>
              <Ico svg={I.refresh} />
              Refresh
            </>
          )}
        </button>
      </div>
      <div
        className="row small"
        style={{ flexWrap: 'nowrap', alignItems: 'flex-start', marginBottom: 12 }}
      >
        <span
          className={`dot ${st.ready ? (st.switched ? 'warn' : 'ok') : 'bad'}`}
          style={{ marginTop: 5 }}
        />
        <span>
          {account ? (
            <>
              <b>Your Claude account</b> through Claude Code on this computer
              {st.account?.subscriptionType ? ` (${st.account.subscriptionType})` : ''}.
              {st.account?.cooldown && (
                <>
                  <br />
                  It hit its usage limit (resets{' '}
                  {new Date(st.account.cooldown.until).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                  )
                  {st.switched ? (
                    <>
                      , so TicketForge is using <b>{st.label}</b> until then
                    </>
                  ) : (
                    ''
                  )}
                  .
                </>
              )}
              {!st.ready && (
                <>
                  <br />
                  {st.account?.cli?.available ? (
                    <>
                      Claude Code isn’t signed in: run <code>claude</code> in a terminal and sign
                      in.
                    </>
                  ) : (
                    <>
                      Claude Code isn’t installed: run{' '}
                      <code>npm install -g @anthropic-ai/claude-code</code>, then{' '}
                      <code>claude</code> to sign in.
                    </>
                  )}
                </>
              )}
            </>
          ) : st.ready ? (
            <>
              <b>{st.label}</b>
              {st.model ? (
                <>
                  , model <code>{st.model}</code>
                </>
              ) : (
                ''
              )}
              {st.switched ? ' (a backup: the first provider is limited right now)' : ''}.
              {st.backups > 0 && (
                <>
                  {' '}
                  {st.backups} more provider{st.backups > 1 ? 's' : ''} on standby.
                </>
              )}
            </>
          ) : (
            <>
              <b>No AI API is set up</b> for this address.
              {admin ? <> Set it up in {goAdmin}.</> : ' Ask an administrator to set it up.'}
            </>
          )}
          <br />
          <span className="muted">
            {account
              ? 'Used because you opened TicketForge on this computer (localhost).'
              : 'Used because TicketForge was opened on a web address. On your own computer it uses your Claude account instead.'}
          </span>
        </span>
      </div>
      {account ? (
        st.routingOn ? (
          <p className="small muted" style={{ marginBottom: 0 }}>
            <b>Model routing is on:</b> each kind of work uses the model your administrator set for
            it (for example a lighter model for epics and failure notes)
            {admin ? <>; see {goAdmin} → Model routing</> : ''}.
          </p>
        ) : (
          <>
            <label className="field">
              <span>Claude model — leave blank for the default</span>
              <PeopleF
                avatars={false}
                value={model}
                onChange={setModel}
                options={models}
                placeholder={st.model || 'opus'}
              />
            </label>
            <p className="small muted" style={{ marginBottom: 0 }}>
              Aliases like <code>opus</code> or <code>sonnet</code> use the newest model your Claude
              Code knows (<code>claude update</code> gets the latest).
            </p>
          </>
        )
      ) : (
        <p className="small muted" style={{ marginBottom: 0 }}>
          The provider and model are set with environment variables on the server
          {admin ? <>; see {goAdmin}</> : ''}.
        </p>
      )}
    </Modal>
  );
}
/** Older name, kept for existing imports. */
export const ClaudeSettingsModal = AiSettingsModal;
