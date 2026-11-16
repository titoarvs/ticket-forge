'use client';
// Administration → Plans & gateways (the owner who runs this TicketForge, hosted service): turn payment gateways
// (PayMongo, Xendit, Stripe) on and off, several at once, and create and edit the subscription plans (name, price,
// currency PHP or USD, recurring cycle, free-plan option, trial days). Editing a plan that has subscribers adds a new
// version: they stay on theirs and new subscriptions use the new one.
import { useEffect, useState } from 'react';
import { api, toast, openModal, closeModal, type Any } from './core';
import { Ico, I, Modal, Spinner, ErrorState } from './ui';
import { TF, SF, CB, MenuItem } from './fields';

export const planPrice = (p: Any) => (p.isFree ? 'Free' : `${p.currency} ${p.price.toLocaleString('en', { maximumFractionDigits: 2 })}`);
export const cycleLabel = (i: string) => (i === 'year' ? 'yearly' : 'monthly');

function GatewayCard({ g, reload }: { g: Any; reload: () => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (active: boolean) => {
    setBusy(true); setError('');
    try {
      await api('/api/billing/gateways', { method: 'PUT', body: { provider: g.provider, active, secretKey: key } });
      setKey('');
      toast(active ? `${g.name} is active.` : `${g.name} is turned off.`);
      reload();
    } catch (e: Any) { setError(e.message); toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <div className="card bill-plan" data-testid={`gateway-${g.provider}`}>
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0 }}>{g.name}</h3><div className="spacer" />
        <span className={`loz ${g.active ? 't-pass' : ''}`} aria-label={`${g.name} status`}>{g.active ? 'Active' : 'Inactive'}</span>
      </div>
      <p className="muted small">Takes {g.currencies.join(' and ')} payments.{g.configured && <> Key saved <b>{g.keyEnd}</b>.</>}</p>
      <label className="field"><span>Secret key</span>
        <TF type="password" autoComplete="off" aria-label={`${g.name} secret key`} value={key} onChange={(e) => { setKey(e.target.value); setError(''); }}
          placeholder={g.configured ? 'Leave empty to keep the saved key' : g.keyFormat} /></label>
      {error && <p className="pay-missing" role="alert">{error}</p>}
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button className="btn primary" disabled={busy || (!key && !g.configured)} onClick={() => save(true)}>{busy ? 'Checking…' : g.active ? 'Save key' : 'Enable'}</button>
        {g.active && <button className="btn" disabled={busy} onClick={() => save(false)}>Disable</button>}
      </div>
    </div>
  );
}

