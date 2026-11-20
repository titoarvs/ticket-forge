'use client';
// The document's original file (open, download, replace), or an offer to attach it.
import { useRef, useState } from 'react';
import { type Any, P } from '../../core';
import { Ico, I, Spinner } from '../../ui';
import { fmtBytes } from '../all-sources';
import { fileUrl } from './use-doc-viewer';
import { attachOriginal } from './doc-actions';

function OriginalFile({ f, canEdit, pick }: { f: Any; canEdit: boolean; pick: () => void }) {
  return (
    <div className="src-file small">
      <Ico svg={I.doc} />
      <span>
        Original file: <b>{f.name}</b> · {fmtBytes(f.bytes)}
      </span>
      <a href={fileUrl(f)} target="_blank" rel="noopener noreferrer">
        Open
      </a>
      <a href={`/api/files/${f.id}?download=1`}>Download</a>
      {canEdit && (
        <button className="link-btn" onClick={pick}>
          Replace
        </button>
      )}
    </div>
  );
}

function AttachOffer({ busy, pick }: { busy: boolean; pick: () => void }) {
  return (
    <div className="src-file small muted">
      <Ico svg={I.doc} />
      <span>
        Showing the document’s text as a page. Have the original PDF or Word file? Attach it to see
        it exactly as written.
      </span>
      <button className="btn sm" disabled={busy} onClick={pick}>
        {busy ? (
          <>
            <Spinner />
            Uploading…
          </>
        ) : (
          <>
            <Ico svg={I.upload} />
            Attach original
          </>
        )}
      </button>
    </div>
  );
}

/** Shown in the page view only. Descriptions (typed text) have no original file to attach. */
export function FileBar({ sel, canEdit }: { sel: Any; canEdit: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = () => input.current?.click();
  const attach = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    await attachOriginal(P().id, sel, file);
    setBusy(false);
  };
  return (
    <>
      {sel.file && <OriginalFile f={sel.file} canEdit={canEdit} pick={pick} />}
      {!sel.file && canEdit && sel.kind !== 'description' && (
        <AttachOffer busy={busy} pick={pick} />
      )}
      <input
        ref={input}
        type="file"
        hidden
        accept=".pdf,.docx"
        onChange={(e) => {
          attach(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </>
  );
}
