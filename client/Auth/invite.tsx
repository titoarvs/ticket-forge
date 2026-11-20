'use client';
// Accepting an invite: create an account, or (already have one) add the workspace to it.
import Link from 'next/link';
import type { Any } from '../core';
import { Loading, Sk } from '../ui';
import { Card, Field } from './Consent';
import type { Auth } from './use-auth';
import { AuthForm, NameField, NewPasswordField, ConsentBox } from './form';

function CheckingInvite() {
  return (
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
}

function ExistingAccount({ a }: { a: Auth }) {
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>
        You already have a TicketForge account. Enter your password to add this workspace to it.
      </p>
      <Field
        label="Your password"
        type="password"
        autoFocus
        autoComplete="current-password"
        value={a.f.pass}
        onChange={a.set('pass')}
      />
    </>
  );
}

function AcceptInvite({ a, invite }: { a: Auth; invite: Any }) {
  const title = invite.workspace
    ? `Join ${invite.workspace} on TicketForge`
    : 'Join your team on TicketForge';
  return (
    <Card
      title={title}
      sub={
        <>
          <b>{invite.inviter}</b> invited <b>{invite.email}</b> as <b>{invite.role}</b>.
        </>
      }
    >
      <AuthForm a={a} button={invite.existingAccount ? 'Join workspace' : 'Accept invite'}>
        {invite.message && <blockquote className="auth-quote">{invite.message}</blockquote>}
        {invite.existingAccount ? (
          <ExistingAccount a={a} />
        ) : (
          <>
            <NameField a={a} />
            <NewPasswordField a={a} label="Create a password (at least 8 characters)" />
          </>
        )}
        <ConsentBox a={a} />
      </AuthForm>
    </Card>
  );
}

export function InviteScreen({ a }: { a: Auth }) {
  const invite = a.invite;
  if (!invite) return <CheckingInvite />;
  if (invite.error)
    return (
      <Card
        title="Invite unavailable"
        sub={invite.error}
        foot={<Link href="/login">Go to sign in</Link>}
      />
    );
  return <AcceptInvite a={a} invite={invite} />;
}
