'use client';
// The bar under every section: whether the rules are saved, Reset to defaults, Discard and Save.
import { ago } from '../../core';
import { I, Ico, Spinner } from '../../ui';
import type { Rules } from './use-rules';

function SaveState({ g }: { g: Rules }) {
  const meta = g.data.meta;
  if (g.dirty) return <>Unsaved changes</>;
  if (!meta) return <>Using the default rules</>;
  return (
    <>
      Saved{meta.updatedBy ? ` by ${meta.updatedBy}` : ''} {ago(meta.updatedAt)}
    </>
  );
}

export function SaveBar({ g }: { g: Rules }) {
  const { dirty, busy } = g;
  return (
    <div className={`gen-bar ${dirty ? 'dirty' : ''}`}>
      <span className="muted small">
        <SaveState g={g} />
      </span>
      <div className="spacer" />
      <button className="btn subtle" disabled={!!busy} onClick={g.reset}>
        <Ico svg={I.undo} />
        Reset to defaults
      </button>
      {dirty && (
        <button className="btn" disabled={!!busy} onClick={g.discard}>
          Discard
        </button>
      )}
      <button className="btn primary" disabled={!dirty || !!busy} onClick={g.save}>
        {busy === 'save' ? (
          <>
            <Spinner />
            Saving…
          </>
        ) : (
          'Save rules'
        )}
      </button>
    </div>
  );
}
