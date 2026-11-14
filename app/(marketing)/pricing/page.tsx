import type { Metadata } from 'next';
import Link from 'next/link';
import { PLANS, PLAN_ORDER, TRIAL_DAYS, CURRENCY } from '@/lib/plans';

export const metadata: Metadata = { title: 'Pricing · TicketForge' };
const money = (n: number) => (n ? new Intl.NumberFormat('en', { style: 'currency', currency: CURRENCY, maximumFractionDigits: 0 }).format(n) : 'Free');

export default function Pricing() {
  return (
    <section className="mk-sec mk-pricing">
      <h1>Simple plans that grow with your team</h1>
      <p className="mk-lead">Start free. Paid plans include a {TRIAL_DAYS}-day trial. Prices per workspace, excluding taxes.</p>
      <div className="mk-plans">{PLAN_ORDER.map((id) => { const p = (PLANS as any)[id]; return (
        <article key={id} className={`mk-plan ${id === 'pro' ? 'featured' : ''}`}>
          {id === 'pro' && <span className="mk-badge">Most popular</span>}
          <h2>{p.name}</h2><p className="muted">{p.blurb}</p>
          <p className="mk-price"><b>{money(p.price.month)}</b>{p.price.month ? <span>/ month</span> : null}</p>
          {p.price.year ? <p className="muted small">or {money(p.price.year)} a year</p> : <p className="muted small">forever</p>}
          <ul>{p.features.map((f: string) => <li key={f}>{f}</li>)}</ul>
          <Link href={`/signup${id === 'free' ? '' : `?plan=${id}`}`} className={`btn ${id === 'pro' ? 'primary' : ''}`}>{id === 'free' ? 'Start free' : `Try ${p.name}`}</Link>
        </article>); })}</div>
      <p className="muted small">Bring your own AI: actions that use your workspace’s own AI keys or your own Claude subscription don’t count toward the monthly AI actions. See the <Link href="/terms">Terms of Use</Link> for billing and renewals.</p>
    </section>
  );
}
