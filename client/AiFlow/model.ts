'use client';
import type { Any } from '../core';

export type FlowActions = {
  onSaved: (st: Any) => void;
  add: () => void;
  edit: (entry: Any) => void;
  remove: (entry: Any) => void;
  goto: (section: string) => void;
};
export type Pt = { x: number; y: number };
export type FNode = {
  id: string;
  kind: 'group' | 'tier' | 'config' | 'gateway' | 'provider' | 'local' | 'add';
  w: number;
  h: number;
  def: Pt;
  rows?: Any[];
  data?: Any;
};
// task group node
export const GW = 252,
  ROW = 30,
  HEAD = 40;
// tier node
export const TW = 214,
  TH = 112;
// configuration node
export const CW = 214,
  CH = 76;
// router node
export const RW = 176,
  RH = 96;
// provider node
export const PW = 256,
  PH = 108;
export const TIER: Record<string, { label: string; hint: string; color: string }> = {
  high: { label: 'High', hint: 'Best quality, most usage', color: '#8b5cf6' },
  standard: { label: 'Standard', hint: 'Good quality, moderate usage', color: '#2f7bf5' },
  light: { label: 'Light', hint: 'Fast and cheap', color: '#1f9d6b' },
};
export const GROUP_COLOR: Record<string, string> = {
  Planning: '#2f7bf5',
  Documents: '#e0526b',
  Testing: '#e2a400',
  Code: '#1f9d6b',
  Helpers: '#7c8aa0',
};
export const CLAUDE_OPTIONS = [
  'opus',
  'sonnet',
  'haiku',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'claude-fable-5-2',
];
export const LS = 'tf.aiflow.v1';
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const hue = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};
export type State = { k: 'ok' | 'idle' | 'warn' | 'bad' | 'off'; label: string; title?: string };
export function stateOf(x: Any): State {
  if (!x.enabled) return { k: 'off', label: 'Off' };
  if (!x.configured) return { k: 'bad', label: 'Incomplete', title: x.error || '' };
  if (x.cooldown)
    return {
      k: 'warn',
      label:
        x.cooldown.kind === 'credits'
          ? 'Out of credits'
          : x.cooldown.kind === 'auth'
            ? 'Key rejected'
            : 'Limited',
      title: x.cooldown.message,
    };
  if (x.active) return { k: 'ok', label: 'In use' };
  return { k: 'idle', label: 'Backup' };
}
