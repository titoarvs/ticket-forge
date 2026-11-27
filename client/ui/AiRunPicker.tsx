'use client';
import { I } from '../icons';
import { S, type Any, setAiRun } from '../core';
import ListSubheader from '@mui/material/ListSubheader';
import { SF, MenuItem } from '../fields';
import { Ico } from './Modal';

/**
 * Which AI runs this action: Auto (model routing picks per task), a tier (High / Standard / Light,
 * with the model it runs on here) or a custom configuration from Administration → AI. The choice is
 * the person's, remembered per browser.
 */
export const TIER_NAME: Record<string, string> = {
  high: 'High',
  standard: 'Standard',
  light: 'Light',
};
export function AiRunPicker({ compact = false }: { compact?: boolean }) {
  const ch = S.status?.aiChoices;
  const v = S.aiRun || 'auto';
  const known =
    v === 'auto' || TIER_NAME[v] || (ch?.configs || []).some((c: Any) => `cfg:${c.id}` === v);
  const val = known ? v : 'auto';
  const label = (k: string) => {
    if (k === 'auto')
      return S.status?.routingOn
        ? 'Auto · per task'
        : `Auto${S.status?.model ? ` · ${S.status.model}` : ''}`;
    if (TIER_NAME[k]) return `${TIER_NAME[k]}${ch?.tiers?.[k] ? ` · ${ch.tiers[k]}` : ''}`;
    const c = (ch?.configs || []).find((x: Any) => `cfg:${x.id}` === k);
    return c ? `${c.name}${c.model ? ` · ${c.model}` : ''}` : k;
  };
  return (
    <div
      className={`ai-run ${compact ? 'compact' : ''} ${val !== 'auto' ? 'set' : ''}`}
      title="Which AI runs this. Auto follows Administration → AI → Model routing."
    >
      <Ico svg={I.sparkle} />
      <span className="ai-run-l">Runs on</span>
      <SF
        bare
        className="ai-run-sel"
        searchable={false}
        value={val}
        onChange={(e: Any) => setAiRun(e.target.value)}
        aria-label="Which AI runs this"
      >
        <MenuItem value="auto">{label('auto')}</MenuItem>
        <ListSubheader>Model tier</ListSubheader>
        {Object.keys(TIER_NAME).map((k) => (
          <MenuItem key={k} value={k}>
            {label(k)}
          </MenuItem>
        ))}
        {(ch?.configs || []).length > 0 && <ListSubheader>Custom configurations</ListSubheader>}
        {(ch?.configs || []).map((c: Any) => (
          <MenuItem key={c.id} value={`cfg:${c.id}`}>
            {label(`cfg:${c.id}`)}
          </MenuItem>
        ))}
      </SF>
    </div>
  );
}
/** "4:00 PM" today, "Thu 9:00 AM" this week, else "Nov 20, 9:00 AM". */
export function resetLabel(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso),
    now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Resets at ${time}`;
  if (d.getTime() - now.getTime() < 6 * 86400e3)
    return `Resets ${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return `Resets ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}
const PLAN_ROWS: [string, string][] = [
  ['fiveHour', '5-hour limit'],
  ['weekly', 'Weekly · all models'],
  ['weeklyOpus', 'Weekly · Opus'],
  ['weeklySonnet', 'Weekly · Sonnet'],
];
/** The highest of your Claude plan limits, for badges: { label, pct } or null. */
export function planPeak(u: Any) {
  if (!u) return null;
  const rows = PLAN_ROWS.filter(([k]) => u[k]).map(([k, l]) => ({
    key: k,
    label: k === 'fiveHour' ? '5-hour' : 'Weekly',
    name: l,
    ...u[k],
  }));
  return rows.sort((a, b) => b.pct - a.pct)[0] || null;
}
/**
 * Your Claude plan's usage limits as bars (5-hour, weekly), like Claude's own "Plan usage limits".
 */
export function PlanLimits({ u, compact = false }: { u: Any; compact?: boolean }) {
  if (!u) return null;
  const rows = PLAN_ROWS.filter(
    ([k]) => u[k] && (k === 'fiveHour' || k === 'weekly' || u[k].pct > 0),
  );
  return (
    <div className={`plan-limits ${compact ? 'compact' : ''}`}>
      {rows.map(([k, label]) => {
        const x = u[k];
        const tone = x.pct >= 95 ? 'bad' : x.pct >= 80 ? 'warn' : 'ok';
        return (
          <div key={k} className={`pl-row t-${tone}`}>
            <div className="pl-top">
              <span className="pl-name">{label}</span>
              <span className="pl-meta">
                {resetLabel(x.resetsAt)}
                <b>{Math.round(x.pct)}%</b>
              </span>
            </div>
            <div
              className="pl-bar"
              role="progressbar"
              aria-label={label}
              aria-valuenow={Math.round(x.pct)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i style={{ width: `${Math.max(1, Math.min(100, x.pct))}%` }} />
            </div>
          </div>
        );
      })}
      {u.error && (
        <p className="muted small pl-err">
          {rows.length ? 'Last known numbers. ' : ''}
          {u.error}
        </p>
      )}
    </div>
  );
}
