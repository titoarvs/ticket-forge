'use client';
// The AI page's section list, with badges for what needs attention.
import type { Any } from '../../core';
import { I } from '../../ui';

export const AI_SECTIONS = [
  'flow',
  'connection',
  'routing',
  'models',
  'usage',
  'savings',
  'configs',
  'providers',
  'local',
];

/** Over budget, or near it (as a percentage). */
function budgetBadge(c: Any) {
  if (c.budget?.over) return <span className="loz t-fail">Budget</span>;
  if (c.budget?.near)
    return <span className="loz t-blocked">{Math.round(c.budget.pct * 100)}%</span>;
  return null;
}

export function aiNavItems(c: Any) {
  const configs = c.settings?.configs || [];
  const limited = (c.apis || []).some((x: Any) => x.cooldown);
  return [
    { key: 'flow', label: 'AI flow', hint: 'Connect providers like nodes', icon: I.grid },
    { key: 'connection', label: 'Connection', hint: 'Status, sign-in and test', icon: I.sparkle },
    {
      key: 'routing',
      label: 'Model routing',
      hint: 'Presets and the tier for each task',
      icon: I.chart,
      badge: c.routingOn ? null : <span className="loz">Off</span>,
    },
    {
      key: 'models',
      label: 'Models per tier',
      hint: 'High, Standard and Light on each AI',
      icon: I.bot,
    },
    {
      key: 'usage',
      label: 'Usage & suggestions',
      hint: 'Calls, tokens, cost and how to use less',
      icon: I.history,
    },
    {
      key: 'savings',
      label: 'Savings & limits',
      hint: 'Reused answers, budget and prices',
      icon: I.check,
      badge: budgetBadge(c),
    },
    {
      key: 'configs',
      label: 'Configurations',
      hint: 'Named AI setups for AI buttons',
      icon: I.settings,
      badge: configs.length ? <span className="count">{configs.length}</span> : null,
    },
    {
      key: 'providers',
      label: 'Providers',
      hint: 'AI APIs, in priority order',
      icon: I.grid,
      badge: limited ? <span className="loz t-blocked">Limited</span> : null,
    },
    {
      key: 'decisions',
      label: 'Decisions',
      hint: 'Fast choices with Jev (optional)',
      icon: I.flag,
    },
    ...(c.copilot
      ? [{ key: 'local', label: 'Local AI', hint: 'Claude Code or GitHub Copilot', icon: I.user }]
      : []),
  ];
}
