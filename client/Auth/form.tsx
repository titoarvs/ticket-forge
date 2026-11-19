'use client';
// Parts every sign-in form shares: the form with its button and error line, the common fields,
// and the hidden field that catches bots.
import type { ReactNode } from 'react';
import { Field, Consent } from './Consent';
import type { Auth } from './use-auth';

export function AuthForm({
  a,
  button,
  children,
}: {
  a: Auth;
  button: string;
  children: ReactNode;
}) {
  return (
    <form onSubmit={a.submit} noValidate>
      {children}
      <button className="btn primary wide" type="submit" disabled={a.busy}>
        {button}
      </button>
      <div className="auth-err" role="alert">
        {a.err}
      </div>
    </form>
  );
}

export function NameField({ a, autoFocus = true }: { a: Auth; autoFocus?: boolean }) {
  return (
    <Field
      label="Your name"
      autoFocus={autoFocus}
      autoComplete="name"
      value={a.f.name}
      onChange={a.set('name')}
    />
  );
}

export function EmailField({
  a,
  label = 'Work email',
  autoFocus = false,
  autoComplete = 'email',
}: {
  a: Auth;
  label?: string;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  return (
    <Field
      label={label}
      type="email"
      autoFocus={autoFocus}
      autoComplete={autoComplete}
      value={a.f.email}
      onChange={a.set('email')}
    />
  );
}

export function CompanyField({ a, label }: { a: Auth; label: string }) {
  return (
    <Field
      label={label}
      autoComplete="organization"
      value={a.f.company}
      onChange={a.set('company')}
    />
  );
}

/** A new password, at least 8 characters. */
export function NewPasswordField({
  a,
  label = 'Password (at least 8 characters)',
  autoFocus = false,
}: {
  a: Auth;
  label?: string;
  autoFocus?: boolean;
}) {
  return (
    <Field
      label={label}
      type="password"
      autoFocus={autoFocus}
      autoComplete="new-password"
      value={a.f.pass}
      onChange={a.set('pass')}
    />
  );
}

/** Hidden from people (and screen readers); bots that fill it in are turned away. */
export function HoneyPot({ a }: { a: Auth }) {
  return (
    <input
      className="hp-field"
      tabIndex={-1}
      autoComplete="off"
      aria-hidden="true"
      name="website"
      value={a.f.website}
      onChange={a.set('website')}
    />
  );
}

export function ConsentBox({ a }: { a: Auth }) {
  return <Consent checked={a.accept} onChange={a.setAccept} />;
}
