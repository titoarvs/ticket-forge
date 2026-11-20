'use client';
// Sign-up, as this TicketForge allows it: closed (by invitation), open (create a workspace) or by
// request (we send an invitation).
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
  HoneyPot,
  ConsentBox,
} from './form';

const SignInFoot = (
  <>
    <span className="muted">Already have an account?</span>
    <Link href="/login">Sign in</Link>
  </>
);

function RequestSent({ email }: { email: string }) {
  return (
    <Card title="Thanks, we’ve got your request" foot={<Link href="/">Back to the home page</Link>}>
      <div className="auth-ok">
        <Ico svg={I.check} />
        <div>
          We’ll email <b>{email || 'you'}</b> an invitation as soon as your workspace is ready.
        </div>
      </div>
    </Card>
  );
}

function CreateWorkspace({ a }: { a: Auth }) {
  return (
    <Card
      title="Create your workspace"
      sub="Your company’s own space in TicketForge: your projects, people and AI settings, kept apart from everyone else’s."
      foot={SignInFoot}
    >
      <AuthForm a={a} button="Create workspace">
        <NameField a={a} />
        <EmailField a={a} />
        <CompanyField a={a} label="Company or team name" />
        <NewPasswordField a={a} />
        <HoneyPot a={a} />
        <ConsentBox a={a} />
      </AuthForm>
    </Card>
  );
}

function RequestAccess({ a }: { a: Auth }) {
  return (
    <Card
      title="Request access to TicketForge"
      sub="Tell us who you are and we’ll send you an invitation to create your account."
      foot={SignInFoot}
    >
      <AuthForm a={a} button="Request access">
        <NameField a={a} />
        <EmailField a={a} />
        <CompanyField a={a} label="Company (optional)" />
        <Field
          label="What will you use it for? (optional)"
          value={a.f.note}
          onChange={a.set('note')}
        />
        <HoneyPot a={a} />
        <ConsentBox a={a} />
      </AuthForm>
    </Card>
  );
}

export function SignupScreen({ a }: { a: Auth }) {
  const mode = S.auth?.signupMode || 'closed';
  if (mode === 'closed')
    return (
      <Card
        title="Sign-up is by invitation"
        sub="Accounts on this TicketForge are created by invitation. Ask your administrator to invite you."
        foot={<Link href="/login">Go to sign in</Link>}
      />
    );
  if (a.sent) return <RequestSent email={a.f.email} />;
  return mode === 'open' ? <CreateWorkspace a={a} /> : <RequestAccess a={a} />;
}