function PlanModal({ plan, currencies, intervals, onSaved }: { plan?: Any; currencies: string[]; intervals: string[]; onSaved: () => void }) {
  const [f, setF] = useState({ name: plan?.name || '', blurb: plan?.blurb || '', price: String(plan?.price ?? ''), currency: plan?.currency || 'USD', interval: plan?.interval || 'month', isFree: Boolean(plan?.isFree), trialDays: String(plan?.trialDays ?? 0) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true); setError('');
    const body = { ...f, price: f.isFree ? 0 : Number(f.price), trialDays: f.isFree ? 0 : Number(f.trialDays || 0) };
    try {
      const r = plan ? await api(`/api/billing/plans/${encodeURIComponent(plan.id)}`, { method: 'PUT', body }) : await api('/api/billing/plans', { method: 'POST', body });
      toast(plan ? (r.newVersion ? `${f.name} has a new version (v${r.plan.version}). Current subscribers stay on the old one.` : `${f.name} saved.`) : `${f.name} created.`);
      closeModal(); onSaved();
    } catch (e: Any) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal title={plan ? `Edit ${plan.name}` : 'New plan'} actions={[{ label: 'Cancel' }, { label: plan ? 'Save plan' : 'Create plan', kind: 'primary', busy, onClick: submit }]}>
      {plan?.subscribers > 0 && <p className="muted small" style={{ marginTop: 0 }}><Ico svg={I.warn} /> {plan.subscribers} workspace{plan.subscribers === 1 ? ' is' : 's are'} on this plan. Changing the price, currency, cycle or trial days adds a new version: they keep the current one and new subscriptions use the new one.</p>}
      <label className="field"><span>Name <span className="req">*</span></span><TF autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Business" /></label>
      <label className="field"><span>Description</span><TF value={f.blurb} onChange={(e) => setF({ ...f, blurb: e.target.value })} placeholder="One line shown under the name" /></label>
      <label className="check"><CB checked={f.isFree} onChange={(e) => setF({ ...f, isFree: e.target.checked })} /> Free plan (no price, no trial)</label>
      {!f.isFree && <>
        <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: 1 }}><span>Price <span className="req">*</span></span><TF type="number" min={0} aria-label="Price" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
          <label className="field"><span>Currency</span><SF value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{currencies.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}</SF></label>
          <label className="field"><span>Billed</span><SF value={f.interval} onChange={(e) => setF({ ...f, interval: e.target.value })}>{intervals.map((i) => <MenuItem key={i} value={i}>{i === 'year' ? 'Yearly' : 'Monthly'}</MenuItem>)}</SF></label>
        </div>
        <label className="field"><span>Trial days</span><TF type="number" min={0} max={365} aria-label="Trial days" value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: e.target.value })} />
          <span className="muted small">The trial needs no card. After it ends the workspace is locked until the owner pays.</span></label>
      </>}
      {error && <p className="pay-missing" role="alert">{error}</p>}
    </Modal>
  );
}

export function PaymentsTab() {
  const [gw, setGw] = useState<Any>(null);
  const [pl, setPl] = useState<Any>(null);
  const [error, setError] = useState<Any>(null);
  const load = () => Promise.all([api('/api/billing/gateways'), api('/api/billing/plans')]).then(([g, p]) => { setGw(g.gateways); setPl(p); setError(null); }).catch(setError);
  useEffect(() => { load(); }, []);
  if (error) return <ErrorState title="Couldn’t load plans and gateways" error={error} onRetry={load}><p>Only the owner who runs this TicketForge can set them up, on the hosted service.</p></ErrorState>;
  if (!gw || !pl) return <div className="card" style={{ padding: 24 }}><Spinner /> Loading…</div>;
  const edit = (plan?: Any) => openModal(<PlanModal plan={plan} currencies={pl.currencies} intervals={pl.intervals} onSaved={load} />);
  return (
    <div className="bill">
      <div className="row" style={{ alignItems: 'center', margin: '0 0 12px' }}><h2 style={{ margin: 0 }}>Payment gateways</h2></div>
      <p className="muted small">Turn on as many as you like. People pick one of the active gateways when they pay. A gateway is only saved as active when it accepts the secret key.</p>
      <div className="bill-plans">{gw.map((g: Any) => <GatewayCard key={g.provider} g={g} reload={load} />)}</div>

      <div className="row" style={{ alignItems: 'center', margin: '24px 0 12px' }}><h2 style={{ margin: 0 }}>Plans</h2><div className="spacer" />
        <button className="btn primary" onClick={() => edit()}><Ico svg={I.plus} />New plan</button></div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="tbl" aria-label="Plans">
          <thead><tr><th>Plan</th><th>Price</th><th>Billed</th><th>Trial</th><th>Version</th><th>Subscribers</th><th /></tr></thead>
          <tbody>{pl.plans.map((p: Any) => (
            <tr key={p.id} data-testid={`plan-${p.id}`}>
              <td><b>{p.name}</b>{p.archived && <> <span className="loz">Archived</span></>}{p.blurb && <div className="muted small">{p.blurb}</div>}</td>
              <td>{planPrice(p)}</td>
              <td>{p.isFree ? '—' : cycleLabel(p.interval)}</td>
              <td>{p.trialDays ? `${p.trialDays} days` : 'None'}</td>
              <td>v{p.version}</td>
              <td>{p.subscribers}</td>
              <td><button className="btn" onClick={() => edit(p)}>Edit</button></td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}
