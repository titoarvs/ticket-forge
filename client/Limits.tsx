'use client';
// Administration → Limits: every plan limit with its name, current value, what's used and what's left (and flagged
// when reached), and GitHub Copilot's limits (or why they're unavailable). Also used by Billing for the same rows.
import { useEffect, useState } from 'react';
import { api, type Any } from './core';
import { Ico, I, Spinner, ErrorState } from './ui';

export const num = (n: number, unit: string) => (unit === 'mb' ? (n >= 1000 ? `${(n / 1000).toFixed(1)} GB` : `${n} MB`) : n.toLocaleString());

/** One plan limit: name and value, used and remaining, a bar, and "Limit reached" when nothing is left. */
export function LimitBar({ r }: { r: Any }) {
  const unlimited = r.limit == null;
  const pct = unlimited ? 0 : r.limit === 0 ? 100 : Math.min(100, Math.round((r.used / r.limit) * 100));
  const tone = r.reached ? 'bad' : pct >= 80 ? 'warn' : 'ok';
  return (
    <div className={`bill-usage ${r.reached ? 'reached' : ''}`}>
      <div className="bill-usage-h"><span>{r.name}</span>
        <b>{unlimited ? 'No limit' : num(r.limit, r.unit)}{r.reached && <> <span className="loz t-fail">Limit reached</span></>}</b></div>
      <div className="muted small">Used {num(r.used, r.unit)} · {unlimited ? 'No limit' : `${num(r.remaining, r.unit)} remaining`}</div>
      {!unlimited && <div className="bill-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={r.name}><i className={tone} style={{ width: `${pct}%` }} /></div>}
      {r.note && <div className="muted small">{r.note}</div>}
    </div>
  );
}

export function LimitsTab() {
  const [d, setD] = useState<Any>(null);
  const [error, setError] = useState<Any>(null);
  const load = () => { setError(null); api('/api/limits').then(setD).catch((e) => { setD(null); setError(e); }); };
  useEffect(load, []);
  // A failed load shows only the error, never numbers.
  if (error) return <ErrorState title="Couldn’t load limits" error={error} onRetry={load}><p>Your plan and Copilot limits couldn’t be loaded.</p></ErrorState>;
  if (!d) return <div className="card" style={{ padding: 24 }}><Spinner /> Loading limits…</div>;
  const cp = d.copilot || { connected: false, rows: [] };
  return (
    <div className="bill">
      <div className="card bill-now">
        <div className="bill-now-h"><div><span className="muted small">Plan limits</span><h2>{d.plan ? d.plan.name : 'No plans here'}</h2></div></div>
        {d.plan ? <div className="bill-usages">{d.plan.rows.map((r: Any) => <LimitBar key={r.key} r={r} />)}</div>
          : <p className="muted" style={{ margin: 0 }}>This TicketForge is self-hosted, so there are no plans or limits. Plans apply on the hosted service.</p>}
      </div>
      <div className="card bill-now" style={{ marginTop: 16 }}>
        <div className="bill-now-h"><div><span className="muted small">GitHub Copilot</span><h2>Copilot limits</h2></div></div>
        {cp.connected
          ? <div className="bill-usages">{cp.rows.map((r: Any) => (
            <div key={r.key} className={`bill-usage ${r.reached ? 'reached' : ''}`}>
              <div className="bill-usage-h"><span>{r.name}</span><b>{r.value}{r.reached && <> <span className="loz t-fail">Limit reached</span></>}</b></div>
            </div>))}</div>
          : <p className="muted" style={{ margin: 0 }}><Ico svg={I.warn} /> Copilot limits are unavailable until Copilot is connected.{cp.reason ? ` ${cp.reason}` : ''}</p>}
      </div>
    </div>
  );
}
