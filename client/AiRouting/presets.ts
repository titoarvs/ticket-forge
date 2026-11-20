'use client';
import type { Any } from '../core';

export const TIER_LABEL: Record<string, string> = {
  high: 'High',
  standard: 'Standard',
  light: 'Light',
};
export const TIER_HINT: Record<string, string> = {
  high: 'Best quality, most usage',
  standard: 'Good quality, moderate usage',
  light: 'Fast and cheap',
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
/** One-click starting points. */
export const PRESETS: {
  key: string;
  label: string;
  desc: string;
  tiers: (t: Any) => string;
  escalate?: boolean;
}[] = [
  {
    key: 'quality',
    label: 'Best quality',
    desc: 'Every task on the High tier. Uses the most.',
    tiers: () => 'high',
  },
  {
    key: 'balanced',
    label: 'Balanced',
    desc: 'The defaults: High for tickets, documents and scripts; lighter models for routine work.',
    tiers: (t) => t.tier,
  },
  {
    key: 'smart',
    label: 'Smart savings',
    desc: 'Documents and scripts on Standard; tickets and tests try Standard first and step up to High only when needed; coding and review stay High.',
    tiers: (t) => (['automation'].includes(t.id) ? 'standard' : t.tier),
    escalate: true,
  },
  {
    key: 'economy',
    label: 'Economy',
    desc: 'Light for most work; Standard for tickets, documents, scripts and coding agents.',
    tiers: (t) =>
      ['tickets', 'docs', 'automation', 'code', 'agent-tests', 'review'].includes(t.id)
        ? 'standard'
        : 'light',
  },
];
export type Part = 'routing' | 'models' | 'usage' | 'savings';
