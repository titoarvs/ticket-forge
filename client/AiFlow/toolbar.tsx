'use client';
// The controls on top of the canvas: the toolbar, the zoom buttons and the empty-state prompt.
import { Ico, I, Spinner } from '../ui';
import type { Flow } from './flow';
import type { Viewport } from './use-viewport';

function SaveStatus({ f }: { f: Flow }) {
  const { saving, dirty } = f.routing;
  return (
    <span className="flow-status" role="status">
      {saving ? (
        <>
          <Spinner />
          Saving…
        </>
      ) : dirty ? (
        'Unsaved model changes'
      ) : (
        'Saved'
      )}
    </span>
  );
}

export function FlowToolbar({ f }: { f: Flow }) {
  const { on, saving, setRouting } = f.routing;
  return (
    <div className="flow-ui flow-top">
      <button type="button" className="btn sm primary" onClick={f.actions.add}>
        <Ico svg={I.plus} />
        Add provider
      </button>
      <label className="fi-sw inline" title="When off, every task uses the AI’s own model">
        <input
          type="checkbox"
          checked={on}
          disabled={saving}
          onChange={(e) => setRouting(e.target.checked)}
        />
        <span>Model routing</span>
      </label>
      <SaveStatus f={f} />
      <span className="flow-hint">
        Drag a task’s dot onto a tier · drag a provider’s bottom dot onto another to set the
        fallback order
      </span>
    </div>
  );
}

/** `reset` off: for canvases without a starting layout to go back to. */
export function ZoomControls({ v, reset = true }: { v: Viewport; reset?: boolean }) {
  const { full, setFull } = v;
  return (
    <div className="flow-ui flow-zoom">
      <button type="button" onClick={() => v.zoomBy(0.8)} aria-label="Zoom out">
        −
      </button>
      <span>{Math.round(v.view.k * 100)}%</span>
      <button type="button" onClick={() => v.zoomBy(1.25)} aria-label="Zoom in">
        +
      </button>
      <button type="button" onClick={v.refit} aria-label="Fit everything" title="Fit everything">
        ⤢
      </button>
      {reset && (
        <button
          type="button"
          className="flow-reset"
          onClick={v.resetLayout}
          title="Put the nodes back where they started"
        >
          Reset layout
        </button>
      )}
      <button
        type="button"
        onClick={() => setFull(!full)}
        aria-label={full ? 'Exit full screen' : 'Full screen'}
        title={full ? 'Exit full screen (Esc)' : 'Full screen'}
      >
        {full ? '⤡' : '⛶'}
      </button>
    </div>
  );
}

export function EmptyState({ f }: { f: Flow }) {
  return (
    <div className="flow-ui flow-empty">
      <b>No AI providers yet</b>
      <span>Add one, then wire your tasks to it.</span>
      <button type="button" className="btn sm primary" onClick={f.actions.add}>
        <Ico svg={I.plus} />
        Add provider
      </button>
    </div>
  );
}
