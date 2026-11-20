'use client';
// The selected document's title, kind, length and date, with its actions.
import { type Any, can, openModal, copyText } from '../../core';
import { Ico, I } from '../../ui';
import { FeatureModal } from '../../FeatureModal';
import { words, KIND } from '../all-sources';
import { AddedLine } from './doc-list';
import { downloadText, renameDoc, removeDoc } from './doc-actions';

/** Plan work from it, Copy, Download, and (for added documents) Rename and Remove. */
function DocActions({
  sel,
  canEdit,
  issueCount,
}: {
  sel: Any;
  canEdit: boolean;
  issueCount: number;
}) {
  const planWork = () =>
    openModal(
      <FeatureModal initialDoc={{ filename: sel.name, text: sel.text }} sourceId={sel.id} />,
    );
  return (
    <div className="row src-actions">
      {can('issue.create') && can('ai.use') && (
        <button
          className="btn ai sm"
          onClick={planWork}
          title="Plan more epics and issues from this document"
        >
          <Ico svg={I.sparkle} />
          Plan work from it
        </button>
      )}
      <button className="btn sm" onClick={() => copyText(sel.text)}>
        <Ico svg={I.copy} />
        Copy
      </button>
      <button className="btn sm" onClick={() => downloadText(sel)}>
        <Ico svg={I.download} />
        Download
      </button>
      {canEdit && sel.kind !== 'original' && (
        <>
          <button
            className="icon-btn"
            title="Rename"
            aria-label="Rename document"
            onClick={() => renameDoc(sel)}
          >
            <Ico svg={I.pencil} />
          </button>
          <button
            className="icon-btn"
            title="Remove"
            aria-label="Remove document"
            onClick={() => removeDoc(sel, issueCount)}
          >
            <Ico svg={I.trash} />
          </button>
        </>
      )}
    </div>
  );
}

export function DocHead({
  sel,
  canEdit,
  issueCount,
}: {
  sel: Any;
  canEdit: boolean;
  issueCount: number;
}) {
  const wc = words(sel.text);
  return (
    <div className="src-head">
      <div style={{ minWidth: 0 }}>
        <h2 className="src-title" title={sel.name}>
          {sel.name}
        </h2>
        <div className="muted small row" style={{ gap: 8 }}>
          <span className={`src-kind k-${sel.kind}`} title={KIND[sel.kind]?.[1]}>
            {KIND[sel.kind]?.[0]}
          </span>
          <span>
            {wc.toLocaleString()} words · about {Math.max(1, Math.round(wc / 230))} min read
          </span>
          {sel.addedAt && (
            <span>
              <AddedLine d={sel} />
            </span>
          )}
        </div>
      </div>
      <DocActions sel={sel} canEdit={canEdit} issueCount={issueCount} />
    </div>
  );
}
