'use client';
// Subscription checkout (owner): choose how to pay (card, GCash or Maya), see the total in PHP, and continue to the
// payment step of the chosen method, which sends the owner to PayMongo's hosted checkout. Methods the gateway doesn't
// support aren't listed (the server decides). The return page (/checkout/return) shows the way back from PayMongo.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { S, api, toast, closeProject, useStore, type Any } from './core';
import { Spinner, ErrorState, EmptyState, Ico, I } from './ui';

const php = (n: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(n);
const per = (i: string) => (i === 'year' ? 'year' : 'month');
const search = () => new URLSearchParams(location.search);

export function CheckoutPage() {
  useStore();
  const [d, setD] = useState<Any>(null);
  const [error, setError] = useState<Any>(null);
  const [method, setMethod] = useState('');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => {
    const q = search();
    api(`/api/billing/payment-methods?plan=${encodeURIComponent(q.get('plan') || '')}&interval=${encodeURIComponent(q.get('interval') || 'month')}`)
      .then((x) => { setD(x); setError(null); }).catch(setError);
  };
  useEffect(() => { closeProject(); load(); }, []);

  const pay = async () => {
    if (!method) { setMissing(true); return; }
    setBusy(true);
    try { const r = await api('/api/billing/payment-methods', { method: 'POST', body: { plan: d.plan.id, interval: d.interval, method } }); S.nav(r.url); }
    catch (e: Any) { toast(e.message, 'err'); setBusy(false); }
  };

  return (
    <div className="page"><div className="page-inner pay">
      <h1>Checkout</h1>
      {error ? <ErrorState title="Couldn’t load checkout" error={error} onRetry={load} actions={<Link className="btn" href="/admin/billing">Back to billing</Link>}><p>The payment methods couldn’t be loaded.</p></ErrorState>
        : !d ? <div className="card" style={{ padding: 24 }}><Spinner /> Loading checkout…</div>
          : <div className="card pay-card">
            <div className="pay-total"><span className="muted small">{d.plan.name} plan, billed every {per(d.interval)}</span><b aria-label="Total">{php(d.amount)}</b><span className="muted small">Total in {d.currency}</span></div>
            <fieldset className="pay-methods" aria-describedby={missing ? 'pay-missing' : undefined}>
              <legend>Payment method</legend>
              {d.methods.length === 0 && <p className="muted">No payment methods are available right now.</p>}
              {d.methods.map((m: Any) => (
                <label key={m.id} className={`pay-method ${method === m.id ? 'on' : ''}`}>
                  <input type="radio" name="payment-method" value={m.id} checked={method === m.id} onChange={() => { setMethod(m.id); setMissing(false); }} />
                  <span><b>{m.label}</b><span className="muted small">{m.hint}</span></span>
                </label>
              ))}
            </fieldset>
            {missing && <p id="pay-missing" className="pay-missing" role="alert">Choose a payment method to continue.</p>}
            <div className="row" style={{ gap: 8, marginTop: 16 }}>
              <Link className="btn" href="/admin/billing">Back</Link>
              <button className="btn primary" onClick={pay} disabled={busy || d.methods.length === 0}>{busy ? 'One moment…' : `Pay ${php(d.amount)}`}</button>
            </div>
          </div>}
    </div></div>
  );
}

/** The payment step of the chosen method (card, GCash or Maya). */
export function PaymentStepPage({ method }: { method: string }) {
  useStore();
  const [d, setD] = useState<Any>(null);
  const [error, setError] = useState<Any>(null);
  const load = () => {
    const q = search();
    api(`/api/billing/payment-methods?plan=${encodeURIComponent(q.get('plan') || '')}&interval=${encodeURIComponent(q.get('interval') || 'month')}`)
      .then((x) => { setD(x); setError(null); }).catch(setError);
  };
  useEffect(() => { closeProject(); load(); }, []);
  const m = d?.methods.find((x: Any) => x.id === method);
  const [busy, setBusy] = useState(false);
  const toPayMongo = async () => {
    setBusy(true);
    try { const r = await api('/api/billing/paymongo', { method: 'POST', body: { plan: d.plan.id, interval: d.interval, method } }); S.nav(r.url); }
    catch (e: Any) { toast(e.message, 'err'); setBusy(false); }
  };
  return (
    <div className="page"><div className="page-inner pay">
      <h1>{m ? `Pay with ${m.label}` : 'Payment'}</h1>
      {error ? <ErrorState title="Couldn’t load the payment step" error={error} onRetry={load} actions={<Link className="btn" href="/admin/billing">Back to billing</Link>}><p>The payment details couldn’t be loaded.</p></ErrorState>
        : !d ? <div className="card" style={{ padding: 24 }}><Spinner /> Loading…</div>
          : !m ? <div className="card pay-card"><p>This payment method isn’t available.</p><Link className="btn" href={`/checkout?plan=${d.plan.id}&interval=${d.interval}`}>Choose another method</Link></div>
            : <div className="card pay-card">
              <div className="pay-total"><span className="muted small">{d.plan.name} plan, billed every {per(d.interval)}</span><b aria-label="Total">{php(d.amount)}</b><span className="muted small">Total in {d.currency}</span></div>
              <p className="muted">Payment method: <b>{m.label}</b></p>
              <div className="row" style={{ gap: 8, marginTop: 16 }}>
                <Link className="btn" href={`/checkout?plan=${d.plan.id}&interval=${d.interval}`}>Change payment method</Link>
                <button className="btn primary" onClick={toPayMongo} disabled={busy}>{busy ? 'Opening PayMongo…' : 'Continue to PayMongo'}</button>
              </div>
            </div>}
    </div></div>
  );
}

/** Where PayMongo sends the owner back to: paid (new plan shown), cancelled (nothing created) or failed (retry). */
export function CheckoutReturnPage() {
  useStore();
  const [r, setR] = useState<Any>(null);
  const [error, setError] = useState<Any>(null);
  const load = () => {
    const q = search();
    return api(`/api/billing/paymongo/return?result=${encodeURIComponent(q.get('result') || '')}&plan=${encodeURIComponent(q.get('plan') || '')}&interval=${encodeURIComponent(q.get('interval') || 'month')}`)
      .then((x) => { setR(x); setError(null); }).catch(setError);
  };
  useEffect(() => { closeProject(); load(); }, []);
  // Retry goes back to the checkout of the same plan (or to billing when the plan isn't known).
  const retryHref = r?.plan && typeof r.plan === 'string' ? `/checkout?plan=${r.plan}&interval=${r.interval}` : '/admin/billing';
  const billing = <Link className="btn" href="/admin/billing">Back to billing</Link>;
  return (
    <div className="page"><div className="page-inner pay">
      <h1>Payment</h1>
      {error ? <ErrorState title="Couldn’t check your payment" error={error} onRetry={load} actions={billing}><p>We couldn’t confirm how the payment went.</p></ErrorState>
        : !r ? <div className="card" style={{ padding: 24 }}><Spinner /> Checking your payment…</div>
          : r.status === 'success' ? <EmptyState icon={I.check} tone="success" title="Payment successful" actions={<Link className="btn primary" href="/admin/billing">Go to billing</Link>}>
            <p role="status">{r.message}</p>
            <p>Current plan: <b aria-label="Current plan">{r.plan?.name}</b></p>
          </EmptyState>
            : r.status === 'cancelled' ? <EmptyState icon={I.warn} tone="neutral" title="Checkout cancelled" actions={<>{billing}<Link className="btn primary" href={retryHref}>Start again</Link></>}>
              <p role="status">{r.message}</p>
              <p>Current plan: <b aria-label="Current plan">{r.current?.name || 'Free'}</b></p>
            </EmptyState>
              : <EmptyState icon={I.warn} tone="danger" title="Payment failed" actions={<>{billing}<Link className="btn primary" href={retryHref}><Ico svg={I.refresh} />Retry</Link></>}>
                <p role="alert">{r.message}</p>
              </EmptyState>}
    </div></div>
  );
}
