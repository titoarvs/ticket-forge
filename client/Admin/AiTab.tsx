'use client';
import { useState } from 'react';
import { type Any, toast, openModal, ago } from '../core';
import { useSection, ErrorState, I, SectionNav, Confirm, PlanLimits, Spinner, Ico } from '../ui';
import { getAiSettings, aiAction, removeAiEntry } from '../api/admin';
import { RoutingSection } from '../AiRouting';
import { ConfigsSection } from '../AiConfigs';
import { AiFlow } from '../AiFlow';
import { DecisionsSection } from '../Jev';
import { SF, MenuItem } from '../fields';
import { A } from './UsersTab';
import { applyAi, ProviderModal, envExample, PLAN, TestResult } from './ProviderModal';
import { LocalAiCard } from './LocalAiCard';
import { ProvidersCard } from './ProvidersCard';

export function AiTab() {
  const c = A.ai;
  const [test, setTest] = useState<Any>(null);
  const [busy, setBusy] = useState('');
  const [showEnv, setShowEnv] = useState(false);
  const [envProv, setEnvProv] = useState('openai');
  const [sec, setSec] = useSection(
    'tf.adminAiSec',
    [
      'flow',
      'connection',
      'routing',
      'models',
      'usage',
      'savings',
      'configs',
      'providers',
      'local',
    ],
    'flow',
  );
  const refresh = async () => {
    setBusy('refresh');
    try {
      applyAi(await getAiSettings(true));
      setTest(null);
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  if (!c) {
    return (
      <div className="card">
        <ErrorState
          compact
          title="Couldn’t check the AI connection"
          onRetry={async () => applyAi(await getAiSettings(true))}
        >
          <p>The server didn’t report how TicketForge connects to AI.</p>
        </ErrorState>
      </div>
    );
  }
  const row = (k: string, v: React.ReactNode) => (
    <tr>
      <td className="muted" style={{ width: 200 }}>
        {k}
      </td>
      <td>{v}</td>
    </tr>
  );
  const acct = c.account;
  const runTest = async () => {
    setBusy('test');
    setTest(null);
    try {
      setTest(await aiAction({ action: 'test' }));
      applyAi(await getAiSettings());
    } catch (e: Any) {
      setTest({ ok: false, error: e.message });
    } finally {
      setBusy('');
    }
  };
  const why = c.forced
    ? `Chosen with AI_MODE=${c.mode} on the server.`
    : c.mode === 'account'
      ? 'You opened TicketForge on this computer (localhost), so it uses your personal Claude account through Claude Code.'
      : c.serverless
        ? 'This copy runs on serverless hosting, so it uses the AI providers below.'
        : 'TicketForge was opened on a web address (not localhost), so it uses the AI providers below.';
  const now = c.mode === 'account' && !c.switched ? 'Your Claude account' : c.label;
  const items = [
    { key: 'flow', label: 'AI flow', hint: 'Connect providers like nodes', icon: I.grid },
    { key: 'connection', label: 'Connection', hint: 'Status, sign-in and test', icon: I.sparkle },
    {
      key: 'routing',
      label: 'Model routing',
      hint: 'Presets and the tier for each task',
      icon: I.chart,
      badge: c.routingOn ? null : <span className="loz">Off</span>,
    },
    {
      key: 'models',
      label: 'Models per tier',
      hint: 'High, Standard and Light on each AI',
      icon: I.bot,
    },
    {
      key: 'usage',
      label: 'Usage & suggestions',
      hint: 'Calls, tokens, cost and how to use less',
      icon: I.history,
    },
    {
      key: 'savings',
      label: 'Savings & limits',
      hint: 'Reused answers, budget and prices',
      icon: I.check,
      badge: c.budget?.over ? (
        <span className="loz t-fail">Budget</span>
      ) : c.budget?.near ? (
        <span className="loz t-blocked">{Math.round(c.budget.pct * 100)}%</span>
      ) : null,
    },
    {
      key: 'configs',
      label: 'Configurations',
      hint: 'Named AI setups for AI buttons',
      icon: I.settings,
      badge: (c.settings?.configs || []).length ? (
        <span className="count">{c.settings.configs.length}</span>
      ) : null,
    },
    {
      key: 'providers',
      label: 'Providers',
      hint: 'AI APIs, in priority order',
      icon: I.grid,
      badge: (c.apis || []).some((x: Any) => x.cooldown) ? (
        <span className="loz t-blocked">Limited</span>
      ) : null,
    },
    {
      key: 'decisions',
      label: 'Decisions',
      hint: 'Fast choices with Jev (optional)',
      icon: I.flag,
    },
    ...(c.copilot
      ? [{ key: 'local', label: 'Local AI', hint: 'Claude Code or GitHub Copilot', icon: I.user }]
      : []),
  ];
  return (
    <div className="sec-layout">
      <SectionNav label="AI settings" items={items} value={sec} onChange={setSec} />
      <div className="sec-body">
        {sec === 'flow' && (
          <AiFlow
            c={c}
            actions={{
              onSaved: applyAi,
              add: () => openModal(<ProviderModal c={c} />),
              edit: (x: Any) => openModal(<ProviderModal c={c} entry={x} />),
              remove: (x: Any) =>
                openModal(
                  <Confirm
                    title={`Remove ${x.label}?`}
                    label="Remove"
                    text={
                      <>
                        {x.label}
                        {x.model ? ` (${x.model})` : ''} and its saved API key are deleted.
                      </>
                    }
                    onYes={async () => {
                      try {
                        applyAi(await removeAiEntry(x.entryId));
                        toast(`${x.label} removed`);
                      } catch (e: Any) {
                        toast(e.message, 'err');
                      }
                    }}
                  />,
                ),
              goto: setSec,
            }}
          />
        )}
        {['routing', 'models', 'usage', 'savings'].includes(sec) && (
          <RoutingSection
            key={`${sec}${JSON.stringify(c.settings?.routing)}`}
            c={c}
            onSaved={applyAi}
            part={sec as 'routing' | 'models' | 'usage' | 'savings'}
            go={setSec}
          />
        )}
        {sec === 'local' && c.copilot && (
          <div className="cards">
            <LocalAiCard c={c} />
            {c.account?.signedIn && (
              <div className="card wide">
                <h3>Claude plan limits</h3>
                <p className="sub">
                  Your Claude{' '}
                  {c.account?.subscriptionType
                    ? `${String(c.account.subscriptionType).replace(/^./, (x: string) => x.toUpperCase())} `
                    : ''}
                  plan’s usage, read from Anthropic with your Claude Code sign-in on this computer
                  (the same numbers as Claude’s own usage page). The AI pill warns at 80%.
                  {c.localEngine !== 'copilot' && c.copilot.available
                    ? ' Near the weekly limit? Switch to Copilot with ⌥⇧A.'
                    : ''}
                </p>
                {c.planUsage ? (
                  <PlanLimits u={c.planUsage} />
                ) : (
                  <p className="muted small">
                    Not available: sign in to Claude Code with a Pro or Max plan to see these.
                  </p>
                )}
                {c.planUsage?.checkedAt && (
                  <p className="muted small" style={{ marginBottom: 0 }}>
                    Checked{' '}
                    {new Date(c.planUsage.checkedAt).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}{' '}
                    · updates every minute.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        {sec === 'decisions' && <DecisionsSection />}
        {sec === 'configs' && <ConfigsSection c={c} onSaved={applyAi} />}
        {sec === 'providers' && (
          <div className="cards">
            <ProvidersCard c={c} />
            <div className="card wide">
              <p className="muted small" style={{ margin: 0 }}>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setShowEnv(!showEnv);
                  }}
                >
                  {showEnv ? 'Hide' : 'Prefer environment variables?'}
                </a>
                {showEnv && (
                  <>
                    {' '}
                    A provider set with environment variables (on Vercel:{' '}
                    <b>Settings → Environment Variables</b>, then redeploy) is used after the ones
                    above.
                  </>
                )}
              </p>
              {showEnv && (
                <>
                  <label className="field" style={{ maxWidth: 280, marginTop: 12 }}>
                    <span>Provider</span>
                    <SF value={envProv} onChange={(e) => setEnvProv(e.target.value)}>
                      {c.providers.map((x: Any) => (
                        <MenuItem key={x.id} value={x.id}>
                          {x.label}
                        </MenuItem>
                      ))}
                    </SF>
                  </label>
                  <pre className="code">{envExample(c, envProv)}</pre>
                </>
              )}
            </div>
          </div>
        )}
        {sec === 'connection' && (
          <div className="cards">
            <div className="card wide">
              <h3>AI connection</h3>
              <p className="sub">
                TicketForge uses AI to write and improve tickets and test scripts. On your own
                computer it uses your Claude account; anywhere else, the providers below.
              </p>
              <table className="tbl">
                <tbody>
                  {row(
                    'This address uses',
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
                        {why}
                        {c.mode === 'account' && c.switched && (
                          <>
                            {' '}
                            Your Claude account{' '}
                            {acct?.cooldown ? 'hit its usage limit' : 'isn’t available'}, so the
                            providers below stand in.
                          </>
                        )}
                      </div>
                    </>,
                  )}
                  {c.mode === 'account' && (
                    <>
                      {row(
                        'Claude Code',
                        acct?.cli?.available ? (
                          <>
                            {acct.cli.version}
                            {acct.cli.outdated && (
                              <span className="loz t-blocked" style={{ marginLeft: 6 }}>
                                Outdated
                              </span>
                            )}
                            <div className="muted small" style={{ wordBreak: 'break-all' }}>
                              {acct.cli.path}
                            </div>
                          </>
                        ) : (
                          <span className="loz t-fail">Not installed</span>
                        ),
                      )}
                      {acct?.cli?.available &&
                        row(
                          'Signed in',
                          acct.loggedIn ? (
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
                                  Usage limit reached · resets{' '}
                                  {new Date(acct.cooldown.until).toLocaleTimeString([], {
                                    hour: 'numeric',
                                    minute: '2-digit',
                                  })}
                                  {c.accountFallback
                                    ? '. Using the providers below until then.'
                                    : '.'}
                                </div>
                              )}
                            </>
                          ) : acct.loggedIn === false ? (
                            <span className="loz t-fail">Not signed in</span>
                          ) : (
                            <span className="muted">Unknown: update Claude Code to see this</span>
                          ),
                        )}
                    </>
                  )}
                  {c.last &&
                    row(
                      'Last answered by',
                      <>
                        {c.last.label} <span className="muted small">· {ago(c.last.at)}</span>
                      </>,
                    )}
                </tbody>
              </table>

              {c.mode === 'account' && !acct?.signedIn && (
                <div className="claude-steps">
                  <p style={{ marginBottom: 0 }}>
                    {acct?.cli?.available ? (
                      <>
                        Open Terminal on this computer, run <code>claude</code> and sign in with
                        your Claude account. Then click <b>Check again</b>.
                      </>
                    ) : (
                      <>
                        Install Claude Code on this computer with{' '}
                        <code>npm install -g @anthropic-ai/claude-code</code>, run{' '}
                        <code>claude</code> and sign in with your Claude account. Then click{' '}
                        <b>Check again</b>.
                      </>
                    )}
                  </p>
                </div>
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
            <div className="card wide">
              <h3>At a glance</h3>
              <table className="tbl">
                <tbody>
                  {row(
                    'Model routing',
                    c.routingOn ? (
                      <>
                        On ·{' '}
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setSec('routing');
                          }}
                        >
                          {(c.tasks || []).length} tasks across High, Standard and Light
                        </a>
                      </>
                    ) : (
                      <>Off · every task uses the main model</>
                    ),
                  )}
                  {row(
                    'AI APIs',
                    <>
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setSec('providers');
                        }}
                      >
                        {(c.apis || []).filter((x: Any) => x.enabled && x.configured).length} ready
                      </a>
                      {(c.apis || []).some((x: Any) => x.cooldown) && (
                        <span className="loz t-blocked" style={{ marginLeft: 6 }}>
                          Some limited
                        </span>
                      )}
                    </>,
                  )}
                  {c.copilot &&
                    row(
                      'Local AI',
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setSec('local');
                        }}
                      >
                        {c.localEngine === 'copilot' ? 'GitHub Copilot' : 'Claude Code'}
                        {c.localEngine !== 'copilot' && c.copilotBackup
                          ? ', Copilot as backup'
                          : ''}
                      </a>,
                    )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
