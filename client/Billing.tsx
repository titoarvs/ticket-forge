'use client';
// Administration → Billing (hosted service, workspace owner): the plan in force, what the workspace uses against its
// limits, and upgrading (Stripe Checkout) or managing billing (Stripe Customer Portal). Also the "Upgrade" prompt
// shown anywhere in the app when something would go over the plan (a 402 with code 'limit').
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { S, api, toast, openModal, closeModal, type Any } from './core';
import { Ico, I, Modal, Spinner, ErrorState } from './ui';

const LABELS: [string, string, (n: number) => string][] = [
  ['projects', 'Projects', (n) => n.toLocaleString()],
  ['members', 'Members', (n) => n.toLocaleString()],
  ['aiCalls', 'AI actions this month', (n) => n.toLocaleString()],
  ['codeJobs', 'AI code jobs this month', (n) => n.toLocaleString()],
  ['storageMb', 'Storage', (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)} GB` : `${n} MB`)],
];
const date = (d: string | null) => (d ? new Date(d).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const money = (n: number, cur: string) => (n === 0 ? 'Free' : new Intl.NumberFormat([], { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n));

async function go(path: string, body: Any = {}) {
  try { const r = await api(path, { method: 'POST', body }); if (r.url) location.href = r.url; }
  catch (e: Any) { toast(e.message, 'err'); }
}

function UsageBar({ label, used, limit, fmt, extra }: { label: string; used: number; limit: number | null; fmt: (n: number) => string; extra?: string }) {
  const pct = limit == null ? 0 : limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  const tone = limit != null && pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : 'ok';
  return (
    <div className="bill-usage">
      <div className="bill-usage-h"><span>{label}</span><b>{fmt(used)}{limit == null ? <span className="muted"> · no limit</span> : <span className="muted"> of {fmt(limit)}</span>}</b></div>
      {limit != null && <div className="bill-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}><i className={tone} style={{ width: `${Math.max(pct, 2)}%` }} /></div>}
      {extra && <div className="muted small">{extra}</div>}
    </div>
  );
}

export function BillingTab() {
  const [d, setD] = useState<Any>(null);
  const [error, setError] = useState<Any>(null);
  const [interval, setInterval_] = useState<'month' | 'year'>('month');
  const load = () => api('/api/billing').then((x) => { setD(x); setError(null); if (x.subscription?.interval) setInterval_(x.subscription.interval); }).catch(setError);
  useEffect(() => {
    load();
    // Back from Stripe Checkout: the webhook updates the plan within a few seconds.
    const q = new URLSearchParams(location.search).get('checkout');
    if (q === 'done') {
      toast('Thanks! Your plan updates in a moment.');
      let n = 0;
      const t = setInterval(() => { load(); if (++n >= 5) clearInterval(t); }, 2500);
      history.replaceState(null, '', location.pathname);
      return () => clearInterval(t);
    }
    if (q === 'cancelled') { toast('Checkout cancelled. Nothing changed.'); history.replaceState(null, '', location.pathname); }
    return undefined;
  }, []);
  if (error) return <ErrorState title="Couldn’t load billing" error={error} onRetry={load}><p>Your plan and usage couldn’t be loaded.</p></ErrorState>;
  if (!d) return <div className="card" style={{ padding: 24 }}><Spinner /> Loading billing…</div>;
  if (!d.enabled) return <div className="card" style={{ padding: 20 }}><h2 style={{ marginTop: 0 }}>No plans here</h2><p className="muted">This TicketForge is self-hosted, so there are no plans or limits. Plans apply on the hosted service (TICKETFORGE_MODE=saas).</p></div>;
  const p = d.plan, s = d.subscription, u = d.usage;
  const status = p.source === 'unlimited' ? 'This workspace has no limits.'
    : p.source === 'trial' ? `Free trial of Pro until ${date(p.trialEndsAt)}. Then the Free plan applies unless you choose a plan.`
      : p.source === 'subscription' ? (s.cancelAtPeriodEnd ? `Cancelled: stays ${p.name} until ${date(s.periodEnd)}, then Free.` : `Renews ${s.interval === 'year' ? 'yearly' : 'monthly'} on ${date(s.periodEnd)}.`)
        : 'You’re on the Free plan.';
  return (
    <div className="bill">
      {p.pastDue && <div className="banner warn" role="alert"><Ico svg={I.warn} /> Your last payment failed. Stripe will try again; update your card in Manage billing to keep {p.name}.</div>}
      <div className="card bill-now">
        <div className="bill-now-h">
          <div><span className="muted small">Current plan</span><h2>{p.name}</h2><p className="muted" style={{ margin: 0 }}>{status}</p></div>
          {s.hasCustomer && <button className="btn" onClick={() => go('/api/billing/portal')}><Ico svg={I.external} />Manage billing</button>}
        </div>
        <div className="bill-usages">{LABELS.map(([k, l, fmt]) => (
          <UsageBar key={k} label={l} used={u[k] || 0} limit={p.limits[k]} fmt={fmt} extra={k === 'members' && u.pendingInvites ? `${u.pendingInvites} pending invite${u.pendingInvites === 1 ? '' : 's'} count too` : k === 'aiCalls' ? 'Only AI paid by the service counts. Your own API keys and people’s own Claude subscriptions don’t.' : undefined} />))}</div>
      </div>
      {p.source !== 'unlimited' && <>
        <div className="row" style={{ alignItems: 'center', margin: '24px 0 12px', gap: 12 }}>
          <h2 style={{ margin: 0 }}>Plans</h2><div className="spacer" />
          <div className="seg" role="group" aria-label="Billing period">
            <button className={interval === 'month' ? 'on' : ''} aria-pressed={interval === 'month'} onClick={() => setInterval_('month')}>Monthly</button>
            <button className={interval === 'year' ? 'on' : ''} aria-pressed={interval === 'year'} onClick={() => setInterval_('year')}>Yearly</button>
          </div>
        </div>
        {!d.stripe && <p className="muted small">Payments aren’t set up on this server yet (STRIPE_SECRET_KEY), so plans can’t be bought here.</p>}
        <div className="bill-plans">{d.plans.map((pl: Any) => {
          const current = p.source === 'subscription' ? pl.id === p.id : pl.id === 'free' && p.source === 'free';
          const price = pl.price[interval];
          const subscribed = p.source === 'subscription';
          return (
            <div key={pl.id} className={`card bill-plan ${current ? 'current' : ''}`}>
              <h3>{pl.name}</h3><p className="muted small" style={{ minHeight: 34 }}>{pl.blurb}</p>
              <div className="bill-price">{money(price, d.currency)}{price > 0 && <span className="muted">/{interval === 'year' ? 'year' : 'month'}</span>}</div>
              <ul>{pl.features.map((f: string) => <li key={f}><Ico svg={I.check} />{f}</li>)}</ul>
              {current ? <button className="btn wide" disabled>Current plan</button>
                : pl.id === 'free' ? (subscribed ? <button className="btn wide" onClick={() => go('/api/billing/portal')}>Downgrade in Manage billing</button> : null)
                  : subscribed ? <button className="btn wide" onClick={() => go('/api/billing/portal')}>Switch in Manage billing</button>
                    : <button className="btn primary wide" disabled={!d.stripe || !pl.available[interval]} title={!pl.available[interval] ? 'Not available for this period yet' : ''}
                      onClick={() => go('/api/billing/checkout', { plan: pl.id, interval })}>Choose {pl.name}</button>}
            </div>
          );
        })}</div>
        <p className="muted small">Prices exclude taxes where they apply. Payments are handled by Stripe; TicketForge never sees your card. See the <Link href="/terms">Terms of Use</Link>.</p>
      </>}
    </div>
  );
}

/** Shown when something would go over the plan. Owners go to Billing; others are told to ask the owner. */
export function UpgradeModal({ info }: { info: Any }) {
  const owner = Boolean(S.user?.isOwner);
  return (
    <Modal title="Upgrade to do more" actions={[{ label: owner ? 'Not now' : 'OK' }, ...(owner ? [{ label: 'See plans', kind: 'primary' as const, onClick: () => { closeModal(); S.nav('/admin/billing'); } }] : [])]}>
      <p style={{ marginTop: 0 }}>{info?.error || info?.message || 'This would go over your plan.'}</p>
      {!owner && <p className="muted">Ask your workspace owner to upgrade the plan.</p>}
    </Modal>
  );
}
// Replaces any open dialog: the request that hit the limit usually came from it (e.g. "Create a blank project").
export const showUpgrade = (info: Any) => openModal(<UpgradeModal info={info} />);
