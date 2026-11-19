'use client';
// Diff review (TF-121): what a code-with-AI job changed. One file at a time, like a code review
// tool: the changed files on the left (filterable, grouped by folder), the chosen file's diff on
// the right with previous / next, and a choice of what to compare with (the repository default
// branch, the previous job run or the prior spec version).
// Split (side by side) or Unified (one column) view; a narrow panel always shows Unified and a file
// menu instead of the list. Long lines wrap, so nothing scrolls sideways. Anyone who can open the
// project sees it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { P, api, type Any } from './core';
import { Ico, I, Spinner, EmptyState, ErrorState } from './ui';
import { parseDiff, type DiffFile, type Row, type Cell } from './logic/diff';

export const DIFF_TARGETS: [string, string, string][] = [
  [
    'default',
    'Repository default branch',
    'Everything this job changed compared with the default branch',
  ],
  ['job', 'Previous job run', 'What changed since the last code run for this issue'],
  ['spec', 'Prior spec version', 'What changed since the last run made before the current spec'],
];
const targetLabel = (t: string) => DIFF_TARGETS.find((x) => x[0] === t)?.[1] || t;
const VIEW_KEY = 'tf.diff.view';
const NARROW = 760; // below this width the panel shows one column and a file menu
const fmt = (n: number) => n.toLocaleString();
const split = (path: string) => {
  const i = path.lastIndexOf('/');
  return i < 0 ? ['', path] : [path.slice(0, i + 1), path.slice(i + 1)];
};
const LETTER: Record<string, string> = { added: 'A', deleted: 'D', modified: 'M' };

/** A small five-block bar of how much of a file was added vs removed, like GitHub's. */
function Bar({ a, d }: { a: number; d: number }) {
  const t = a + d || 1,
    green = Math.round((a / t) * 5);
  return (
    <span className="dv-bar5" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} className={a + d === 0 ? '' : i < green ? 'a' : 'd'} />
      ))}
    </span>
  );
}

type ULine =
  | { kind: 'hunk'; text: string }
  | { kind: 'line'; o: number | null; n: number | null; text: string; t: 'ctx' | 'add' | 'del' };
/**
 * Side-by-side rows as unified lines: unchanged lines once, and in each changed block the removed
 * lines before the added ones.
 */
function unified(rows: Row[]): ULine[] {
  const out: ULine[] = [];
  let dels: Cell[] = [],
    adds: Cell[] = [];
  const flush = () => {
    for (const c of dels) out.push({ kind: 'line', o: c.no, n: null, text: c.text, t: 'del' });
    for (const c of adds) out.push({ kind: 'line', o: null, n: c.no, text: c.text, t: 'add' });
    dels = [];
    adds = [];
  };
  for (const r of rows) {
    if (r.kind === 'hunk') {
      flush();
      out.push(r);
      continue;
    }
    if (r.ctx) {
      flush();
      out.push({
        kind: 'line',
        o: r.l?.no ?? null,
        n: r.r?.no ?? null,
        text: r.r?.text ?? r.l?.text ?? '',
        t: 'ctx',
      });
      continue;
    }
    if (r.l) dels.push(r.l);
    if (r.r) adds.push(r.r);
  }
  flush();
  return out;
}
/** "@@ -10,4 +10,7 @@ function name" → "Lines 10–16 · function name" */
const hunkLabel = (text: string) => {
  const m = text.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/);
  if (!m) return text;
  // The new file's lines, or the old file's when the file was deleted (nothing is left on the new
  // side).
  const newN = m[4] === undefined ? 1 : Number(m[4]);
  const from = Number(newN ? m[3] : m[1]),
    n = newN || (m[2] === undefined ? 1 : Number(m[2]));
  return `${n > 1 ? `Lines ${from}–${from + n - 1}` : `Line ${from}`}${m[5] ? ` · ${m[5].trim()}` : ''}`;
};

function FileBody({ f, view }: { f: DiffFile; view: 'split' | 'unified' }) {
  if (f.binary) return <p className="muted small dv-note">Binary file: not shown.</p>;
  if (!f.rows.length)
    return (
      <p className="muted small dv-note">
        {f.status === 'added' ? 'Empty file added.' : 'No line changes (only its mode or name).'}
      </p>
    );
  if (view === 'unified') {
    return (
      <table className="dv-tbl dv-uni" aria-label={`Changes in ${f.path}`}>
        <colgroup>
          <col className="dv-c-no" />
          <col className="dv-c-no" />
          <col />
        </colgroup>
        <tbody>
          {unified(f.rows).map((r, i) =>
            r.kind === 'hunk' ? (
              <tr key={i} className="dv-hunk">
                <td colSpan={3}>
                  <span>{hunkLabel(r.text)}</span>
                </td>
              </tr>
            ) : (
              <tr key={i} className={r.t}>
                <td className="dv-no">{r.o ?? ''}</td>
                <td className="dv-no">{r.n ?? ''}</td>
                <td className="dv-code">
                  <span className="dv-sign" aria-hidden>
                    {r.t === 'add' ? '+' : r.t === 'del' ? '−' : ''}
                  </span>
                  {r.text}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    );
  }
  return (
    <table className="dv-tbl dv-split" aria-label={`Changes in ${f.path}`}>
      <colgroup>
        <col className="dv-c-no" />
        <col />
        <col className="dv-c-no" />
        <col />
      </colgroup>
      <tbody>
        {f.rows.map((r: Row, i) =>
          r.kind === 'hunk' ? (
            <tr key={i} className="dv-hunk">
              <td colSpan={4}>
                <span>{hunkLabel(r.text)}</span>
              </td>
            </tr>
          ) : (
            <tr key={i} className={r.ctx ? 'ctx' : ''}>
              <td className={`dv-no ${r.l && !r.ctx ? 'del' : ''} ${r.l ? '' : 'empty'}`}>
                {r.l?.no ?? ''}
              </td>
              <td className={`dv-code left ${r.l ? (r.ctx ? '' : 'del') : 'empty'}`}>
                {r.l ? (
                  <>
                    <span className="dv-sign" aria-hidden>
                      {r.ctx ? '' : '−'}
                    </span>
                    {r.l.text}
                  </>
                ) : null}
              </td>
              <td className={`dv-no ${r.r && !r.ctx ? 'add' : ''} ${r.r ? '' : 'empty'}`}>
                {r.r?.no ?? ''}
              </td>
              <td className={`dv-code ${r.r ? (r.ctx ? '' : 'add') : 'empty'}`}>
                {r.r ? (
                  <>
                    <span className="dv-sign" aria-hidden>
                      {r.ctx ? '' : '+'}
                    </span>
                    {r.r.text}
                  </>
                ) : null}
              </td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

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
        <label className="dv-cmp">
          <span>Compare with</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            title={DIFF_TARGETS.find((x) => x[0] === target)?.[2]}
          >
            {DIFF_TARGETS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
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
                  <select
                    className="dv-fsel"
                    value={cur.path}
                    onChange={(e) => pick(e.target.value)}
                    aria-label="File"
                  >
                    {files.map((f) => (
                      <option key={f.path} value={f.path}>
                        {f.path}
                      </option>
                    ))}
                  </select>
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
