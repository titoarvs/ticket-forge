'use client';
import {
  loadPrefs,
  S,
  api,
  type Any,
  emit,
  loadFlags,
  startSync,
  loadNotifs,
  toast,
  can,
  setMenu,
  setAiRun,
  openModal,
} from '../core';
import { Spinner, TIER_NAME, planPeak, Menu, Ico, I, resetLabel, PlanLimits } from '../ui';
import { loadEngine, AiSettingsModal } from '../actions';

export const EXPORTS: (string[] | null)[] = [
  ['xlsx', 'Excel workbook', '.xlsx'],
  ['docx', 'Word document', '.docx'],
  ['pdf', 'PDF report', '.pdf'],
  ['html', 'HTML report', '.html'],
  null,
  ['csv', 'CSV — issues', '.csv'],
  ['csv-tests', 'CSV — test cases', '.csv'],
  ['csv-jira', 'CSV — Jira import', '.csv'],
  null,
  ['json', 'Project backup', '.json'],
];
/** Loads /api/auth/me once and the server status for signed-in users. */
export async function bootSession() {
  loadPrefs();
  S.bootError = null;
  try {
    S.auth = await api('/api/auth/me');
  } catch (e: Any) {
    S.bootError = e;
    S.ready = true;
    emit();
    return;
  } // server unreachable: show it, don't pretend to be signed out
  S.user = S.auth.user;
  if (S.user) {
    await loadFlags();
    await refreshStatus();
    loadEngine();
    startSync();
    loadNotifs();
  }
  S.ready = true;
  emit();
}
/**
 * Reloads the AI connection status. A failed request never clears a status we already have; when
 * there is none yet, it tries again shortly (3 s, 10 s, 30 s) instead of leaving the pill empty
 * until the next poll.
 */
let statusRetry: Any = null;
export async function refreshStatus(attempt = 0, fresh = false) {
  clearTimeout(statusRetry);
  if (fresh) {
    S.statusBusy = true;
    emit();
  }
  try {
    // fresh: the server checks the Claude sign-in and AI settings again instead of answering from
    // its cache.
    S.status = await api(`/api/status${fresh ? '?fresh=1' : ''}`);
    S.statusError = null;
    S.statusAt = Date.now();
  } catch (e: Any) {
    S.statusError = e?.message || 'Couldn’t check the AI connection';
    if (!S.status && attempt < 3)
      statusRetry = setTimeout(() => refreshStatus(attempt + 1), [3000, 10000, 30000][attempt]);
  } finally {
    S.statusBusy = false;
  }
  emit();
}
/** The AI can't be used right now, or is on a backup because the main one is limited. */
export const aiInactive = (st: Any) => !st || !st.ready || Boolean(st.switched);
function connInfo() {
  const st = S.status;
  if (!st)
    return {
      ok: false,
      label: S.statusError ? 'AI status unavailable' : 'Checking AI…',
      model: '',
      switched: false,
      unknown: true,
    };
  const ok = Boolean(st.ready);
  const label = st.label || 'AI';
  const model = !ok
    ? ''
    : st.mode === 'account' && st.label === 'Claude account' && !st.routingOn
      ? S.settings.model || st.model || ''
      : st.model || '';
  return { ok, label, model, switched: Boolean(st.switched) };
}
/**
 * Local only: switch this computer's AI between your Claude account and GitHub Copilot in one
 * click.
 */
