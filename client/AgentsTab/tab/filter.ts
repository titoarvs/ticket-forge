// Which agents the filters show, and the counts at the top of the page.
import type { Any } from '../../core';

export type AgentFilter = { phase: string; team: string; state: string; q: string };

export const NO_FILTER: AgentFilter = { phase: 'All', team: '', state: '', q: '' };

/** The "Show" filter: turned on / off, custom, or the kind of agent (code, document, testing). */
function stateMatches(a: Any, state: string) {
  if (!state) return true;
  if (state === 'on') return a.enabled;
  if (state === 'off') return !a.enabled;
  if (state === 'custom') return a.custom;
  return a.runner === state;
}

function textMatches(a: Any, q: string) {
  const qq = q.trim().toLowerCase();
  if (!qq) return true;
  const text = `${a.name} ${a.summary} ${a.step || ''} ${a.team || ''} ${a.workspaceLabel || ''}`;
  return text.toLowerCase().includes(qq);
}

export const agentMatches = (a: Any, f: AgentFilter) =>
  (f.phase === 'All' || a.phase === f.phase) &&
  (!f.team || a.team === f.team) &&
  stateMatches(a, f.state) &&
  textMatches(a, f.q);

export const isFiltering = (f: AgentFilter) =>
  Boolean(f.phase !== 'All' || f.team || f.state || f.q.trim());

/** [label, count, tone] for each tile. */
export function statsOf(all: Any[]): [string, number, string][] {
  const count = (fn: (a: Any) => unknown) => all.filter(fn).length;
  return [
    ['Agents', all.length, ''],
    ['On', count((a) => a.enabled), 'ok'],
    ['Off', count((a) => !a.enabled), ''],
    ['Code agents', count((a) => a.runner === 'code' || a.runner === 'panel'), ''],
    ['Custom', count((a) => a.custom), ''],
  ];
}
