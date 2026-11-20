'use client';
import { useState } from 'react';
import { type Any, toast } from '../core';
import { patchAiSettings } from '../api/admin';
import { SF, MenuItem, CB } from '../fields';
import { applyAi } from './ProviderModal';

/**
 * Which AI runs on this computer (localhost): Claude Code or the GitHub Copilot CLI, and Copilot as
 * Claude's backup.
 */
export function LocalAiCard({ c }: { c: Any }) {
  const [busy, setBusy] = useState('');
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const patch = (b: Any) => patchAiSettings(b).then(applyAi);
  return (
    <div className="card wide">
      <h3>Local AI</h3>
      <p className="sub">
        Used when TicketForge is opened on this computer (localhost), with your own subscription.
        Model routing picks the model per task.
      </p>
      <div className="local-ai" style={{ marginTop: 0 }}>
        <div className="local-ai-h">
          <b>Local AI on this computer</b>
          <span className="muted small">
            Used when TicketForge is opened at localhost. Runs with your own subscription.
          </span>
        </div>
        <div className="local-ai-opts" role="radiogroup" aria-label="Local AI">
          {(
            [
              ['claude', 'Claude Code', 'Your Claude account (Claude Code).'],
              ['copilot', 'GitHub Copilot CLI', 'Your GitHub Copilot subscription (copilot).'],
            ] as [string, string, string][]
          ).map(([k, l, d]) => (
            <button
              key={k}
              role="radio"
              aria-checked={(c.localEngine || 'claude') === k}
              className={(c.localEngine || 'claude') === k ? 'on' : ''}
              disabled={!!busy || (k === 'copilot' && !c.copilot.available)}
              onClick={() => run(`engine:${k}`, () => patch({ localEngine: k }))}
            >
              <b>{l}</b>
              <span className="muted small">{d}</span>
            </button>
          ))}
        </div>
        <div className="local-ai-cp small">
          <span
            className={`dot ${!c.copilot.available ? 'bad' : c.copilot.cooldown ? 'warn' : 'ok'}`}
          />
          {c.copilot.available ? (
            <>
              GitHub Copilot CLI {c.copilot.version}
              {c.copilot.cooldown ? (
                <>
                  {' '}
                  · {c.copilot.cooldown.reason} · back{' '}
                  {new Date(c.copilot.cooldown.until).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </>
              ) : (
                ' · ready'
              )}
            </>
          ) : (
            <>
              GitHub Copilot CLI isn’t installed. Run <code>npm install -g @github/copilot</code>,
              then <code>copilot</code> and <code>/login</code>.
            </>
          )}
          {c.copilot.available && (
            <label className="local-ai-model">
              Model
              <SF
                value={c.copilotModel || ''}
                disabled={!!busy}
                onChange={(e) => run('cpmodel', () => patch({ copilotModel: e.target.value }))}
              >
                {(c.copilot.models || ['']).map((m: string) => (
                  <MenuItem key={m || 'default'} value={m}>
                    {m || 'Copilot’s default'}
                  </MenuItem>
                ))}
              </SF>
            </label>
          )}
        </div>
        {(c.localEngine || 'claude') === 'claude' && c.copilot.available && (
          <label className="check small">
            <CB
              checked={Boolean(c.copilotBackup)}
              disabled={!!busy}
              onChange={(e: Any) =>
                run('cpbackup', () => patch({ copilotBackup: e.target.checked }))
              }
            />
            When your Claude account is limited or signed out, use GitHub Copilot before the
            providers below
          </label>
        )}
      </div>
    </div>
  );
}
