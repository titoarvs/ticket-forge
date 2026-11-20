'use client';

// Sign-in screens: first-run setup, login, sign-up (request access), forgot/reset password, accept
// invite. This component shows the screen for the mode; the screens are in client/Auth/.

import type { ReactNode } from 'react';
import { useStore, S } from './core';
import { Toasts } from './ui';
import { ServerDown } from './AppShell';
import { AuthSkeleton } from './skeletons';
import type { Mode } from './Auth/Consent';
import { type Auth, useAuth } from './Auth/use-auth';
import { SetupScreen, LoginScreen, ForgotScreen, ResetScreen } from './Auth/screens';
import { SignupScreen } from './Auth/signup';
import { InviteScreen } from './Auth/invite';

const SCREENS: Record<Mode, (p: { a: Auth }) => ReactNode> = {
  setup: SetupScreen,
  login: LoginScreen,
  signup: SignupScreen,
  forgot: ForgotScreen,
  reset: ResetScreen,
  invite: InviteScreen,
};

function Page({ children }: { children: ReactNode }) {
  return (
    <main id="app">
      {children}
      <Toasts />
    </main>
  );
}

export default function AuthPage({ mode, token }: { mode: Mode; token?: string }) {
  useStore();
  const a = useAuth(mode, token);
  if (S.bootError)
    return (
      <Page>
        <div className="auth-wrap">
          <div style={{ width: 'min(460px, 100%)' }}>
            <ServerDown />
          </div>
        </div>
      </Page>
    );
  if (!S.ready)
    return (
      <Page>
        <AuthSkeleton />
      </Page>
    );
  const Screen = SCREENS[mode] || LoginScreen;
  return (
    <Page>
      <Screen a={a} />
    </Page>
  );
}
