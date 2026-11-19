'use client';
// The toolbar above the document: Document / Text view, find with previous and next match, zoom,
// and print.
import { Ico, I } from '../../ui';
import type { DocViewer } from './use-doc-viewer';

function ViewSwitch({ v }: { v: DocViewer }) {
  return (
    <div className="seg" role="radiogroup" aria-label="View">
      <button
        role="radio"
        aria-checked={v.mode === 'page'}
        className={v.mode === 'page' ? 'on' : ''}
        onClick={() => {
          v.setQ('');
          v.setMode('page');
        }}
      >
        <Ico svg={I.doc} />
        Document
      </button>
      <button
        role="radio"
        aria-checked={v.mode === 'text'}
        className={v.mode === 'text' ? 'on' : ''}
        onClick={() => v.setMode('text')}
      >
        Text
      </button>
    </div>
  );
}

/** Searching switches to the text view. Enter / Shift+Enter go to the next / previous match. */
function FindBox({ v }: { v: DocViewer }) {
  return (
    <div className="search src-search">
      <Ico svg={I.search} />
      <input
        value={v.q}
        placeholder="Find in document"
        aria-label="Find in document"
        onChange={(e) => {
          v.setQ(e.target.value);
          if (e.target.value) v.setMode('text');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && v.hits) {
            e.preventDefault();
            v.step(e.shiftKey ? -1 : 1);
          }
          if (e.key === 'Escape') v.setQ('');
        }}
      />
    </div>
  );
}

function Matches({ v }: { v: DocViewer }) {
  if (!v.q) return null;
  return (
    <>
      <span className="muted small" aria-live="polite">
        {v.hits ? `${v.hit + 1} of ${v.hits}` : 'No matches'}
      </span>
      {v.hits > 1 && (
        <>
          <button className="icon-btn" aria-label="Previous match" onClick={() => v.step(-1)}>
            <Ico svg={I.up} />
          </button>
          <button className="icon-btn" aria-label="Next match" onClick={() => v.step(1)}>
            <Ico svg={I.down} />
          </button>
        </>
      )}
    </>
  );
}

/** 60 % to 160 %, in steps of 10; clicking the percentage resets it. */
function Zoom({ v }: { v: DocViewer }) {
  const by = (d: number) => v.setZoom(Math.round((v.zoom + d) * 10) / 10);
  return (
    <span className="row src-zoom" style={{ gap: 2 }}>
      <button
        className="icon-btn"
        aria-label="Zoom out"
        disabled={v.zoom <= 0.6}
        onClick={() => by(-0.1)}
      >
        −
      </button>
      <button className="btn sm subtle" title="Reset zoom" onClick={() => v.setZoom(1)}>
        {Math.round(v.zoom * 100)}%
      </button>
      <button
        className="icon-btn"
        aria-label="Zoom in"
        disabled={v.zoom >= 1.6}
        onClick={() => by(0.1)}
      >
        +
      </button>
    </span>
  );
}

export function DocTools({ v }: { v: DocViewer }) {
  const page = v.mode === 'page';
  return (
    <div className="src-tools">
      <ViewSwitch v={v} />
      <FindBox v={v} />
      <Matches v={v} />
      <div className="spacer" />
      {page && !v.isPdf && <Zoom v={v} />}
      {page && (
        <button className="btn sm" onClick={v.print}>
          <Ico svg={I.download} />
          {v.isPdf ? 'Open PDF' : 'Print / PDF'}
        </button>
      )}
    </div>
  );
}
