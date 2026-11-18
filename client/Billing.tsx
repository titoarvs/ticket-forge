'use client';
// Administration → Billing (hosted service, workspace owner): the plan in force, what the workspace uses against its
// limits, choosing a plan (a trial needs no card, paying goes through checkout with the gateway of your choice), changing
// plan and cancelling. Also the "Upgrade" prompt shown anywhere in the app when something would go over the plan (a 402
// with code 'limit') and the pay prompt shown when a trial ended without a payment (code 'locked').
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { S, api, toast, openModal, closeModal, emit, type Any } from './core';
import { Ico, I, Modal, Spinner, ErrorState, Confirm } from './ui';
import { LimitBar, num } from './Limits';
import { planPrice } from './Payments';

const date = (d: string | null) => (d ? new Date(d).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '');

async function go(path: string, body: Any = {}) {
  try {
    const r = await api(path, { method: 'POST', body });
    if (r.url) location.href = r.url;
  } catch (e: Any) {
    toast(e.message, 'err');
  }
}

/** Reloads whether the workspace is locked (after paying or cancelling, the lock is lifted). */
export async function refreshLock() {
  try {
    const me = await api('/api/auth/me');
    if (S.auth) {
      S.auth.billing = me.billing;
      emit();
    }
  } catch {
    /* keep what we have */
  }
}

async function cancelPlan(name: string, reload: () => void) {
  try {
    const r = await api('/api/billing/cancel', { method: 'POST', body: {} });
    toast(`Subscription cancelled. ${name} access ends on ${date(r.accessEndsAt) || 'the end of the current period'}.`);
  } catch (e: Any) {
    toast(e.message, 'err');
  }
  await refreshLock();
  reload();
}

/** Chooses a plan: a trial starts at once (no card), a change during a trial applies at once, anything else goes to checkout. */
async function choosePlan(pl: Any, reload: () => void) {
  try {
    const r = await api('/api/billing/subscription', { method: 'POST', body: { plan: pl.id } });
    if (r.requiresPayment) {
      S.nav(`/checkout?plan=${encodeURIComponent(pl.id)}`);
      return;
    }
    toast(
      r.status === 'trialing'
        ? `Your ${pl.name} trial is on. No card needed until ${date(r.trialEndsAt)}.`
        : `You’re on the ${pl.name} plan.`,
    );
  } catch (e: Any) {
    toast(e.message, 'err');
  }
  reload();
}

