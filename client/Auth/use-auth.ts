'use client';
// The sign-in screens' state: starting the session, sending people where they belong (setup, or
// already signed in), the invite being accepted, and the form with its answer.
import { useState, useEffect, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type Any, S, api, toast } from '../core';
import { bootSession } from '../AppShell';
import type { Mode } from './Consent';
import { type AuthFields, EMPTY_FIELDS, NEEDS_CONSENT, sendAuth } from './requests';

/** Before setup, every screen goes to /setup; after it, /setup goes to sign-in; signed in, to the app. */
function useRedirects(mode: Mode) {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    if (!S.ready) bootSession();
  }, []);
  useEffect(() => {
    if (!S.ready || S.bootError) return;
    if (S.auth?.setupRequired && mode !== 'setup') router.replace('/setup');
    else if (!S.auth?.setupRequired && mode === 'setup') router.replace('/login');
    else if (S.user && (mode === 'login' || mode === 'signup'))
      router.replace(params.get('next') || '/projects');
  }, [S.ready, mode]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The invite behind an /invite/<token> link, or { error }. */
function useInvite(mode: Mode, token?: string) {
  const [invite, setInvite] = useState<Any>(null);
  useEffect(() => {
    if (mode !== 'invite' || !token) return;
    api(`/api/invites/${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch((e) => setInvite({ error: e.message }));
  }, [mode, token]);
  return invite;
}

export function useAuth(mode: Mode, token?: string) {
  const router = useRouter();
  const params = useSearchParams();
  const [f, setF] = useState<AuthFields>(EMPTY_FIELDS);
  const [accept, setAccept] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Any>(null);
  useRedirects(mode);
  const invite = useInvite(mode, token);

  /** Signed in: start the session and go to the projects (or back where sign-in was asked for). */
  const signedIn = async (user: Any) => {
    S.user = user;
    await bootSession();
    toast(`Welcome, ${user.name}`);
    router.replace(mode === 'login' ? params.get('next') || '/projects' : '/projects');
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (NEEDS_CONSENT.includes(mode) && !accept)
        throw new Error('Please tick the box to accept the Terms of Use and Privacy Policy.');
      const res = await sendAuth(mode, { f, accept, token, plan: params.get('plan') });
      if (res?.user) await signedIn(res.user);
      else if (mode === 'signup' || mode === 'forgot') setSent(res);
    } catch (e2: Any) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };
  return {
    f,
    /** A change handler for one field. */
    set: (k: keyof AuthFields) => (e: Any) => setF({ ...f, [k]: e.target.value }),
    accept,
    setAccept,
    err,
    busy,
    sent,
    invite,
    submit,
  };
}
export type Auth = ReturnType<typeof useAuth>;
