'use client';
// The Timeline's header, its toolbar (zoom, Today, expand all, legend) and the empty page.
import { type Any, P, can, S, saveUi, emit, openModal } from '../../core';
import { EmptyState, I, Ico } from '../../ui';
import { addEpic } from '../../actions';
import { Header } from '../../views';
import { FeatureModal } from '../../FeatureModal';
import { ZOOMS, epicRange } from '../epic-range';

function AiFeatureButton() {
  if (!can('ai.use') || !can('issue.create')) return null;
  return (
    <button className="btn ai" onClick={() => openModal(<FeatureModal />)}>
      <Ico svg={I.plus} />
      Add feature with AI
    </button>
  );
}

function CreateEpicButton() {
  if (!can('epic.manage')) return null;
  return (
    <button className="btn primary" onClick={addEpic}>
      <Ico svg={I.plus} />
      Create epic
    </button>
  );
}

export function EmptyTimeline() {
  return (
    <>
      <Header title="Timeline" />
      <EmptyState
        icon={I.calendar}
        tone="epic"
        title="Plan your features on a timeline"
        actions={
          <>
            <CreateEpicButton />
            <AiFeatureButton />
          </>
        }
      >
        <p>
          Each epic gets a bar from its start to its due date, so you can see what’s planned when
          and what’s running late.
        </p>
      </EmptyState>
    </>
  );
}

export function TimelineHeader() {
  const epics = P().epics;
  const scheduled = epics.filter((e: Any) => epicRange(e)).length;
  const hint = can('epic.manage')
    ? ' · drag a bar to move it, drag its ends to change dates, or click an empty row to schedule'
    : '';
  return (
    <Header
      title="Timeline"
      sub={
        <span className="muted small">
          {scheduled} of {epics.length} epic{epics.length === 1 ? '' : 's'} scheduled
          {hint}
        </span>
      }
      right={
        <>
          <AiFeatureButton />
          <CreateEpicButton />
        </>
      }
    />
  );
}

const setZoom = (k: string) => {
  S.tlZoom = k;
  saveUi();
  emit();
};

/** Opens every epic's issues, or closes them all when every one is open. */
function toggleAll(allOpen: boolean) {
  const open: Set<string> = S.tlOpen;
  if (allOpen) open.clear();
  else P().epics.forEach((e: Any) => open.add(e.id));
  saveUi();
  emit();
}

export function TimelineBar({ zoom, onToday }: { zoom: string; onToday: () => void }) {
  const epics = P().epics;
  const allOpen = epics.length > 0 && epics.every((e: Any) => S.tlOpen.has(e.id));
  return (
    <div className="row tl-bar">
      <div className="seg" role="radiogroup" aria-label="Zoom">
        {ZOOMS.map(([k, l]) => (
          <button
            key={k}
            role="radio"
            aria-checked={zoom === k}
            className={zoom === k ? 'on' : ''}
            onClick={() => setZoom(k)}
          >
            {l}
          </button>
        ))}
      </div>
      <button className="btn subtle" onClick={onToday}>
        <Ico svg={I.calendar} />
        Today
      </button>
      <button className="btn subtle" onClick={() => toggleAll(allOpen)}>
        <Ico svg={allOpen ? I.collapse : I.expand} />
        {allOpen ? 'Collapse all' : 'Expand all'}
      </button>
      <div className="spacer" />
      <span className="tl-legend muted small">
        <i className="tl-key planned" />
        Planned dates
        <i className="tl-key derived" />
        From sprints
        <i className="tl-key late" />
        Overdue
      </span>
    </div>
  );
}
