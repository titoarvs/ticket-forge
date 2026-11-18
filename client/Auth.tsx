'use client';
// Sign-in screens: first-run setup, login, sign-up (request access), forgot/reset password, accept invite.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { S, useStore, api, toast, type Any } from './core';
import { Ico, I, Toasts, Sk, Loading } from './ui';
import { bootSession, ServerDown } from './AppShell';
import { AuthSkeleton } from './skeletons';
import { Footer } from './Footer';
import { TF } from './fields';

type Mode = 'setup' | 'login' | 'signup' | 'forgot' | 'reset' | 'invite';

function Card({ title, sub, children, foot }: { title: string; sub?: ReactNode; children?: ReactNode; foot?: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" dangerouslySetInnerHTML={{ __html: I.logo }} />
          TicketForge
        </div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
        {children}
        {foot && <div className="auth-foot">{foot}</div>}
      </div>
      <Footer compact />
    </div>
  );
}
/** The unticked box people must tick to accept the Terms of Use and Privacy Policy (links open in a new tab). */
function Consent({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="consent">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} required data-testid="accept-terms" />
      <span>
        I have read and agree to the{' '}
        <a href="/terms" target="_blank" rel="noopener">
          Terms of Use
        </a>{' '}
        and the{' '}
        <a href="/privacy" target="_blank" rel="noopener">
          Privacy Policy
        </a>
        .
      </span>
    </label>
  );
}
function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span>{label}</span>
      <TF {...props} />
    </label>
  );
}

