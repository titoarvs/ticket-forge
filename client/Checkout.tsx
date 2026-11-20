'use client';
// Subscription checkout (owner): choose the plan and one of the active payment gateways, then
// continue to that gateway's hosted payment page. The return page (/checkout/return) shows the way
// back (paid, cancelled or failed). A trial ended without a payment lands here too: paying lifts
// the lock. (The PayMongo-only payment step further down is the older card / GCash / Maya flow of
// /checkout/[method].)
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { S, api, toast, closeProject, useStore, type Any } from './core';
import { Spinner, ErrorState, EmptyState, Ico, I } from './ui';
import { planPrice, cycleLabel } from './Payments';
import { refreshLock } from './Billing';

const php = (n: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(n);
const per = (i: string) => (i === 'year' ? 'year' : 'month');
const search = () => new URLSearchParams(location.search);

export function CheckoutPage() {
  useStore();
  const [d, setD] = useState<Any>(null);
  const [error, setError] = useState<Any>(null);
  const [planId, setPlanId] = useState('');
  const [gateway, setGateway] = useState('');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => {
    api(`/api/billing/checkout?plan=${encodeURIComponent(search().get('plan') || '')}`)
      .then((x) => {
        setD(x);
        setPlanId(x.plan || '');
        setError(null);
      })
      .catch(setError);
  };
  useEffect(() => {
    closeProject();
    load();
  }, []);

  const plan = d?.plans.find((p: Any) => p.id === planId);
  // Each gateway takes certain currencies (PayMongo and Xendit: PHP), so only the ones that can
  // take this plan are offered.
  const gateways = (d?.gateways || []).filter(
    (g: Any) => !plan || g.currencies.includes(plan.currency),
  );
  const pay = async () => {
    if (!plan || !gateway || !gateways.some((g: Any) => g.provider === gateway)) {
      setMissing(true);
      return;
    }
    setBusy(true);
    try {
      const r = await api('/api/billing/checkout', {
        method: 'POST',
        body: { plan: plan.id, gateway },
      });
      location.href = r.url;
    } catch (e: Any) {
      toast(e.message, 'err');
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-inner pay">
        <h1>Checkout</h1>
        {error ? (
          <ErrorState
            title="Couldn’t load checkout"
            error={error}
            onRetry={load}
            actions={
              <Link className="btn" href="/admin/billing">
                Back to billing
              </Link>
            }
          >
            <p>The plans and payment gateways couldn’t be loaded.</p>
          </ErrorState>
        ) : !d ? (
          <div className="card" style={{ padding: 24 }}>
            <Spinner /> Loading checkout…
          </div>
        ) : d.plans.length === 0 ? (
          <EmptyState
            icon={I.warn}
            tone="neutral"
            title="No plans to buy"
            actions={
              <Link className="btn" href="/admin/billing">
                Back to billing
              </Link>
            }
          >
            <p>There are no paid plans yet.</p>
          </EmptyState>
        ) : d.gateways.length === 0 ? (
          <EmptyState
            icon={I.warn}
            tone="neutral"
            title="No way to pay yet"
            actions={
              <Link className="btn" href="/admin/billing">
                Back to billing
              </Link>
            }
          >
            <p>No payment gateway is active. Ask whoever runs this TicketForge to turn one on.</p>
          </EmptyState>
        ) : (
          <div className="card pay-card">
            <fieldset className="pay-methods">
              <legend>Plan</legend>
              {d.plans.map((p: Any) => (
                <label key={p.id} className={`pay-method ${planId === p.id ? 'on' : ''}`}>
                  <input
                    type="radio"
                    name="plan"
                    value={p.id}
                    checked={planId === p.id}
                    onChange={() => {
                      setPlanId(p.id);
                      setMissing(false);
                    }}
                  />
                  <span>
                    <b>{p.name}</b>
                    <span className="muted small">
                      {planPrice(p)} {cycleLabel(p.interval)}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            {plan && (
              <div className="pay-total" style={{ marginTop: 16 }}>
                <span className="muted small">
                  {plan.name} plan, billed {cycleLabel(plan.interval)}
                </span>
                <b aria-label="Total">{planPrice(plan)}</b>
                <span className="muted small">Total in {plan.currency}</span>
              </div>
            )}
            <fieldset
              className="pay-methods"
              aria-describedby={missing ? 'pay-missing' : undefined}
            >
              <legend>Pay with</legend>
              {gateways.length === 0 && (
                <p className="muted">
                  No active payment gateway takes {plan?.currency} payments. Choose another plan.
                </p>
              )}
              {gateways.map((g: Any) => (
                <label
                  key={g.provider}
                  className={`pay-method ${gateway === g.provider ? 'on' : ''}`}
                >
                  <input
                    type="radio"
                    name="gateway"
                    value={g.provider}
                    checked={gateway === g.provider}
                    onChange={() => {
                      setGateway(g.provider);
                      setMissing(false);
                    }}
                  />
                  <span>
                    <b>{g.name}</b>
                    <span className="muted small">{g.currencies.join(', ')}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {missing && (
              <p id="pay-missing" className="pay-missing" role="alert">
                Choose a payment gateway to continue.
              </p>
            )}
            <div className="row" style={{ gap: 8, marginTop: 16 }}>
              {!S.auth?.billing?.locked && (
                <Link className="btn" href="/admin/billing">
                  Back
                </Link>
              )}
              <button
                className="btn primary"
                onClick={pay}
                disabled={busy || !plan || gateways.length === 0}
              >
                {busy ? 'One moment…' : plan ? `Pay ${planPrice(plan)}` : 'Pay'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The payment step of the chosen method (card, GCash or Maya). */
export function PaymentStepPage({ method }: { method: string }) {
  useStore();
  const [d, setD] = useState<Any>(null);
  const [error, setError] = useState<Any>(null);
  const load = () => {
    const q = search();
    api(
      `/api/billing/payment-methods?plan=${encodeURIComponent(q.get('plan') || '')}&interval=${encodeURIComponent(q.get('interval') || 'month')}`,
    )
      .then((x) => {
        setD(x);
        setError(null);
      })
      .catch(setError);
  };
  useEffect(() => {
    closeProject();
    load();
  }, []);
  const m = d?.methods.find((x: Any) => x.id === method);
  const [busy, setBusy] = useState(false);
  const toPayMongo = async () => {
    setBusy(true);
    try {
      const r = await api('/api/billing/paymongo', {
        method: 'POST',
        body: { plan: d.plan.id, interval: d.interval, method },
      });
      S.nav(r.url);
    } catch (e: Any) {
      toast(e.message, 'err');
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <div className="page-inner pay">
        <h1>{m ? `Pay with ${m.label}` : 'Payment'}</h1>
        {error ? (
          <ErrorState
            title="Couldn’t load the payment step"
            error={error}
            onRetry={load}
            actions={
              <Link className="btn" href="/admin/billing">
                Back to billing
              </Link>
            }
          >
            <p>The payment details couldn’t be loaded.</p>
          </ErrorState>
        ) : !d ? (
          <div className="card" style={{ padding: 24 }}>
            <Spinner /> Loading…
          </div>
        ) : !m ? (
          <div className="card pay-card">
            <p>This payment method isn’t available.</p>
            <Link className="btn" href="/checkout">
              Choose another method
            </Link>
          </div>
        ) : (
          <div className="card pay-card">
            <div className="pay-total">
              <span className="muted small">
                {d.plan.name} plan, billed every {per(d.interval)}
              </span>
              <b aria-label="Total">{php(d.amount)}</b>
              <span className="muted small">Total in {d.currency}</span>
            </div>
            <p className="muted">
              Payment method: <b>{m.label}</b>
            </p>
            <div className="row" style={{ gap: 8, marginTop: 16 }}>
              <Link className="btn" href="/checkout">
                Change payment method
              </Link>
              <button className="btn primary" onClick={toPayMongo} disabled={busy}>
                {busy ? 'Opening PayMongo…' : 'Continue to PayMongo'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Where the gateway sends the owner back to: paid (new plan shown, lock lifted), cancelled (nothing
 * changed) or failed (retry).
 */
export function CheckoutReturnPage() {
  useStore();
  const [r, setR] = useState<Any>(null);
  const [error, setError] = useState<Any>(null);
  const load = () => {
    return api(
      `/api/billing/checkout/return?result=${encodeURIComponent(search().get('result') || '')}`,
    )
      .then(async (x) => {
        setR(x);
        setError(null);
        if (x.status === 'success') await refreshLock();
      })
      .catch(setError);
  };
  useEffect(() => {
    closeProject();
    load();
  }, []);
  const billing = (
    <Link className="btn" href="/admin/billing">
      Back to billing
    </Link>
  );
  return (
    <div className="page">
      <div className="page-inner pay">
        <h1>Payment</h1>
        {error ? (
          <ErrorState
            title="Couldn’t check your payment"
            error={error}
            onRetry={load}
            actions={billing}
          >
            <p>We couldn’t confirm how the payment went.</p>
          </ErrorState>
        ) : !r ? (
          <div className="card" style={{ padding: 24 }}>
            <Spinner /> Checking your payment…
          </div>
        ) : r.status === 'success' ? (
          <EmptyState
            icon={I.check}
            tone="success"
            title="Payment successful"
            actions={
              <Link className="btn primary" href="/admin/billing">
                Go to billing
              </Link>
            }
          >
            <p role="status">{r.message}</p>
            <p>
              Current plan: <b aria-label="Current plan">{r.plan?.name}</b>
            </p>
          </EmptyState>
        ) : r.status === 'cancelled' ? (
          <EmptyState
            icon={I.warn}
            tone="neutral"
            title="Checkout cancelled"
            actions={
              <>
                {billing}
                <Link className="btn primary" href="/checkout">
                  Start again
                </Link>
              </>
            }
          >
            <p role="status">{r.message}</p>
            <p>
              Current plan: <b aria-label="Current plan">{r.current?.name || 'Free'}</b>
            </p>
          </EmptyState>
        ) : (
          <EmptyState
            icon={I.warn}
            tone="danger"
            title="Payment failed"
            actions={
              <>
                {billing}
                <Link className="btn primary" href="/checkout">
                  <Ico svg={I.refresh} />
                  Retry
                </Link>
              </>
            }
          >
            <p role="alert">{r.message}</p>
          </EmptyState>
        )}
      </div>
    </div>
  );
}
