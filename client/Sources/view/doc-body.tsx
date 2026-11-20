'use client';
// The document itself: plain text with search highlights, the PDF, the Word file as a page, or the
// text laid out as a page.
import type { Any } from '../../core';
import { Highlighted, TextPage } from '../all-sources';
import { type DocViewer, fileUrl } from './use-doc-viewer';

/** A Word file rendered as HTML, as tall as its content. */
function WordFrame({ sel, v }: { sel: Any; v: DocViewer }) {
  return (
    <iframe
      key={sel.file.id}
      ref={v.frameRef}
      className="doc-frame"
      sandbox="allow-same-origin allow-popups allow-modals"
      src={`/api/files/${sel.file.id}?view=html`}
      title={sel.name}
      onLoad={(e) => {
        const f = e.currentTarget;
        try {
          f.style.height = `${f.contentDocument!.documentElement.scrollHeight + 4}px`;
        } catch {
          /* keep default */
        }
      }}
    />
  );
}

function Page({ sel, v }: { sel: Any; v: DocViewer }) {
  if (v.isPdf)
    return (
      <iframe
        key={sel.file.id}
        className="doc-pdf"
        src={`${fileUrl(sel.file)}#view=FitH`}
        title={sel.name}
      />
    );
  return (
    <div className="paper-desk">
      <div className="paper-zoom" style={{ zoom: v.zoom }}>
        {v.isDocx ? (
          <WordFrame sel={sel} v={v} />
        ) : (
          <article className="paper" ref={v.paperRef}>
            <TextPage text={sel.text} />
          </article>
        )}
      </div>
    </div>
  );
}

export function DocBody({ sel, v }: { sel: Any; v: DocViewer }) {
  return (
    <div className={`src-body ${v.mode === 'page' ? 'is-page' : ''}`} ref={v.bodyRef}>
      {v.mode === 'text' ? (
        <div className="source src-plain">
          <Highlighted text={sel.text} q={v.q} current={v.hit} />
        </div>
      ) : (
        <Page sel={sel} v={v} />
      )}
    </div>
  );
}
