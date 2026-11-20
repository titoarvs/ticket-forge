'use client';
// What each sign-in screen sends to the server.
import { type Any, api } from '../core';
import type { Mode } from './Consent';

export type AuthFields = {
  name: string;
  email: string;
  pass: string;
  pass2: string;
  company: string;
  note: string;
  /** A hidden field people never fill in: bots that do are turned away. */
  website: string;
};
export const EMPTY_FIELDS: AuthFields = {
  name: '',
  email: '',
  pass: '',
  pass2: '',
  company: '',
  note: '',
  website: '',
};

/** Screens where the person creates an account and so accepts the Terms and Privacy Policy. */
export const NEEDS_CONSENT: Mode[] = ['setup', 'invite', 'signup'];

const post = (url: string, body: Any) => api(url, { method: 'POST', body });

/** The note sent with a sign-up, mentioning the plan the person came from (?plan=…). */
function signupNote(f: AuthFields, plan: string | null) {
  const interest = plan && /^[a-z]{2,12}$/.test(plan) ? `Interested in the ${plan} plan.` : '';
  return [f.note.trim(), interest].filter(Boolean).join('\n');
}

type Ctx = { f: AuthFields; accept: boolean; token?: string; plan: string | null };

/**
 * Sends the screen's form. The answer has `user` when the person is now signed in; otherwise
 * (sign-up request, forgot password) it is shown as "sent".
 */
export function sendAuth(mode: Mode, { f, accept, token, plan }: Ctx): Promise<Any> {
  if (mode === 'setup')
    return post('/api/auth/setup', {
      name: f.name,
      email: f.email,
      password: f.pass,
      company: f.company,
      acceptTerms: accept,
    });
  if (mode === 'signup')
    return post('/api/auth/signup', {
      name: f.name,
      email: f.email,
      company: f.company,
      note: signupNote(f, plan),
      password: f.pass,
      website: f.website,
      acceptTerms: accept,
    });
  if (mode === 'forgot') return post('/api/auth/forgot', { email: f.email });
  if (mode === 'reset') {
    if (f.pass !== f.pass2) throw new Error('The passwords don’t match.');
    return post('/api/auth/reset', { token, password: f.pass });
  }
  if (mode === 'invite')
    return post(`/api/invites/${encodeURIComponent(token!)}/accept`, {
      name: f.name,
      password: f.pass,
      acceptTerms: accept,
    });
  return post('/api/auth/login', { email: f.email, password: f.pass });
}