export function BillingTab() {
  const [d, setD] = useState<Any>(null);
  const [error, setError] = useState<Any>(null);
  const load = () =>
    api('/api/billing')
      .then((x) => {
        setD(x);
        setError(null);
      })
      .catch(setError);
  useEffect(() => {
    load();
  }, []);
  if (error)
    return (
      <ErrorState title="Couldn’t load billing" error={error} onRetry={load}>
        <p>Your plan and usage couldn’t be loaded.</p>
      </ErrorState>
    );
  if (!d)
    return (
      <div className="card" style={{ padding: 24 }}>
        <Spinner /> Loading billing…
      </div>
    );
  if (!d.enabled)
    return (
      <div className="card" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>No plans here</h2>
        <p className="muted">
          This TicketForge is self-hosted, so there are no plans or limits. Plans apply on the hosted service (TICKETFORGE_MODE=saas).
        </p>
      </div>
    );
  const p = d.plan,
    s = d.subscription;
  const subscribed = p.source === 'subscription' && s.status !== 'trialing';
  const trialing = p.source === 'subscription' && s.status === 'trialing';
  const status =
    p.source === 'unlimited'
      ? 'This workspace has no limits.'
      : p.source === 'locked'
        ? `Your ${p.name} trial ended on ${date(p.trialEndsAt)}. Pay to restore access.`
        : p.pastDue && p.graceEndsAt
          ? `Past due. ${p.name} stays available until ${date(p.graceEndsAt)}, then the Free plan applies.`
          : trialing
            ? s.cancelAtPeriodEnd
              ? `Trial cancelled: ${p.name} stays until ${date(s.accessEndsAt || s.trialEndsAt)}, then Free.`
              : `Free trial until ${date(p.trialEndsAt)}. No card needed until then; pay before it ends to keep ${p.name}.`
            : p.source === 'trial'
              ? `Free trial of Pro until ${date(p.trialEndsAt)}. Then the Free plan applies unless you choose a plan.`
              : p.source === 'subscription'
                ? s.cancelAtPeriodEnd
                  ? `Cancelled: stays ${p.name} until ${date(s.accessEndsAt || s.periodEnd)}, then Free.`
                  : `${s.status === 'active' ? 'Active. ' : ''}Renews ${s.interval === 'year' ? 'yearly' : 'monthly'} on ${date(s.periodEnd)}.`
                : 'You’re on the Free plan.';
  return (
    <div className="bill">
      {p.pastDue && (
        <div className="banner warn" role="alert">
          <Ico svg={I.warn} />{' '}
          {p.graceEndsAt
            ? `Your last payment failed. Pay by ${date(p.graceEndsAt)} to keep ${p.name}; after that the workspace moves to the Free plan.`
            : `Your last payment failed. Pay again to keep ${p.name}.`}
        </div>
      )}
      {p.source === 'locked' && (
        <div className="banner warn" role="alert">
          <Ico svg={I.warn} /> Your {p.name} trial has ended and the workspace is locked.{' '}
          <Link href={`/checkout?plan=${p.id}`}>Pay now</Link> to restore access.
        </div>
      )}
      <div className="card bill-now">
        <div className="bill-now-h">
          <div>
            <span className="muted small">Current plan</span>
            <h2>{p.name}</h2>
            <p className="muted" style={{ margin: 0 }} data-testid="plan-status">
              {status}
            </p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {s.cancellable && (
              <button
                className="btn"
                onClick={() =>
                  openModal(
                    <Confirm
                      title="Cancel subscription?"
                      label="Cancel subscription"
                      text={
                        trialing || p.source === 'locked'
                          ? `${p.name} stays available until the trial ends${s.trialEndsAt ? ` on ${date(s.trialEndsAt)}` : ''}, then the workspace moves to the Free plan. You won’t be charged.`
                          : `You won’t be charged again. ${p.name} stays available until ${date(s.periodEnd) || 'the end of the current period'}, then the workspace moves to the Free plan.`
                      }
                      onYes={() => cancelPlan(p.name, load)}
                    />,
                  )
                }
              >
                Cancel subscription
              </button>
            )}
            {s.hasCustomer && (
              <button className="btn" onClick={() => go('/api/billing/portal')}>
                <Ico svg={I.external} />
                Manage billing
              </button>
            )}
          </div>
        </div>
        <div className="bill-usages">
          {d.limits.map((r: Any) => (
            <LimitBar key={r.key} r={r} />
          ))}
        </div>
      </div>
      {p.source !== 'unlimited' && (
        <>
          <div className="row" style={{ alignItems: 'center', margin: '24px 0 12px', gap: 12 }}>
            <h2 style={{ margin: 0 }}>Plans</h2>
          </div>
          {d.gateways.length === 0 && (
            <p className="muted small">
              No payment gateway is active yet, so paid plans can’t be paid for here.{' '}
              {S.auth?.canManageBilling ? (
                <>
                  Turn one on in <Link href="/admin/payments">Plans & gateways</Link>.
                </>
              ) : (
                'Ask whoever runs this TicketForge to set one up.'
              )}
            </p>
          )}
          <div className="bill-plans">
            {d.plans.map((pl: Any) => {
              const current =
                p.source === 'subscription' || p.source === 'locked' ? pl.id === p.id : pl.id === 'free' && p.source === 'free';
              const canTrial = !pl.isFree && pl.trialDays > 0 && !s.trialEndsAt && !subscribed;
              const label = pl.isFree
                ? `Switch to ${pl.name}`
                : canTrial
                  ? `Start ${pl.trialDays}-day free trial`
                  : subscribed
                    ? `Switch to ${pl.name}`
                    : `Choose ${pl.name}`;
              return (
                <div key={pl.id} className={`card bill-plan ${current ? 'current' : ''}`} data-testid={`plan-card-${pl.id}`}>
                  <h3>{pl.name}</h3>
                  <p className="muted small" style={{ minHeight: 34 }}>
                    {pl.blurb}
                  </p>
                  <div className="bill-price">
                    {planPrice(pl)}
                    {!pl.isFree && <span className="muted">/{pl.interval === 'year' ? 'year' : 'month'}</span>}
                  </div>
                  {!pl.isFree && pl.trialDays > 0 && (
                    <p className="muted small" style={{ margin: '0 0 8px' }}>
                      {pl.trialDays}-day free trial, no card needed.
                    </p>
                  )}
                  <ul>
                    {(pl.features || []).map((f: string) => (
                      <li key={f}>
                        <Ico svg={I.check} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="muted small" style={{ margin: '8px 0 4px' }}>
                    Limits
                  </div>
                  <ul aria-label={`${pl.name} limits`}>
                    {pl.limitList.map((l: Any) => (
                      <li key={l.key}>
                        <Ico svg={I.check} />
                        {l.name}: {l.value == null || l.value <= 0 ? 'No limit' : num(l.value, l.unit)}
                      </li>
                    ))}
                  </ul>
                  {current ? (
                    <button className="btn wide" disabled>
                      Current plan
                    </button>
                  ) : (
                    <button
                      className={`btn wide ${pl.isFree ? '' : 'primary'}`}
                      disabled={
                        (subscribed && !s.cancelAtPeriodEnd && pl.isFree) ||
                        (!pl.isFree && !canTrial && d.gateways.length === 0 && !trialing)
                      }
                      title={subscribed && pl.isFree ? 'Cancel your subscription to move to the Free plan' : ''}
                      onClick={() => choosePlan(pl, load)}
                    >
                      {label}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="muted small">
            Prices exclude taxes where they apply. Payments are handled by the gateway you pick at checkout; TicketForge never sees your
            card. See the <Link href="/terms">Terms of Use</Link>.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Shown instead of the app when a trial ended without a payment (the server refuses everything else until it is paid).
 * The owner pays or cancels; other people are told to ask the owner.
 */
export function LockedScreen() {
  const owner = Boolean(S.user?.isOwner);
  const b = S.auth?.billing || {};
  const name = b.plan?.name || 'paid';
  return (
    <div className="page">
      <div className="page-inner pay">
        <div className="card pay-card" role="alertdialog" aria-labelledby="locked-h" data-testid="locked-prompt">
          <h1 id="locked-h" style={{ marginTop: 0 }}>
            Your {name} trial has ended
          </h1>
          <p>
            {owner
              ? `This workspace is locked until you pay for the ${name} plan${b.trialEndedAt ? ` (the trial ended on ${date(b.trialEndedAt)})` : ''}. Your projects and data are safe and come back as soon as the payment completes.`
              : 'This workspace is locked because the free trial ended without a payment. Ask the workspace owner to pay to restore access.'}
          </p>
          {owner && (
            <div className="row" style={{ gap: 8, marginTop: 16 }}>
              <Link className="btn primary" href={`/checkout?plan=${encodeURIComponent(b.plan?.id || '')}`}>
                Pay now
              </Link>
              <button
                className="btn"
                onClick={() =>
                  openModal(
                    <Confirm
                      title="Move to the Free plan?"
                      label="Cancel subscription"
                      text="You won’t be charged and the workspace moves to the Free plan."
                      onYes={() => cancelPlan(name, () => {})}
                    />,
                  )
                }
              >
                Cancel and use Free
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shown when something would go over the plan. Owners go to Billing; others are told to ask the owner. */
export function UpgradeModal({ info }: { info: Any }) {
  const owner = Boolean(S.user?.isOwner);
  return (
    <Modal
      title="Upgrade to do more"
      actions={[
        { label: owner ? 'Not now' : 'OK' },
        ...(owner
          ? [
              {
                label: 'See plans',
                kind: 'primary' as const,
                onClick: () => {
                  closeModal();
                  S.nav('/admin/billing');
                },
              },
            ]
          : []),
      ]}
    >
      <p style={{ marginTop: 0 }}>{info?.error || info?.message || 'This would go over your plan.'}</p>
      {!owner && <p className="muted">Ask your workspace owner to upgrade the plan.</p>}
    </Modal>
  );
}
// Replaces any open dialog: the request that hit the limit usually came from it (e.g. "Create a blank project").
export const showUpgrade = (info: Any) => openModal(<UpgradeModal info={info} />);