export async function setLocalEngine(k: 'claude' | 'copilot') {
  if (S.status?.localEngine === k || S.localSwitching) return;
  S.localSwitching = k;
  emit();
  try {
    await api('/api/admin/ai', { method: 'PATCH', body: { localEngine: k } });
    // The saved AI settings are current on the server already: no need for the slower full check
    // (?fresh=1).
    await refreshStatus();
    toast(
      k === 'copilot'
        ? 'AI actions now run on GitHub Copilot.'
        : 'AI actions now run on your Claude account.',
      'ok',
      {
        title: 'Local AI switched',
      },
    );
  } catch (e: Any) {
    toast(e?.message || 'Couldn’t switch the local AI', 'err');
  } finally {
    S.localSwitching = null;
    emit();
  }
}
function LocalSwitch({ st }: { st: Any }) {
  const cur = st.localEngine === 'copilot' ? 'copilot' : 'claude';
  const cp = st.copilot || {};
  const acct = st.account || {};
  const opts: ['claude' | 'copilot', string, string, boolean][] = [
    [
      'claude',
      'Claude',
      !acct.signedIn
        ? 'Not signed in'
        : acct.cooldown
          ? `Limited · back ${new Date(acct.cooldown.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
          : 'Claude Code',
      true,
    ],
    [
      'copilot',
      'Copilot',
      !cp.available
        ? 'Not installed'
        : cp.cooldown
          ? 'Limited'
          : st.copilotModel || 'GitHub Copilot',
      Boolean(cp.available),
    ],
  ];
  return (
    <div className="ai-local" onClick={(e) => e.stopPropagation()}>
      <div className="mh">
        Local AI <small className="muted">this computer</small>
      </div>
      <div className="ai-local-seg" role="radiogroup" aria-label="Local AI">
        {opts.map(([k, label, sub, ok]) => (
          <button
            key={k}
            role="radio"
            aria-checked={cur === k}
            className={cur === k ? 'on' : ''}
            disabled={!ok || Boolean(S.localSwitching)}
            title={
              !ok
                ? 'Install the GitHub Copilot CLI first (Administration → AI → Local AI)'
                : `Run AI actions on ${label}`
            }
            onClick={() => setLocalEngine(k)}
          >
            {S.localSwitching === k ? (
              <Spinner />
            ) : (
              <span
                className={`dot ${!ok ? 'bad' : (k === 'claude' ? acct.cooldown || !acct.signedIn : cp.cooldown) ? 'warn' : 'ok'}`}
              />
            )}
            <b>{label}</b>
            <small>{sub}</small>
          </button>
        ))}
      </div>
      <p className="muted small">
        Shortcut: <kbd>⌥⇧A</kbd>. The other one stands in when this one hits its limit
        {cur === 'claude' && !st.copilotBackup ? ' (turn on “Copilot as backup” in Local AI)' : ''}.
      </p>
    </div>
  );
}
/**
 * The AI menu in the top bar: which AI the app is using now (and why, when it's a backup), which AI
 * runs your next AI actions ("Runs on"), a way to check the connection again and the AI settings.
 */
export function AiMenu() {
  const st = S.status;
  const c = connInfo();
  const unknown = 'unknown' in c;
  const cool = st?.account?.cooldown;
  const at = (iso?: string) =>
    iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const why = c.switched
    ? cool
      ? `Claude ${/weekly/.test(cool.reason || '') ? 'weekly limit' : /daily/.test(cool.reason || '') ? 'daily limit' : 'limit'}${cool.until ? ` · back ${at(cool.until)}` : ''}`
      : 'Main AI unavailable'
    : '';
  const tone = unknown ? 'pending' : !c.ok ? 'bad' : c.switched ? 'warn' : 'ok';
  const name = unknown
    ? S.statusError
      ? 'Status unavailable'
      : 'Checking…'
    : !c.ok
      ? 'Not connected'
      : c.label;
  const ch = st?.aiChoices;
  const run = S.aiRun || 'auto';
  const runs: [string, string, string][] = [
    ['auto', 'Auto', st?.routingOn ? 'per task (Model routing)' : st?.model || ''],
    ...Object.keys(TIER_NAME).map((k): [string, string, string] => [
      k,
      TIER_NAME[k],
      ch?.tiers?.[k] || '',
    ]),
    ...(ch?.configs || []).map((x: Any): [string, string, string] => [
      `cfg:${x.id}`,
      x.name,
      x.model || '',
    ]),
  ];
  const runName = runs.find((r) => r[0] === run)?.[1] || 'Auto';
  const open = S.menu === 'ai';
  const peak = can('users.manage') ? planPeak(st?.planUsage) : null;
  return (
    <Menu
      id="ai"
      button={
        <button
          data-tour="ai-pill"
          className={`ai-pill t-${tone} ${open ? 'on' : ''}`}
          onClick={() => setMenu('ai')}
          aria-haspopup="menu"
          aria-expanded={open}
          title={
            c.switched
              ? `Using ${c.label} because your Claude account ${cool?.reason || 'is unavailable'}`
              : `AI: ${name}${c.model ? ` · ${c.model}` : ''} · runs on ${runName}`
          }
        >
          <span className={`dot ${tone}`} />
          <Ico svg={I.sparkle} className="ai-ic" />
          <span className="ai-name">{name}</span>
          {run !== 'auto' && <span className="ai-runtag">{runName}</span>}
          {c.switched && <span className="ai-backup">Backup</span>}
          {peak && peak.pct >= 80 && (
            <span
              className={`ai-backup ${peak.pct >= 95 ? 'over' : ''}`}
              title={`Claude ${peak.name}: ${Math.round(peak.pct)}% used · ${resetLabel(peak.resetsAt)}`}
            >
              {peak.label} {Math.round(peak.pct)}%
            </span>
          )}
          {st?.budget?.near && (
            <span className={`ai-backup ${st.budget.over ? 'over' : ''}`} title="Monthly AI budget">
              {Math.round(st.budget.pct * 100)}%
            </span>
          )}
          <Ico svg={I.chevron} className="ai-chev" />
        </button>
      }
    >
      <div className="ai-menu-h" onClick={(e) => e.stopPropagation()}>
        <span className={`dot ${tone}`} />
        <div>
          <b>{name}</b>
          {c.model && <code className="ai-model">{c.model}</code>}
          {c.switched && (
            <p className="warn-text small">Backup: {why}. It switches back by itself.</p>
          )}
          {!unknown && !c.ok && (
            <p className="muted small">AI actions are off until an AI is connected.</p>
          )}
        </div>
      </div>
      {st?.copilot && can('users.manage') && <LocalSwitch st={st} />}
      {st?.planUsage && can('users.manage') && (
        <div className="ai-plan" onClick={(e) => e.stopPropagation()}>
          <div className="mh">
            Claude plan limits
            {st.account?.subscriptionType ? (
              <small className="muted">
                {' '}
                ·{' '}
                {String(st.account.subscriptionType).replace(/^./, (c: string) => c.toUpperCase())}
              </small>
            ) : null}
          </div>
          <PlanLimits u={st.planUsage} compact />
        </div>
      )}
      {st?.budget?.near && (
        <p
          className={st.budget.over ? 'warn-text small ai-budget' : 'muted small ai-budget'}
          onClick={(e) => e.stopPropagation()}
        >
          AI budget: ${st.budget.spent.toFixed(2)} of ${st.budget.limit} this month (
          {Math.round(st.budget.pct * 100)}%).
          {st.budget.over
            ? st.budget.action === 'pause'
              ? ' AI is paused for everyone but owners.'
              : st.budget.action === 'downgrade'
                ? ' High work now runs on Standard.'
                : ''
            : ''}
        </p>
      )}
      {can('ai.use') && (
        <>
          <hr />
          <div className="mh">
            Runs on <small className="muted">your next AI actions</small>
          </div>
          {runs.map(([k, label, model]) => (
            <button
              key={k}
              role="menuitemradio"
              aria-checked={run === k}
              onClick={() => setAiRun(k)}
            >
              <span className="radio-dot">{run === k && <Ico svg={I.check} />}</span>
              {label}
              {model && <small>{model}</small>}
            </button>
          ))}
        </>
      )}
      <hr />
      <button
        onClick={(e) => {
          e.stopPropagation();
          refreshStatus(0, true);
        }}
        disabled={S.statusBusy}
      >
        <Ico svg={I.refresh} className={S.statusBusy ? 'spin' : ''} />
        Check the connection again
      </button>
      <button onClick={() => openModal(<AiSettingsModal />)}>
        <Ico svg={I.bot} />
        AI connection settings…
      </button>
      {can('users.manage') && (
        <button onClick={() => S.nav('/admin/ai')}>
          <Ico svg={I.settings} />
          Model routing and usage
        </button>
      )}
    </Menu>
  );
}