export default function AuthPage({ mode, token }: { mode: Mode; token?: string }) {
  useStore();
  const router = useRouter();
  const params = useSearchParams();
  const [f, setF] = useState({ name: '', email: '', pass: '', pass2: '', company: '', note: '', website: '' });
  const [accept, setAccept] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Any>(null);
  const [invite, setInvite] = useState<Any>(null);
  const set = (k: string) => (e: Any) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (!S.ready) bootSession();
  }, []);
  useEffect(() => {
    if (!S.ready || S.bootError) return;
    if (S.auth?.setupRequired && mode !== 'setup') router.replace('/setup');
    else if (!S.auth?.setupRequired && mode === 'setup') router.replace('/login');
    else if (S.user && (mode === 'login' || mode === 'signup')) router.replace(params.get('next') || '/projects');
  }, [S.ready, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (mode !== 'invite' || !token) return;
    api(`/api/invites/${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch((e) => setInvite({ error: e.message }));
  }, [mode, token]);

  const done = async (res: Any) => {
    if (!res?.user) return;
    S.user = res.user;
    await bootSession();
    toast(`Welcome, ${res.user.name}`);
    router.replace(mode === 'login' ? params.get('next') || '/projects' : '/projects');
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const needsConsent = mode === 'setup' || mode === 'invite' || mode === 'signup';
      if (needsConsent && !accept) throw new Error('Please tick the box to accept the Terms of Use and Privacy Policy.');
      if (mode === 'setup')
        await done(
          await api('/api/auth/setup', {
            method: 'POST',
            body: { name: f.name, email: f.email, password: f.pass, company: f.company, acceptTerms: accept },
          }),
        );
      else if (mode === 'signup') {
        const plan = params.get('plan');
        const note = [f.note.trim(), plan && /^[a-z]{2,12}$/.test(plan) ? `Interested in the ${plan} plan.` : '']
          .filter(Boolean)
          .join('\n');
        const r = await api('/api/auth/signup', {
          method: 'POST',
          body: { name: f.name, email: f.email, company: f.company, note, password: f.pass, website: f.website, acceptTerms: accept },
        });
        if (r.user) await done(r);
        else setSent(r);
      } else if (mode === 'login') await done(await api('/api/auth/login', { method: 'POST', body: { email: f.email, password: f.pass } }));
      else if (mode === 'forgot') setSent(await api('/api/auth/forgot', { method: 'POST', body: { email: f.email } }));
      else if (mode === 'reset') {
        if (f.pass !== f.pass2) throw new Error('The passwords don’t match.');
        await done(await api('/api/auth/reset', { method: 'POST', body: { token, password: f.pass } }));
      } else if (mode === 'invite')
        await done(
          await api(`/api/invites/${encodeURIComponent(token!)}/accept`, {
            method: 'POST',
            body: { name: f.name, password: f.pass, acceptTerms: accept },
          }),
        );
    } catch (e2: Any) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  if (S.bootError)
    return (
      <main id="app">
        <div className="auth-wrap">
          <div style={{ width: 'min(460px, 100%)' }}>
            <ServerDown />
          </div>
        </div>
        <Toasts />
      </main>
    );
  if (!S.ready)
    return (
      <main id="app">
        <AuthSkeleton />
        <Toasts />
      </main>
    );
  const form = (children: ReactNode, button: string) => (
    <form onSubmit={submit} noValidate>
      {children}
      <button className="btn primary wide" type="submit" disabled={busy}>
        {button}
      </button>
      <div className="auth-err" role="alert">
        {err}
      </div>
    </form>
  );
  let body: ReactNode;
  if (mode === 'setup') {
    body = (
      <Card
        title="Set up TicketForge"
        sub="Create the owner account. The owner has full access and can invite your team."
        foot={
          <>
            <Ico svg={I.settings} /> Database: {S.auth?.database}
          </>
        }
      >
        {form(
          <>
            <Field label="Your name" autoFocus autoComplete="name" value={f.name} onChange={set('name')} />
            <Field label="Work email" type="email" autoComplete="email" value={f.email} onChange={set('email')} />
            <Field label="Company or team name (optional)" autoComplete="organization" value={f.company} onChange={set('company')} />
            <Field
              label="Password (at least 8 characters)"
              type="password"
              autoComplete="new-password"
              value={f.pass}
              onChange={set('pass')}
            />
            <Consent checked={accept} onChange={setAccept} />
          </>,
          'Create owner account',
        )}
      </Card>
    );
  } else if (mode === 'signup') {
    const sm = S.auth?.signupMode || 'closed';
    if (sm === 'closed')
      body = (
        <Card
          title="Sign-up is by invitation"
          sub="Accounts on this TicketForge are created by invitation. Ask your administrator to invite you."
          foot={<Link href="/login">Go to sign in</Link>}
        />
      );
    else if (sent)
      body = (
        <Card title="Thanks, we’ve got your request" foot={<Link href="/">Back to the home page</Link>}>
          <div className="auth-ok">
            <Ico svg={I.check} />
            <div>
              We’ll email <b>{f.email || 'you'}</b> an invitation as soon as your workspace is ready.
            </div>
          </div>
        </Card>
      );
    else if (sm === 'open')
      body = (
        <Card
          title="Create your workspace"
          sub="Your company’s own space in TicketForge: your projects, people and AI settings, kept apart from everyone else’s."
          foot={
            <>
              <span className="muted">Already have an account?</span>
              <Link href="/login">Sign in</Link>
            </>
          }
        >
          {form(
            <>
              <Field label="Your name" autoFocus autoComplete="name" value={f.name} onChange={set('name')} />
              <Field label="Work email" type="email" autoComplete="email" value={f.email} onChange={set('email')} />
              <Field label="Company or team name" autoComplete="organization" value={f.company} onChange={set('company')} />
              <Field
                label="Password (at least 8 characters)"
                type="password"
                autoComplete="new-password"
                value={f.pass}
                onChange={set('pass')}
              />
              <input
                className="hp-field"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                name="website"
                value={f.website}
                onChange={set('website')}
              />
              <Consent checked={accept} onChange={setAccept} />
            </>,
            'Create workspace',
          )}
        </Card>
      );
    else
      body = (
        <Card
          title="Request access to TicketForge"
          sub="Tell us who you are and we’ll send you an invitation to create your account."
          foot={
            <>
              <span className="muted">Already have an account?</span>
              <Link href="/login">Sign in</Link>
            </>
          }
        >
          {form(
            <>
              <Field label="Your name" autoFocus autoComplete="name" value={f.name} onChange={set('name')} />
              <Field label="Work email" type="email" autoComplete="email" value={f.email} onChange={set('email')} />
              <Field label="Company (optional)" autoComplete="organization" value={f.company} onChange={set('company')} />
              <Field label="What will you use it for? (optional)" value={f.note} onChange={set('note')} />
              <input
                className="hp-field"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                name="website"
                value={f.website}
                onChange={set('website')}
              />
              <Consent checked={accept} onChange={setAccept} />
            </>,
            'Request access',
          )}
        </Card>
      );
  } else if (mode === 'forgot') {
    body = (
      <Card
        title="Forgot your password?"
        sub="Enter your email and we’ll send you a link to reset it."
        foot={<Link href="/login">Back to sign in</Link>}
      >
        {sent ? (
          <div className="auth-ok">
            <Ico svg={I.check} />
            <div>
              If an account exists for that email, a reset link is on its way.
              {!sent.emailConfigured && (
                <>
                  <br />
                  <span className="muted small">
                    Email isn’t set up on this server yet — ask an administrator to send you a reset link from Administration → Users.
                  </span>
                </>
              )}
            </div>
          </div>
        ) : (
          form(
            <Field label="Email" type="email" autoFocus autoComplete="email" value={f.email} onChange={set('email')} />,
            'Send reset link',
          )
        )}
      </Card>
    );
  } else if (mode === 'reset') {
    body = (
      <Card title="Choose a new password" foot={<Link href="/login">Back to sign in</Link>}>
        {form(
          <>
            <Field
              label="New password (at least 8 characters)"
              type="password"
              autoFocus
              autoComplete="new-password"
              value={f.pass}
              onChange={set('pass')}
            />
            <Field label="Confirm new password" type="password" autoComplete="new-password" value={f.pass2} onChange={set('pass2')} />
          </>,
          'Save password and sign in',
        )}
      </Card>
    );
  } else if (mode === 'invite') {
    if (!invite)
      body = (
        <Card title="Checking your invite…">
          <Loading label="Checking your invite…">
            <Sk w="80%" h={10} style={{ margin: '0 auto 24px' }} />
            {[48, 140].map((x) => (
              <div key={x} className="sk-field">
                <Sk w={x} h={10} style={{ marginBottom: 8 }} />
                <Sk h={40} />
              </div>
            ))}
            <Sk h={36} />
          </Loading>
        </Card>
      );
    else if (invite.error) body = <Card title="Invite unavailable" sub={invite.error} foot={<Link href="/login">Go to sign in</Link>} />;
    else
      body = (
        <Card
          title={invite.workspace ? `Join ${invite.workspace} on TicketForge` : 'Join your team on TicketForge'}
          sub={
            <>
              <b>{invite.inviter}</b> invited <b>{invite.email}</b> as <b>{invite.role}</b>.
            </>
          }
        >
          {form(
            <>
              {invite.message && <blockquote className="auth-quote">{invite.message}</blockquote>}
              {invite.existingAccount ? (
                <>
                  <p className="muted small" style={{ marginTop: 0 }}>
                    You already have a TicketForge account. Enter your password to add this workspace to it.
                  </p>
                  <Field
                    label="Your password"
                    type="password"
                    autoFocus
                    autoComplete="current-password"
                    value={f.pass}
                    onChange={set('pass')}
                  />
                </>
              ) : (
                <>
                  <Field label="Your name" autoFocus autoComplete="name" value={f.name} onChange={set('name')} />
                  <Field
                    label="Create a password (at least 8 characters)"
                    type="password"
                    autoComplete="new-password"
                    value={f.pass}
                    onChange={set('pass')}
                  />
                </>
              )}
              <Consent checked={accept} onChange={setAccept} />
            </>,
            invite.existingAccount ? 'Join workspace' : 'Accept invite',
          )}
        </Card>
      );
  } else {
    body = (
      <Card
        title="Sign in"
        sub="Sign in to continue to TicketForge."
        foot={
          <>
            <Link href="/forgot">Forgot password?</Link>
            <span className="muted">·</span>
            {S.auth?.signupMode && S.auth.signupMode !== 'closed' ? (
              <>
                <span className="muted">New here?</span>
                <Link href="/signup">{S.auth.signupMode === 'open' ? 'Create a workspace' : 'Request access'}</Link>
              </>
            ) : (
              <span className="muted">New here? Ask an administrator for an invite.</span>
            )}
          </>
        }
      >
        {form(
          <>
            <Field label="Email" type="email" autoFocus autoComplete="username" value={f.email} onChange={set('email')} />
            <Field label="Password" type="password" autoComplete="current-password" value={f.pass} onChange={set('pass')} />
          </>,
          'Sign in',
        )}
      </Card>
    );
  }
  return (
    <main id="app">
      {body}
      <Toasts />
    </main>
  );
}
