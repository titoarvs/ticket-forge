'use client';
// Model routing: turn it on, pick a preset, set each task's tier, and keep light tasks fast.
import type { Any } from '../../core';
import { CB } from '../../fields';
import { PRESETS } from '../presets';
import type { RoutingDraft } from './use-routing-draft';
import { TaskTable } from './task-table';

/** A link to another part of the AI page. */
export function PartLink({
  go,
  to,
  children,
}: {
  go?: (k: string) => void;
  to: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        go?.(to);
      }}
    >
      {children}
    </a>
  );
}

function Presets({ d }: { d: RoutingDraft }) {
  return (
    <div className="rt-presets" role="radiogroup" aria-label="Preset">
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          role="radio"
          aria-checked={d.preset === p.key}
          className={d.preset === p.key ? 'on' : ''}
          disabled={d.off}
          onClick={() => d.pickPreset(p)}
        >
          <b>{p.label}</b>
          <span className="muted small">{p.desc}</span>
        </button>
      ))}
    </div>
  );
}

export function RoutingCard({ c, d, go }: { c: Any; d: RoutingDraft; go?: (k: string) => void }) {
  const { r, setR } = d;
  return (
    <div className="card wide">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>Model routing</h3>
          <p className="sub" style={{ marginBottom: 10 }}>
            Each kind of AI work uses a tier: <b>High</b> for work that needs the best model,{' '}
            <b>Standard</b> for everyday work and <b>Light</b> for small, frequent jobs. Lighter
            tiers answer faster and use less of your Claude plan or API credits.
          </p>
        </div>
      </div>
      <CB
        label={
          <>
            <b>Use a model per task</b>{' '}
            <span className="muted">
              — off: everything uses the main model (or the model each person picks on this
              computer)
            </span>
          </>
        }
        checked={r.enabled}
        onChange={(e: Any) => setR({ ...r, enabled: e.target.checked })}
      />
      <div className={d.off ? 'rt-off' : ''}>
        <Presets d={d} />
        <TaskTable c={c} d={d} />
        <CB
          label="Light tasks never use extended thinking (fastest and cheapest)"
          checked={r.lightFast}
          disabled={d.off}
          onChange={(e: Any) => setR({ ...r, lightFast: e.target.checked })}
        />
        {go && (
          <p className="muted small rt-next">
            Which model a tier means on each AI:{' '}
            <PartLink go={go} to="models">
              Models per tier
            </PartLink>
            . How much each task uses:{' '}
            <PartLink go={go} to="usage">
              Usage & suggestions
            </PartLink>
            .
          </p>
        )}
      </div>
    </div>
  );
}
