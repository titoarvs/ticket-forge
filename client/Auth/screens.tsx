'use client';
// First-run setup, sign in, and forgot / reset password.
import Link from 'next/link';
import { S } from '../core';
import { Ico, I } from '../ui';
import { Card, Field } from './Consent';
import type { Auth } from './use-auth';
import {
  AuthForm,
  NameField,
  EmailField,
  CompanyField,
  NewPasswordField,
  ConsentBox,
} from './form';

export function SetupScreen({ a }: { a: Auth }) {
  return (
    <Card
      title="Set up TicketForge"
      sub="Create the owner account. The owner has full access and can invite your team."
      foot={
        <>
          <Ico svg={I.settings} /> Database: {S.auth?.database}
        </>
      }
    >
      <AuthForm a={a} button="Create owner account">
        <NameField a={a} />
        <EmailField a={a} />
        <CompanyField a={a} label="Company or team name (optional)" />
        <NewPasswordField a={a} />
        <ConsentBox a={a} />
      </AuthForm>
    </Card>
  );
}

/** Forgot password, sign-up and request access when they're allowed; otherwise ask for an invite. */
function LoginFoot() {
  const mode = S.auth?.signupMode;
  return (
    <>
      <Link href="/forgot">Forgot password?</Link>
      <span className="muted">·</span>
      {mode && mode !== 'closed' ? (
        <>
          <span className="muted">New here?</span>
          <Link href="/signup">{mode === 'open' ? 'Create a workspace' : 'Request access'}</Link>
        </>
      ) : (
        <span className="muted">New here? Ask an administrator for an invite.</span>
      )}
    </>
  );
}

export function LoginScreen({ a }: { a: Auth }) {
  return (
    <Card title="Sign in" sub="Sign in to continue to TicketForge." foot={<LoginFoot />}>
      <AuthForm a={a} button="Sign in">
        <EmailField a={a} label="Email" autoFocus autoComplete="username" />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={a.f.pass}
          onChange={a.set('pass')}
        />
      </AuthForm>
    </Card>
  );
}

/** Once sent, the same message whether or not the account exists (nothing is given away). */
function ResetSent({ emailConfigured }: { emailConfigured: boolean }) {
  return (
    <div className="auth-ok">
      <Ico svg={I.check} />
      <div>
        If an account exists for that email, a reset link is on its way.
        {!emailConfigured && (
          <>
            <br />
            <span className="muted small">
              Email isn’t set up on this server yet — ask an administrator to send you a reset link
              from Administration → Users.
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function ForgotScreen({ a }: { a: Auth }) {
  return (
    <Card
      title="Forgot your password?"
      sub="Enter your email and we’ll send you a link to reset it."
      foot={<Link href="/login">Back to sign in</Link>}
    >
      {a.sent ? (
        <ResetSent emailConfigured={a.sent.emailConfigured} />
      ) : (
        <AuthForm a={a} button="Send reset link">
          <EmailField a={a} label="Email" autoFocus />
        </AuthForm>
      )}
    </Card>
  );
}

export function ResetScreen({ a }: { a: Auth }) {
  return (
    <Card title="Choose a new password" foot={<Link href="/login">Back to sign in</Link>}>
      <AuthForm a={a} button="Save password and sign in">
        <NewPasswordField a={a} label="New password (at least 8 characters)" autoFocus />
        <Field
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={a.f.pass2}
          onChange={a.set('pass2')}
        />
      </AuthForm>
    </Card>
  );
}
