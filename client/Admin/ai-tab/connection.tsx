'use client';
// Connection: which AI this address uses and why, the Claude Code sign-in on this computer, a
// connection test, and the rest of the AI setup at a glance.
import { useState, type ReactNode } from 'react';
import { type Any, toast, ago } from '../../core';
import { I, Spinner, Ico } from '../../ui';
import { getAiSettings, aiAction } from '../../api/admin';
import { applyAi, PLAN, TestResult } from '../ProviderModal';

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <tr>
      <td className="muted" style={{ width: 200 }}>
        {k}
      </td>
      <td>{children}</td>
    </tr>
  );
}

/** A link to another section of the AI page. */
function SecLink({
  to,
  go,
  children,
}: {
  to: string;
  go: (k: string) => void;
  children: ReactNode;
}) {
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}

function whyThisAi(c: Any) {
  if (c.forced) return `Chosen with AI_MODE=${c.mode} on the server.`;
  if (c.mode === 'account')
    return 'You opened TicketForge on this computer (localhost), so it uses your personal Claude account through Claude Code.';
  if (c.serverless)
    return 'This copy runs on serverless hosting, so it uses the AI providers below.';
  return 'TicketForge was opened on a web address (not localhost), so it uses the AI providers below.';
}

function UsesNow({ c }: { c: Any }) {
  const now = c.mode === 'account' && !c.switched ? 'Your Claude account' : c.label;
  return (
    <>
      <span className={`loz ${c.ready ? 't-pass' : 't-fail'}`}>
        {c.ready ? 'Ready' : 'Not set up'}
      </span>{' '}
      <b>{now}</b>
      {c.switched && (
        <span className="loz t-blocked" style={{ marginLeft: 6 }}>
          Switched
        </span>
      )}
      {c.backups > 0 && (
        <span className="muted small">
          {' '}
          · {c.backups} backup{c.backups > 1 ? 's' : ''}
        </span>
      )}
      <div className="muted small">
        {whyThisAi(c)}
        {c.mode === 'account' && c.switched && (
          <>
            {' '}
            Your Claude account {c.account?.cooldown ? 'hit its usage limit' : 'isn’t available'},
            so the providers below stand in.
          </>
        )}
      </div>
    </>
  );
}

const time = (d: string | number) =>
  new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function SignedIn({ c }: { c: Any }) {
  const acct = c.account;
  if (acct.loggedIn === false) return <span className="loz t-fail">Not signed in</span>;
  if (!acct.loggedIn) return <span className="muted">Unknown: update Claude Code to see this</span>;
  return (
    <>
      <b>{acct.email || 'Claude account'}</b>
      {acct.subscriptionType && (
        <span className="label-chip" style={{ marginLeft: 6 }}>
          {PLAN[acct.subscriptionType] || acct.subscriptionType}
        </span>
      )}
      {acct.orgName && <div className="muted small">{acct.orgName}</div>}
      {acct.cooldown && (
        <div className="small" style={{ color: 'var(--warning)' }}>
          Usage limit reached · resets {time(acct.cooldown.until)}
          {c.accountFallback ? '. Using the providers below until then.' : '.'}
        </div>
      )}
    </>
  );
}

/** On this computer: Claude Code's version and path, and who is signed in. */
function ClaudeCodeRows({ c }: { c: Any }) {
  const cli = c.account?.cli;
  return (
    <>
      <Row k="Claude Code">
        {cli?.available ? (
          <>
            {cli.version}
            {cli.outdated && (
              <span className="loz t-blocked" style={{ marginLeft: 6 }}>
                Outdated
              </span>
            )}
            <div className="muted small" style={{ wordBreak: 'break-all' }}>
              {cli.path}
            </div>
          </>
        ) : (
          <span className="loz t-fail">Not installed</span>
        )}
      </Row>
      {cli?.available && (
        <Row k="Signed in">
          <SignedIn c={c} />
        </Row>
      )}
    </>
  );
}

