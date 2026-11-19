'use client';
// Local AI (with the Claude plan's limits), Providers (with an environment-variable example), and
// what the AI flow canvas can do to providers.
import { useState } from 'react';
import { type Any, toast, openModal } from '../../core';
import { Confirm, PlanLimits } from '../../ui';
import { SF, MenuItem } from '../../fields';
import { removeAiEntry } from '../../api/admin';
import { applyAi, ProviderModal, envExample } from '../ProviderModal';
import { LocalAiCard } from '../LocalAiCard';
import { ProvidersCard } from '../ProvidersCard';

const capitalized = (s: string) => s.replace(/^./, (x) => x.toUpperCase());

/** The Claude plan's usage, read with this computer's Claude Code sign-in. */
function PlanLimitsCard({ c }: { c: Any }) {
  const plan = c.account?.subscriptionType;
  const checkedAt = c.planUsage?.checkedAt;
  return (
    <div className="card wide">
      <h3>Claude plan limits</h3>
      <p className="sub">
        Your Claude {plan ? `${capitalized(String(plan))} ` : ''}plan’s usage, read from Anthropic
        with your Claude Code sign-in on this computer (the same numbers as Claude’s own usage
        page). The AI pill warns at 80%.
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
      {checkedAt && (
        <p className="muted small" style={{ marginBottom: 0 }}>
          Checked{' '}
          {new Date(checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ·
          updates every minute.
        </p>
      )}
    </div>
  );
}

export function LocalSection({ c }: { c: Any }) {
  return (
    <div className="cards">
      <LocalAiCard c={c} />
      {c.account?.signedIn && <PlanLimitsCard c={c} />}
    </div>
  );
}

/** For providers set with environment variables instead: what to set, per provider. */
function EnvVariables({ c }: { c: Any }) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState('openai');
  return (
    <div className="card wide">
      <p className="muted small" style={{ margin: 0 }}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setOpen(!open);
          }}
        >
          {open ? 'Hide' : 'Prefer environment variables?'}
        </a>
        {open && (
          <>
            {' '}
            A provider set with environment variables (on Vercel:{' '}
            <b>Settings → Environment Variables</b>, then redeploy) is used after the ones above.
          </>
        )}
      </p>
      {open && (
        <>
          <label className="field" style={{ maxWidth: 280, marginTop: 12 }}>
            <span>Provider</span>
            <SF value={provider} onChange={(e) => setProvider(e.target.value)}>
              {c.providers.map((x: Any) => (
                <MenuItem key={x.id} value={x.id}>
                  {x.label}
                </MenuItem>
              ))}
            </SF>
          </label>
          <pre className="code">{envExample(c, provider)}</pre>
        </>
      )}
    </div>
  );
}

export function ProvidersSection({ c }: { c: Any }) {
  return (
    <div className="cards">
      <ProvidersCard c={c} />
      <EnvVariables c={c} />
    </div>
  );
}

function confirmRemove(x: Any) {
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
  );
}

/** What the AI flow canvas can do: add, edit or remove a provider, and go to another section. */
export const flowActions = (c: Any, go: (k: string) => void) => ({
  onSaved: applyAi,
  add: () => openModal(<ProviderModal c={c} />),
  edit: (x: Any) => openModal(<ProviderModal c={c} entry={x} />),
  remove: confirmRemove,
  goto: go,
});
