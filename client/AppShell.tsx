'use client';

// Signed-in shell: loads the session, renders the sidebar and top bar, dialogs and notifications.

import { type ReactNode, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  useStore,
  S,
  P,
  redo,
  undo,
  saveNow,
  can,
  toast,
  emit,
  toggleSidebar,
  loadNotifs,
  loadFlags,
  type Any,
} from './core';
import { Toasts, TaskTray } from './ui';
import { AppSkeleton } from './skeletons';
import { openCreateIssue } from './actions';
import { TourHost } from './tour';
import { showUpgrade, LockedScreen } from './Billing';
import { Assistant } from './Assistant/Assistant';
import { planLimitHandler } from './core';
import { bootSession, setLocalEngine, refreshStatus } from './AppShell/set-local-engine';
import { ServerDown, LegalPrompt, RunPill } from './AppShell/ServerDown';
import { TopNav } from './AppShell/TopNav';
import { AppSidebar } from './AppShell/AppSidebar';

export {
  bootSession,
  refreshStatus,
  aiInactive,
  setLocalEngine,
} from './AppShell/set-local-engine';
export { ProjectSwitcher } from './AppShell/ProjectSwitcher';
export { TopNav } from './AppShell/TopNav';
export { ServerDown } from './AppShell/ServerDown';

export default function AppShell({ children }: { children: ReactNode }) {
  useStore();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    S.nav = (h: string) => router.push(h);
  }, [router]);
  useEffect(() => {
    planLimitHandler.fn = showUpgrade;
    return () => {
      planLimitHandler.fn = null;
    };
  }, []);
  useEffect(() => {
    // Links from the previous version used hash routes (/#/invite/…, /#/reset/…, /#/p/…).
    const legacy = location.hash.match(/^#(\/(?:invite|reset|p|admin|new)\b.*)$/);
    if (legacy) {
      router.replace(legacy[1]);
      return;
    }
    if (!S.ready) bootSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!S.ready || S.bootError) return;
    if (S.auth?.setupRequired) router.replace('/setup');
    else if (!S.user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [S.ready, S.user, pathname, router]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement).closest?.(
        'input,textarea,select,[contenteditable],[role=combobox],[role=listbox]',
      );
      if (S.modal) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !inField && P()) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && P()) {
        e.preventDefault();
        saveNow();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        const f = document.getElementById('tn-search');
        if (f) {
          e.preventDefault();
          f.focus();
        }
        return;
      }
      // ⌥⇧A (Alt+Shift+A): switch the local AI between your Claude account and GitHub Copilot.
      if (e.altKey && e.shiftKey && e.code === 'KeyA' && S.status?.copilot && can('users.manage')) {
        e.preventDefault();
        const to = S.status.localEngine === 'copilot' ? 'claude' : 'copilot';
        if (to === 'copilot' && !S.status.copilot.available)
          toast('Install the GitHub Copilot CLI first (Administration → AI → Local AI).', 'warn');
        else setLocalEngine(to);
        return;
      }
      if (e.key === 'Escape') {
        if (S.pop) {
          S.pop = null;
          emit();
          return;
        }
        if (S.menu) {
          S.menu = null;
          emit();
          return;
        }
        if (S.full) {
          S.full = false;
          emit();
          return;
        }
        if (S.drawer && !inField) {
          S.drawer = null;
          emit();
        }
        return;
      }
      const plain = !inField && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (plain && e.key === '[') {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (plain && P() && location.pathname.startsWith('/p/')) {
        if (e.key === 'c') {
          e.preventDefault();
          openCreateIssue();
        }
        if (e.key === '/') {
          const f = document.getElementById('fq') || document.getElementById('tq');
          if (f) {
            e.preventDefault();
            f.focus();
          }
        }
      }
    };
    const onUnload = () => {
      if (P() && S.saveTimer) saveNow();
    };
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') loadNotifs();
    }, 30000);
    // Keep the AI pill current (e.g. when TicketForge switches to a backup provider).
    const statusPoll = setInterval(() => {
      if (document.visibilityState === 'visible' && S.user) {
        refreshStatus();
        loadFlags();
      }
    }, 60000);
    // Coming back to the tab: refresh what may be stale (status at most every 20 s).
    const onFocus = () => {
      loadNotifs();
      if (S.user && Date.now() - (S.statusAt || 0) > 20000) refreshStatus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('focus', onFocus);
      clearInterval(poll);
      clearInterval(statusPoll);
    };
  }, []);

  if (S.bootError)
    return (
      <main id="app">
        <div className="page">
          <ServerDown />
        </div>
        <Toasts />
      </main>
    );
  if (!S.ready || !S.user) return <AppSkeleton />;
  return (
    <TourHost>
      <div className="app-frame">
        <AppSidebar />
        <div className="app-col">
          <TopNav />
          {/* A trial that ended without a payment: the pay prompt replaces the app (checkout stays reachable so it can be paid). */}
          <main id="app">
            {S.auth?.billing?.locked && !pathname.startsWith('/checkout') ? (
              <LockedScreen />
            ) : (
              children
            )}
          </main>
        </div>
      </div>
      {S.modal as Any}
      <LegalPrompt />
      <Toasts />
      <TaskTray />
      <RunPill />
      <Assistant />
    </TourHost>
  );
}
