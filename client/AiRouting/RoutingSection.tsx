'use client';
// One part of the AI page's model routing settings. The parts share one draft and one Save bar:
// routing (presets, tier per task) · models (the model behind each tier) · usage (report and
// suggestions) · savings (reused answers, try Standard first, budget, prices). The parts are in
// client/AiRouting/parts/.
import type { Any } from '../core';
import { Ico, I, Spinner } from '../ui';
import { UsageReport } from '../AiUsage';
import type { Part } from './presets';
import { type RoutingDraft, useRoutingDraft } from './parts/use-routing-draft';
import { RoutingCard } from './parts/routing-card';
import { ModelsCard } from './parts/models-card';
import { SavingsCard } from './parts/savings-card';

type RoutingProps = { c: Any; onSaved: (st: Any) => void; part?: Part; go?: (k: string) => void };

function saveState(d: RoutingDraft, part: Part) {
  if (d.dirty) return 'Unsaved changes';
  if (part === 'savings') return 'Reuse answers: saved';
  return d.saved.enabled ? 'Model routing is on' : 'Model routing is off';
}

function SaveBar({ d, part }: { d: RoutingDraft; part: Part }) {
  return (
    <div className={`gen-bar ${d.dirty ? 'dirty' : ''}`}>
      <span className="muted small">{saveState(d, part)}</span>
      <div className="spacer" />
      <button className="btn subtle" disabled={!!d.busy} onClick={d.reset}>
        <Ico svg={I.undo} />
        Reset to defaults
      </button>
      {d.dirty && (
        <button className="btn" disabled={!!d.busy} onClick={d.discard}>
          Discard
        </button>
      )}
      <button className="btn primary" disabled={!d.dirty || !!d.busy} onClick={d.save}>
        {d.busy === 'save' ? (
          <>
            <Spinner />
            Saving…
          </>
        ) : (
          'Save'
        )}
      </button>
    </div>
  );
}

export function RoutingSection({ c, onSaved, part = 'routing', go }: RoutingProps) {
  const d = useRoutingDraft(c, onSaved);
  if (!d.saved || !d.r) return null;
  return (
    <div className="cards">
      {part === 'routing' && <RoutingCard c={c} d={d} go={go} />}
      {part === 'models' && <ModelsCard c={c} d={d} go={go} />}
      {part === 'savings' && <SavingsCard c={c} d={d} />}
      {part === 'usage' && <UsageReport routing={d.saved} apply={d.apply} view="usage" go={go} />}
      {part === 'savings' && (
        <UsageReport routing={d.saved} apply={d.apply} view="limits" go={go} />
      )}
      {part !== 'usage' && <SaveBar d={d} part={part} />}
    </div>
  );
}
