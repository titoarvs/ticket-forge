'use client';
import { useState } from 'react';
import { S, P, api, emit, toast } from '../core';
import { ErrorState, Ico, I } from '../ui';
import { bootSession } from './set-local-engine';

/** The server didn't answer when the app started. */
export function ServerDown() {
  return (
    <ErrorState
      title="Can’t reach TicketForge"
      error={S.bootError}
      onRetry={async () => {
        await bootSession();
        if (S.bootError) throw new Error('Still can’t reach the server.');
      }}
    >
      <p>The server didn’t respond. It may be restarting; try again in a moment.</p>
    </ErrorState>
  );
}
export function RunPill() {
  const r = S.autoRun;
  if (!r?.running) return null;
  return (
    <div id="runPill">
      <span className="spinner" />
      <button className="link-btn" onClick={() => P() && S.nav(`/p/${P().id}/automation`)}>
        Running tests {r.done}/{r.total} · {r.pass} passed · {r.fail} failed
      </button>
      <button className="btn sm" onClick={() => r.ctrl?.abort()}>
        <Ico svg={I.stop} />
        Stop
      </button>
    </div>
  );
}
const DOC_TITLE: Record<string, string> = { terms: 'Terms of Use', privacy: 'Privacy Policy' };
/**
 * Asks people to accept the Terms of Use and Privacy Policy when they haven't yet (accounts from
 * before consent existed) or after a material change. On the hosted service (SaaS) it can't be put
 * off; self-hosted, it can.
 */
export function LegalPrompt() {
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [later, setLater] = useState(false);
  const legal = S.auth?.legal;
  const needs: string[] = legal?.needs || [];
  if (!needs.length || (later && !S.auth?.saas)) return null;
  const changed = Boolean(S.user?.termsAcceptedAt);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api('/api/me/legal', { method: 'POST', body: { accept: true } });
      S.auth.legal = r.legal;
      S.user.termsAcceptedAt = new Date().toISOString();
      emit();
      toast('Thanks, you’re all set.');
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="legal-overlay" role="dialog" aria-modal="true" aria-labelledby="legal-h">
      <div className="legal-card">
        <h2 id="legal-h">{changed ? 'We’ve updated our terms' : 'Please review our terms'}</h2>
        <p className="muted">
          {changed
            ? 'The documents below have changed. Please read them and accept to keep using TicketForge.'
            : 'Before you carry on, please read and accept the documents below.'}
        </p>
        <ul className="legal-docs">
          {needs.map((d) => (
            <li key={d}>
              <a href={`/${d}`} target="_blank" rel="noopener">
                {DOC_TITLE[d] || d}
              </a>
              <span className="muted small"> · version {legal?.versions?.[d]}</span>
            </li>
          ))}
        </ul>
        <label className="consent">
          <input
            type="checkbox"
            checked={accept}
            onChange={(e) => setAccept(e.target.checked)}
            data-testid="accept-legal"
          />
          <span>
            I have read and agree to the {needs.map((d) => DOC_TITLE[d] || d).join(' and ')}.
          </span>
        </label>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          {!S.auth?.saas && (
            <button className="btn subtle" onClick={() => setLater(true)}>
              Remind me later
            </button>
          )}
          <button className="btn primary" disabled={!accept || busy} onClick={submit}>
            {busy ? 'Saving…' : 'Accept and continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
