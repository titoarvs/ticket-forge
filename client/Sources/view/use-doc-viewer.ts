'use client';
// How the selected document is being read: as a page or as text, the search and the current match,
// the zoom, and printing.
import { useState, useRef, useMemo, useEffect } from 'react';
import type { Any } from '../../core';
import { escapeRe, printPaper } from '../all-sources';

export type ViewMode = 'page' | 'text';

/** Where a stored file opens (inline). */
export const fileUrl = (f: Any) => `/api/files/${f.id}/${encodeURIComponent(f.name)}`;

export function useDocViewer(sel: Any) {
  const [q, setQ] = useState('');
  const [hit, setHit] = useState(0);
  const [mode, setMode] = useState<ViewMode>('page');
  const [zoom, setZoom] = useState(1);
  const bodyRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const hits = useMemo(
    () => (q && sel ? (sel.text.match(new RegExp(escapeRe(q), 'gi')) || []).length : 0),
    [q, sel],
  );
  useEffect(() => {
    setHit(0);
  }, [q, sel?.id]);
  useEffect(() => {
    bodyRef.current
      ?.querySelector(`mark[data-hit="${hit}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [hit, q, sel?.id]);

  const isPdf = sel?.file?.mime === 'application/pdf';
  const isDocx = Boolean(sel?.file && /wordprocessingml/.test(sel.file.mime));
  /** Next (by 1) or previous (by -1) match, wrapping around. */
  const step = (by: number) => setHit((h) => (h + by + hits) % hits);
  /** A PDF opens in a new tab; a Word file prints from its frame; text prints as a page. */
  const print = () => {
    if (isPdf) {
      window.open(fileUrl(sel.file), '_blank', 'noopener');
      return;
    }
    if (isDocx) {
      try {
        frameRef.current?.contentWindow?.print();
      } catch {
        window.open(`/api/files/${sel.file.id}?view=html`, '_blank', 'noopener');
      }
      return;
    }
    printPaper(sel.name, paperRef.current?.innerHTML || '');
  };
  /** Back to the page view with no search (when another document is chosen). */
  const reset = () => {
    setQ('');
    setMode('page');
  };
  return {
    q,
    setQ,
    hit,
    hits,
    step,
    mode,
    setMode,
    zoom,
    setZoom,
    bodyRef,
    paperRef,
    frameRef,
    isPdf,
    isDocx,
    print,
    reset,
  };
}
export type DocViewer = ReturnType<typeof useDocViewer>;
