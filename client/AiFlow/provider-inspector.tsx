'use client';
// The details panel of an AI: how it is set up, its status, a connection test and the model it
// uses for each tier.
import type { Any } from '../core';
import { Ico, I, Spinner } from '../ui';
import type { FNode } from './model';
import { TIER } from './model';
import { nodeState, aiName } from './graph';
import type { Flow } from './flow';
import { TierModelField, ModelSaveBar } from './model-fields';

function keyText(f: Flow, x: Any) {
  const hint = f.c.settings?.providers?.find((y: Any) => y.id === x.entryId)?.keyHint;
  if (hint) return `ends with ${hint}`;
  return x.keySet ? 'saved' : 'none';
}

function SetupTable({ f, x }: { f: Flow; x: Any }) {
  return (
    <table className="fi-kv">
      <tbody>
        <tr>
          <td>Model</td>
          <td>{x.model || 'Provider’s default'}</td>
        </tr>
        {x.kind === 'openai' && x.baseUrl && (
          <tr>
            <td>Endpoint</td>
            <td>{x.baseUrl}</td>
          </tr>
        )}
        <tr>
          <td>Set up</td>
          <td>{x.source === 'panel' ? 'In this panel' : 'With environment variables'}</td>
        </tr>
        <tr>
          <td>Key</td>
          <td>{keyText(f, x)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** The latest connection test, once it has finished. */
function TestBanner({ test }: { test: Any }) {
  if (!test || test.running) return null;
  if (test.ok)
    return (
      <div className="ok-banner">
        <Ico svg={I.check} />
        <span>Connected. The AI replied in {(test.ms / 1000).toFixed(1)} s.</span>
      </div>
    );
  return (
    <div className="warn-banner danger">
      <Ico svg={I.warn} />
      <span>{test.error}</span>
    </div>
  );
}

function ProviderButtons({ f, n }: { f: Flow; n: FNode }) {
  const x = n.data;
  const { busy, tests, testNode } = f.providers;
  const fromPanel = n.kind !== 'local' && x.source === 'panel';
  return (
    <div className="row" style={{ gap: 8, margin: '10px 0' }}>
      <button type="button" className="btn sm" disabled={!!busy} onClick={() => testNode(n.id)}>
        {tests[n.id]?.running ? (
          <>
            <Spinner />
            Testing
          </>
        ) : (
          'Test connection'
        )}
      </button>
      {fromPanel && (
        <button type="button" className="btn sm subtle" onClick={() => f.actions.edit(x)}>
          Edit
        </button>
      )}
      {fromPanel && (
        <button type="button" className="btn sm subtle" onClick={() => f.actions.remove(x)}>
          Remove
        </button>
      )}
    </div>
  );
}

export function ProviderInspector({ f, n }: { f: Flow; n: FNode }) {
  const x = n.data;
  const isLocal = n.kind === 'local';
  const st = nodeState(f.c, n);
  return (
    <>
      <h4>
        {aiName(n)}
        <span className={`fn-st s-${st.k}`} title={st.title}>
          {st.label}
        </span>
      </h4>
      {!isLocal && <SetupTable f={f} x={x} />}
      {isLocal && x.which === 'claude' && (
        <p className="muted small">
          Claude Code on this computer, with your own subscription.{' '}
          {f.c.account?.subscriptionType ? `Plan: ${f.c.account.subscriptionType}.` : ''}
        </p>
      )}
      {!isLocal && x.cooldown && (
        <div className="warn-banner">
          <Ico svg={I.warn} />
          <span>
            {x.cooldown.message || x.cooldown.reason}{' '}
            <button type="button" className="link-btn" onClick={() => f.providers.retry(x)}>
              Retry now
            </button>
          </span>
        </div>
      )}
      <TestBanner test={f.providers.tests[n.id]} />
      <ProviderButtons f={f} n={n} />
      <h5>Model for each tier</h5>
      <p className="muted small" style={{ marginTop: 0 }}>
        Blank uses the provider’s own model.
      </p>
      {f.g.tiers.map((k) => (
        <label key={k} className="field">
          <span>
            <i className="fi-dot" style={{ background: TIER[k].color }} />
            {TIER[k].label}
          </span>
          <TierModelField f={f} tier={k} node={n} />
        </label>
      ))}
      <ModelSaveBar f={f} />
    </>
  );
}
