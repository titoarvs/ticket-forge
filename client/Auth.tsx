'use client';
// Sign-in screens: first-run setup, login, forgot/reset password, accept invite.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { S, emit, useStore, api, toast, type Any } from './core';
import { Ico, I, Toasts, Spinner } from './ui';
import { bootSession } from './AppShell';
import { TF, TA, SF, CB, RB, DateF, PeopleF, MenuItem, opts } from './fields';

type Mode = 'setup' | 'login' | 'forgot' | 'reset' | 'invite';

function Card({ title, sub, children, foot }: { title: string; sub?: ReactNode; children?: ReactNode; foot?: ReactNode }) {
  return (
    <div className="auth-wrap"><div className="auth-card">
      <div className="auth-brand"><span className="brand-mark" dangerouslySetInnerHTML={{ __html: I.logo }} />TicketForge</div>
      <h1>{title}</h1>{sub && <p className="muted">{sub}</p>}
      {children}
      {foot && <div className="auth-foot">{foot}</div>}
    </div></div>
  );
}
function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label className="field"><span>{label}</span><TF {...props} /></label>;
}

export default function AuthPage({ mode, token }: { mode: Mode; token?: string }) {
  useStore();
  const router = useRouter();
  const params = useSearchParams();
  const [f, setF] = useState({ name: '', email: '', pass: '', pass2: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Any>(null);
  const [invite, setInvite] = useState<Any>(null);
  const set = (k: string) => (e: Any) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { if (!S.ready) bootSession(); }, []);
  useEffect(() => {
    if (!S.ready) return;
    if (S.auth?.setupRequired && mode !== 'setup') router.replace('/setup');
    else if (!S.auth?.setupRequired && mode === 'setup') router.replace('/login');
    else if (S.user && mode === 'login') router.replace(params.get('next') || '/');
  }, [S.ready, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (mode !== 'invite' || !token) return;
    api(`/api/invites/${encodeURIComponent(token)}`).then(setInvite).catch((e) => setInvite({ error: e.message }));
  }, [mode, token]);

  const done = async (res: Any) => {
    if (!res?.user) return;
    S.user = res.user;
    await bootSession();
    toast(`Welcome, ${res.user.name}`);
    router.replace(mode === 'login' ? params.get('next') || '/' : '/');
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      if (mode === 'setup') await done(await api('/api/auth/setup', { method: 'POST', body: { name: f.name, email: f.email, password: f.pass } }));
      else if (mode === 'login') await done(await api('/api/auth/login', { method: 'POST', body: { email: f.email, password: f.pass } }));
      else if (mode === 'forgot') setSent(await api('/api/auth/forgot', { method: 'POST', body: { email: f.email } }));
      else if (mode === 'reset') {
        if (f.pass !== f.pass2) throw new Error('The passwords don’t match.');
        await done(await api('/api/auth/reset', { method: 'POST', body: { token, password: f.pass } }));
      } else if (mode === 'invite') await done(await api(`/api/invites/${encodeURIComponent(token!)}/accept`, { method: 'POST', body: { name: f.name, password: f.pass } }));
    } catch (e2: Any) { setErr(e2.message); }
    finally { setBusy(false); }
  };

  if (!S.ready) return <main id="app"><div className="auth-wrap"><Spinner /></div><Toasts /></main>;
  const form = (children: ReactNode, button: string) => (
    <form onSubmit={submit} noValidate>{children}
      <button className="btn primary wide" type="submit" disabled={busy}>{button}</button>
      <div className="auth-err" role="alert">{err}</div>
    </form>
  );
  let body: ReactNode;
  if (mode === 'setup') {
    body = <Card title="Set up TicketForge" sub="Create the owner account. The owner has full access and can invite your team." foot={<><Ico svg={I.settings} /> Database: {S.auth?.database}</>}>
      {form(<>
        <Field label="Your name" autoFocus autoComplete="name" value={f.name} onChange={set('name')} />
        <Field label="Work email" type="email" autoComplete="email" value={f.email} onChange={set('email')} />
        <Field label="Password (at least 8 characters)" type="password" autoComplete="new-password" value={f.pass} onChange={set('pass')} />
      </>, 'Create owner account')}</Card>;
  } else if (mode === 'forgot') {
    body = <Card title="Forgot your password?" sub="Enter your email and we’ll send you a link to reset it." foot={<Link href="/login">Back to sign in</Link>}>
      {sent ? <div className="auth-ok"><Ico svg={I.check} /><div>If an account exists for that email, a reset link is on its way.
        {!sent.emailConfigured && <><br /><span className="muted small">Email isn’t set up on this server yet — ask an administrator to send you a reset link from Administration → Users.</span></>}</div></div>
        : form(<Field label="Email" type="email" autoFocus autoComplete="email" value={f.email} onChange={set('email')} />, 'Send reset link')}</Card>;
  } else if (mode === 'reset') {
    body = <Card title="Choose a new password" foot={<Link href="/login">Back to sign in</Link>}>
      {form(<>
        <Field label="New password (at least 8 characters)" type="password" autoFocus autoComplete="new-password" value={f.pass} onChange={set('pass')} />
        <Field label="Confirm new password" type="password" autoComplete="new-password" value={f.pass2} onChange={set('pass2')} />
      </>, 'Save password and sign in')}</Card>;
  } else if (mode === 'invite') {
    if (!invite) body = <Card title="Checking your invite…"><Spinner /></Card>;
    else if (invite.error) body = <Card title="Invite unavailable" sub={invite.error} foot={<Link href="/login">Go to sign in</Link>} />;
    else body = <Card title="Join your team on TicketForge" sub={<><b>{invite.inviter}</b> invited <b>{invite.email}</b> as <b>{invite.role}</b>.</>}>
      {form(<>
        {invite.message && <blockquote className="auth-quote">{invite.message}</blockquote>}
        <Field label="Your name" autoFocus autoComplete="name" value={f.name} onChange={set('name')} />
        <Field label="Create a password (at least 8 characters)" type="password" autoComplete="new-password" value={f.pass} onChange={set('pass')} />
      </>, 'Accept invite')}</Card>;
  } else {
    body = <Card title="Sign in" sub="Sign in to continue to TicketForge." foot={<><Link href="/forgot">Forgot password?</Link><span className="muted">·</span><span className="muted">New here? Ask an administrator for an invite.</span></>}>
      {form(<>
        <Field label="Email" type="email" autoFocus autoComplete="username" value={f.email} onChange={set('email')} />
        <Field label="Password" type="password" autoComplete="current-password" value={f.pass} onChange={set('pass')} />
      </>, 'Sign in')}</Card>;
  }
  return <main id="app">{body}<Toasts /></main>;
}
