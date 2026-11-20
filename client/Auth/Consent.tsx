'use client';
import type { ReactNode } from 'react';
import { I } from '../ui';
import { Footer } from '../Footer';
import { TF } from '../fields';

export type Mode = 'setup' | 'login' | 'signup' | 'forgot' | 'reset' | 'invite';
export function Card({
  title,
  sub,
  children,
  foot,
}: {
  title: string;
  sub?: ReactNode;
  children?: ReactNode;
  foot?: ReactNode;
}) {
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
/**
 * The unticked box people must tick to accept the Terms of Use and Privacy Policy (links open in a
 * new tab).
 */
export function Consent({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="consent">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required
        data-testid="accept-terms"
      />
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
export function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span>{label}</span>
      <TF {...props} />
    </label>
  );
}