/** How to install Claude Code and sign in, when that isn't done yet. */
function ClaudeSteps({ installed }: { installed: boolean }) {
  return (
    <div className="claude-steps">
      <p style={{ marginBottom: 0 }}>
        {installed ? (
          <>
            Open Terminal on this computer, run <code>claude</code> and sign in with your Claude
            account. Then click <b>Check again</b>.
          </>
        ) : (
          <>
            Install Claude Code on this computer with{' '}
            <code>npm install -g @anthropic-ai/claude-code</code>, run <code>claude</code> and sign
            in with your Claude account. Then click <b>Check again</b>.
          </>
        )}
      </p>
    </div>
  );
}

/** Test connection asks the AI a tiny question; Check again reads the setup afresh. */
function useConnectionCheck() {
  const [test, setTest] = useState<Any>(null);
  const [busy, setBusy] = useState('');
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } finally {
      setBusy('');
    }
  };
  const runTest = () =>
    run('test', async () => {
      setTest(null);
      try {
        setTest(await aiAction({ action: 'test' }));
        applyAi(await getAiSettings());
      } catch (e: Any) {
        setTest({ ok: false, error: e.message });
      }
    });
  const refresh = () =>
    run('refresh', async () => {
      try {
        applyAi(await getAiSettings(true));
        setTest(null);
      } catch (e: Any) {
        toast(e.message, 'err');
      }
    });
  return { test, busy, runTest, refresh };
}

function ConnectionCard({ c }: { c: Any }) {
  const { test, busy, runTest, refresh } = useConnectionCheck();
  const local = c.mode === 'account';
  return (
    <div className="card wide">
      <h3>AI connection</h3>
      <p className="sub">
        TicketForge uses AI to write and improve tickets and test scripts. On your own computer it
        uses your Claude account; anywhere else, the providers below.
      </p>
      <table className="tbl">
        <tbody>
          <Row k="This address uses">
            <UsesNow c={c} />
          </Row>
          {local && <ClaudeCodeRows c={c} />}
          {c.last && (
            <Row k="Last answered by">
              {c.last.label} <span className="muted small">· {ago(c.last.at)}</span>
            </Row>
          )}
        </tbody>
      </table>
      {local && !c.account?.signedIn && (
        <ClaudeSteps installed={Boolean(c.account?.cli?.available)} />
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!!busy || !c.ready} onClick={runTest}>
          {busy === 'test' ? (
            <>
              <Spinner />
              Testing…
            </>
          ) : (
            'Test connection'
          )}
        </button>
        <button className="btn subtle" disabled={!!busy} onClick={refresh}>
          <Ico svg={I.refresh} />
          Check again
        </button>
      </div>
      {test && (
        <div style={{ marginTop: 12 }}>
          <TestResult t={test} />
        </div>
      )}
    </div>
  );
}

function AtAGlance({ c, go }: { c: Any; go: (k: string) => void }) {
  const apis: Any[] = c.apis || [];
  const ready = apis.filter((x) => x.enabled && x.configured).length;
  const localAi = c.localEngine === 'copilot' ? 'GitHub Copilot' : 'Claude Code';
  return (
    <div className="card wide">
      <h3>At a glance</h3>
      <table className="tbl">
        <tbody>
          <Row k="Model routing">
            {c.routingOn ? (
              <>
                On ·{' '}
                <SecLink to="routing" go={go}>
                  {(c.tasks || []).length} tasks across High, Standard and Light
                </SecLink>
              </>
            ) : (
              <>Off · every task uses the main model</>
            )}
          </Row>
          <Row k="AI APIs">
            <SecLink to="providers" go={go}>
              {ready} ready
            </SecLink>
            {apis.some((x) => x.cooldown) && (
              <span className="loz t-blocked" style={{ marginLeft: 6 }}>
                Some limited
              </span>
            )}
          </Row>
          {c.copilot && (
            <Row k="Local AI">
              <SecLink to="local" go={go}>
                {localAi}
                {c.localEngine !== 'copilot' && c.copilotBackup ? ', Copilot as backup' : ''}
              </SecLink>
            </Row>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ConnectionSection({ c, go }: { c: Any; go: (k: string) => void }) {
  return (
    <div className="cards">
      <ConnectionCard c={c} />
      <AtAGlance c={c} go={go} />
    </div>
  );
}
