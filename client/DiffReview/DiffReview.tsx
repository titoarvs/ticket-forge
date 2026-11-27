'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import { type Any, P, api } from '../core';
import { ErrorState, Spinner, EmptyState, I, Ico } from '../ui';
import { SF, MenuItem } from '../fields';
import { parseDiff, type DiffFile } from '../logic/diff';
import {
  VIEW_KEY,
  NARROW,
  split,
  DIFF_TARGETS,
  fmt,
  targetLabel,
  LETTER,
  Bar,
  FileBody,
} from './diff-targets';

/**
 * The diff of one code job (`job`: id, projectId, status). `defaultTarget` is the comparison shown
 * first.
 */
export function DiffReview({
  job,
  defaultTarget = 'default',
}: {
  job: Any;
  defaultTarget?: string;
}) {
  const [target, setTarget] = useState(defaultTarget);
  const [res, setRes] = useState<Any>(null);
  const [error, setError] = useState<Any>(null);
  const [sel, setSel] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'split' | 'unified'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'unified' ? 'unified' : 'split';
    } catch {
      return 'split';
    }
  });
  const [narrow, setNarrow] = useState(false);
  const seq = useRef(0);
  const box = useRef<HTMLElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const pid = job.projectId || P()?.id;

  const load = async (t: string) => {
    const mine = ++seq.current;
    setRes(null);
    setError(null);
    try {
      const r = await api(
        `/api/projects/${encodeURIComponent(pid)}/code?jobId=${encodeURIComponent(job.id)}&compare=${encodeURIComponent(t)}`,
      );
      if (mine === seq.current) setRes(r);
    } catch (e: Any) {
      if (mine === seq.current) setError(e);
    }
  };
  // Recalculates for the chosen target; the earlier answer is dropped so a slow one can't replace a
  // newer choice. (load numbers each request; an answer that isn't the latest one is ignored.)
  useEffect(() => {
    const s = seq;
    load(target);
    return () => {
      s.current++;
    };
  }, [job.id, job.finishedAt, job.rounds, target]); // eslint-disable-line react-hooks/exhaustive-deps
  // The panel's own width decides the layout (the same view sits in a dialog, a page and a side
  // panel).
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < NARROW));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const files = useMemo(() => (res?.diff ? parseDiff(res.diff) : []), [res]);
  useEffect(() => {
    if (files.length && !files.some((f) => f.path === sel)) setSel(files[0].path);
  }, [files]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = files.reduce((n, f) => n + f.added, 0),
    del = files.reduce((n, f) => n + f.removed, 0);
  const shown = q.trim()
    ? files.filter((f) => f.path.toLowerCase().includes(q.trim().toLowerCase()))
    : files;
  const idx = Math.max(
    0,
    files.findIndex((f) => f.path === sel),
  );
  const cur = files[idx];
  const eff = narrow ? 'unified' : view;
  const pick = (path: string) => {
    setSel(path);
    top.current?.scrollIntoView({ block: 'nearest' });
  };
  const step = (d: number) => {
    const f = files[idx + d];
    if (f) pick(f.path);
  };
  const setV = (v: 'split' | 'unified') => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private window */
    }
  };
  // Folders as quiet headings in the file list.
  const groups = useMemo(() => {
    const m = new Map<string, DiffFile[]>();
    for (const f of shown) {
      const [dir] = split(f.path);
      if (!m.has(dir)) m.set(dir, []);
      m.get(dir)!.push(f);
    }
    return [...m.entries()];
  }, [shown]);

  return (
    <section className={`dv ${narrow ? 'narrow' : ''}`} ref={box} aria-label="Code changes">
      <div className="dv-top">
        <div className="dv-cmp">
          <span>Compare with</span>
          <SF
            filter
            className="dv-csel"
            value={target}
            onChange={(e: Any) => setTarget(e.target.value)}
            title={DIFF_TARGETS.find((x) => x[0] === target)?.[2]}
            aria-label="Compare with"
          >
            {DIFF_TARGETS.map(([k, l, hint]) => (
              <MenuItem key={k} value={k} title={hint}>
                {l}
              </MenuItem>
            ))}
          </SF>
        </div>
        {res?.against && (
          <code className="dv-against" title="What the AI output is compared with">
            {res.against}
          </code>
        )}
        {res?.available && files.length > 0 && (
          <span className="dv-stats" aria-live="polite">
            {files.length} file{files.length === 1 ? '' : 's'}{' '}
            <span className="da">+{fmt(add)}</span> <span className="dr">−{fmt(del)}</span>
          </span>
        )}
        <span className="dv-grow" />
        {!narrow && files.length > 0 && (
          <div className="dv-seg" role="radiogroup" aria-label="Diff layout">
            {(['split', 'unified'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                className={view === v ? 'on' : ''}
                onClick={() => setV(v)}
              >
                {v === 'split' ? 'Split' : 'Unified'}
              </button>
            ))}
          </div>
        )}
      </div>
      {error ? (
        <ErrorState
          compact
          title="Couldn’t load the changes"
          error={error}
          onRetry={() => load(target)}
        />
      ) : !res ? (
        <div className="muted small dv-note" role="status">
          <Spinner /> Loading the changes…
        </div>
      ) : !res.available ? (
        <EmptyState compact icon={I.clock} tone="neutral" title="Nothing to compare with">
          <p>{res.reason}</p>
        </EmptyState>
      ) : !files.length ? (
        <EmptyState compact icon={I.check} tone="neutral" title="No changes">
          <p>The AI output matches the {targetLabel(target).toLowerCase()}.</p>
        </EmptyState>
      ) : (
        <div className="dv-main">
          {!narrow && (
            <nav className="dv-side" aria-label="Changed files">
              {files.length > 8 && (
                <input
                  className="dv-filter"
                  type="search"
                  placeholder="Filter files"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  aria-label="Filter files"
                />
              )}
              <ul>
                {groups.map(([dir, list]) => (
                  <li key={dir || '/'}>
                    {dir && (
                      <div className="dv-dir" title={dir}>
                        {dir}
                      </div>
                    )}
                    <ul>
                      {list.map((f) => {
                        const [, name] = split(f.path);
                        return (
                          <li key={f.path}>
                            <button
                              type="button"
                              className={f.path === cur?.path ? 'on' : ''}
                              aria-current={f.path === cur?.path ? 'true' : undefined}
                              onClick={() => pick(f.path)}
                              title={f.path}
                            >
                              <span className={`dv-st ${f.status}`} aria-label={f.status}>
                                {LETTER[f.status]}
                              </span>
                              <span className="dv-name">{name}</span>
                              <span className="dv-n">
                                <span className="da">+{f.added}</span>{' '}
                                <span className="dr">−{f.removed}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
              {!shown.length && <p className="muted small dv-note">No file matches.</p>}
            </nav>
          )}
          {cur && (
            <div className="dv-pane">
              <div className="dv-fh" ref={top}>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={idx === 0}
                  onClick={() => step(-1)}
                  aria-label="Previous file"
                  title="Previous file"
                >
                  <Ico svg={I.chevron} className="left" />
                </button>
                {narrow ? (
                  <SF
                    filter
                    className="dv-fsel"
                    value={cur.path}
                    onChange={(e: Any) => pick(e.target.value)}
                    aria-label="File"
                  >
                    {files.map((f) => (
                      <MenuItem key={f.path} value={f.path} className="dv-fopt">
                        {f.path}
                      </MenuItem>
                    ))}
                  </SF>
                ) : (
                  <span className="dv-path" title={cur.path}>
                    <span className={`dv-st ${cur.status}`}>{LETTER[cur.status]}</span>
                    <span className="dir">{split(cur.path)[0]}</span>
                    <b>{split(cur.path)[1]}</b>
                  </span>
                )}
                <span className="dv-fstat">
                  <span className="da">+{cur.added}</span>{' '}
                  <span className="dr">−{cur.removed}</span>
                  <Bar a={cur.added} d={cur.removed} />
                </span>
                <span className="dv-count muted small">
                  {idx + 1} / {files.length}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={idx >= files.length - 1}
                  onClick={() => step(1)}
                  aria-label="Next file"
                  title="Next file"
                >
                  <Ico svg={I.chevron} className="right" />
                </button>
              </div>
              <div className="dv-body">
                <FileBody f={cur} view={cur.status === 'modified' ? eff : 'unified'} />
              </div>
              {idx < files.length - 1 && (
                <button type="button" className="dv-next" onClick={() => step(1)}>
                  Next file: <code>{files[idx + 1].path}</code>
                  <Ico svg={I.chevron} className="right" />
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
