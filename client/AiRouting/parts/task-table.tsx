'use client';
// The table of AI tasks: what each covers, its tier (or a custom configuration), the model that
// means now, and how often it was used. Tasks are grouped under their group's name.
import type { Any } from '../../core';
import { SF, MenuItem } from '../../fields';
import { TIER_LABEL, TIER_HINT } from '../presets';
import type { RoutingDraft } from './use-routing-draft';

type RowProps = { t: Any; c: Any; d: RoutingDraft };

const isConfig = (v: Any) => String(v).startsWith('cfg:');

function TierPicker({ t, c, d }: RowProps) {
  const tiers: string[] = c.tiers || ['high', 'standard', 'light'];
  const configs: Any[] = c.settings?.configs || [];
  const cur = d.r.tiers[t.id];
  return (
    <>
      <div className="rt-tier" role="radiogroup" aria-label={`${t.label} tier`}>
        {tiers.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={cur === k}
            title={TIER_HINT[k]}
            disabled={d.off}
            className={`${cur === k ? 'on' : ''} t-${k}`}
            onClick={() => d.setTier(t.id, k)}
          >
            {TIER_LABEL[k]}
          </button>
        ))}
      </div>
      {configs.length > 0 && (
        <SF
          filter
          className="rt-cfg"
          aria-label={`${t.label}: custom configuration`}
          disabled={d.off}
          value={isConfig(cur) ? cur : ''}
          placeholder="or a configuration…"
          onChange={(e: Any) => d.setTier(t.id, e.target.value || t.tier)}
        >
          <MenuItem value="">or a configuration…</MenuItem>
          {configs.map((x: Any) => (
            <MenuItem key={x.id} value={`cfg:${x.id}`}>
              {x.name}
            </MenuItem>
          ))}
        </SF>
      )}
    </>
  );
}

/** The model the task's tier (or configuration) means now; "—" while routing is off. */
function modelNow({ t, c, d }: RowProps) {
  const cur = d.r.tiers[t.id];
  if (d.off) return '—';
  if (isConfig(cur))
    return (c.settings?.configs || []).find((x: Any) => `cfg:${x.id}` === cur)?.name || '—';
  return d.modelFor(cur, t.agent) || '—';
}

function TaskRow(props: RowProps) {
  const { t, c, d } = props;
  const u = c.usage?.tasks?.[t.id];
  const byModel = u
    ? Object.entries(u.models)
        .map(([m, n]) => `${m}: ${n}`)
        .join('\n')
    : '';
  return (
    <tr>
      <td>
        <b>{t.label}</b>
        {d.r.tiers[t.id] !== t.tier && (
          <div className="muted small">default {TIER_LABEL[t.tier]}</div>
        )}
      </td>
      <td className="rt-desc muted small">
        {t.desc}
        {t.agent && <div>Runs in Claude Code. A model picked on the agent in Agents wins.</div>}
      </td>
      <td>
        <TierPicker {...props} />
      </td>
      <td>
        <code className="rt-model">{modelNow(props)}</code>
      </td>
      <td className="rt-use" title={byModel}>
        {u ? `${u.calls} call${u.calls === 1 ? '' : 's'}` : '—'}
      </td>
    </tr>
  );
}

export function TaskTable({ c, d }: { c: Any; d: RoutingDraft }) {
  return (
    <div className="rt-scroll">
      <table className="rt-tbl">
        <thead>
          <tr>
            <th>Task</th>
            <th className="rt-desc">What it covers</th>
            <th>Tier</th>
            <th>Model now</th>
            <th>Used</th>
          </tr>
        </thead>
        <tbody>
          {d.tasks.map((t, i) => [
            t.group && t.group !== d.tasks[i - 1]?.group && (
              <tr key={`g-${t.group}`} className="rt-group">
                <td colSpan={5}>{t.group}</td>
              </tr>
            ),
            <TaskRow key={t.id} t={t} c={c} d={d} />,
          ])}
        </tbody>
      </table>
    </div>
  );
}
