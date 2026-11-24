'use client';
// How the sidebar is shown on this screen, and whether the phone drawer is open.
import { useSyncExternalStore } from 'react';
import { store } from '../core';

/**
 * Sidebar layout for the screen width: phone (< 600px) drawer, tablet (600–1023px) icon rail,
 * desktop (1024px+) full.
 */
export type SideMode = 'phone' | 'rail' | 'full';
const PHONE_Q = '(max-width: 599px)',
  RAIL_Q = '(max-width: 1023px)';
const subscribeMode = (cb: () => void) => {
  const qs = [matchMedia(PHONE_Q), matchMedia(RAIL_Q)];
  qs.forEach((q) => q.addEventListener('change', cb));
  return () => qs.forEach((q) => q.removeEventListener('change', cb));
};
const modeNow = (): SideMode =>
  matchMedia(PHONE_Q).matches ? 'phone' : matchMedia(RAIL_Q).matches ? 'rail' : 'full';
export const useSideMode = () =>
  useSyncExternalStore(subscribeMode, modeNow, () => 'full' as SideMode);

/**
 * Whether the phone drawer is open is remembered in this browser; a missing or invalid saved value
 * means closed.
 */
const DRAWER_KEY = 'tf.sideDrawerOpen';
let open: boolean | null = null;
const subs = new Set<() => void>();
const readOpen = () => (open ??= store.get(DRAWER_KEY, false) === true);
export function setDrawerOpen(v: boolean) {
  open = v;
  store.set(DRAWER_KEY, v);
  subs.forEach((f) => f());
}
/** Whether the drawer is open (phones only). */
export function useDrawerOpen() {
  const on = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    readOpen,
    () => false,
  );
  return useSideMode() === 'phone' && on;
}
/** The button in the top bar that opens the drawer, so focus can go back to it. */
export const MENU_BTN_ID = 'side-menu-btn';
