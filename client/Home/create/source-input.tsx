'use client';
// What the project is made from: a dropped or chosen document (its text can be reviewed and
// edited), or pasted requirements.
import { useState, useRef } from 'react';
import { S, emit } from '../../core';
import { Ico, I, Spinner } from '../../ui';
import { TA } from '../../fields';
import { readDocument } from './generate';

function DropZone() {
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const read = async (file?: File) => {
    if (!file) return;
    setReading(true);
    await readDocument(file);
    setReading(false);
  };
  return (
    <div
      data-tour="new-dropzone"
      className={`dropzone ${over ? 'over' : ''}`}
      onClick={() => fileRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        read(e.dataTransfer.files?.[0]);
      }}
    >
      {reading ? (
        <div className="row" style={{ justifyContent: 'center' }}>
          <Spinner /> Reading document…
        </div>
      ) : (
        <>
          <Ico svg={I.upload} size={32} style={{ color: 'var(--brand)' }} />
          <div style={{ marginTop: 8 }}>
            <b>Choose a file</b> or drag and drop it here
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            PDF, Word (.docx), Markdown, text, HTML, Excel or CSV — up to 50 MB
          </div>
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        hidden
        accept={(S.status?.supported || []).join(',')}
        onChange={(e) => read(e.target.files?.[0])}
      />
    </div>
  );
}

function DocumentBar() {
  const remove = () => {
    S.doc = null;
    emit();
  };
  return (
    <>
      <div className="filebar">
        <Ico svg={I.doc} />
        <span className="name">{S.doc.filename}</span>
        <span className="muted small">{S.doc.text.split(/\s+/).length.toLocaleString()} words</span>
        <button className="btn sm subtle" onClick={remove}>
          Remove
        </button>
      </div>
      <details>
        <summary className="small muted" style={{ cursor: 'pointer' }}>
          Review or edit the extracted text
        </summary>
        <TA
          style={{ minHeight: 220, marginTop: 8, font: '12.5px/1.5 var(--mono)' }}
          value={S.doc.text}
          onChange={(e) => {
            S.doc.text = e.target.value;
            emit();
          }}
        />
      </details>
    </>
  );
}

export function SourceInput({ paste, setPaste }: { paste: string; setPaste: (v: string) => void }) {
  return (
    <>
      <DropZone />
      {S.doc ? (
        <DocumentBar />
      ) : (
        <>
          <div className="or">or paste the requirements</div>
          <TA
            style={{ minHeight: 120 }}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Paste a PRD, BRD, feature brief or meeting notes…"
          />
        </>
      )}
    </>
  );
}
