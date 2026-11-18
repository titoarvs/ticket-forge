'use client';
// Diff review (TF-121): what a code-with-AI job changed, as a GitHub-style side-by-side diff with a file list and a choice
// of what to compare with (the previous job run, the repository default branch or the prior spec version). Anyone who can
// open the project sees it. The diff is always side by side: on narrow screens it scrolls sideways instead. Layout is CSS
// only (see .dv in globals.css), so resizing never remounts it and the chosen comparison stays.
import { useEffect, useMemo, useRef, useState } from 'react';
import { P, api, type Any } from './core';
import { Ico, I, Spinner, EmptyState, ErrorState } from './ui';
import { parseDiff, type DiffFile, type Row } from './logic/diff';

export const DIFF_TARGETS: [string, string, string][] = [
  ['default', 'Repository default branch', 'Everything this job changed compared with the default branch'],
  ['job', 'Previous job run', 'What changed since the last code run for this issue'],
  ['spec', 'Prior spec version', 'What changed since the last run made before the current spec'],
];
const targetLabel = (t: string) => DIFF_TARGETS.find((x) => x[0] === t)?.[1] || t;

/** One file's side-by-side table. It sits in its own scroller, so a long line scrolls sideways inside the page. */
function FileDiff({ f }: { f: DiffFile }) {
  if (f.binary) return <p className="muted small dv-note">Binary file not shown.</p>;
  if (!f.rows.length) return <p className="muted small dv-note">{f.status === 'added' ? 'Empty file added.' : 'No line changes (mode or name only).'}</p>;
  return (
    <div className="dv-scroll" tabIndex={0} role="region" aria-label={`Changes in ${f.path}, scroll sideways for long lines`}>
      <table className="dv-tbl">
        <colgroup><col className="dv-c-no" /><col className="dv-c-code" /><col className="dv-c-no" /><col className="dv-c-code" /></colgroup>
        <tbody>{f.rows.map((r: Row, i) => r.kind === 'hunk'
          ? <tr key={i} className="dv-hunk"><td colSpan={4}>{r.text}</td></tr>
          : <tr key={i}>
            <td className={`dv-no ${r.l && !r.ctx ? 'del' : ''}`}>{r.l?.no ?? ''}</td>
            <td className={`dv-code ${r.l ? (r.ctx ? '' : 'del') : 'empty'}`}>{r.l ? <><span className="dv-sign" aria-hidden>{r.ctx ? ' ' : '−'}</span>{r.l.text}</> : null}</td>
            <td className={`dv-no ${r.r && !r.ctx ? 'add' : ''}`}>{r.r?.no ?? ''}</td>
            <td className={`dv-code ${r.r ? (r.ctx ? '' : 'add') : 'empty'}`}>{r.r ? <><span className="dv-sign" aria-hidden>{r.ctx ? ' ' : '+'}</span>{r.r.text}</> : null}</td>
          </tr>)}</tbody>
      </table>
    </div>
  );
}

/** The diff of one code job (`job`: id, projectId, status). `defaultTarget` is the comparison shown first. */
export function DiffReview({ job, defaultTarget = 'default' }: { job: Any; defaultTarget?: string }) {
  const [target, setTarget] = useState(defaultTarget);
  const [res, setRes] = useState<Any>(null);
  const [error, setError] = useState<Any>(null);
  const [shut, setShut] = useState<Set<string>>(new Set());
  const seq = useRef(0);
  const pid = job.projectId || P()?.id;

  const load = async (t: string) => {
    const mine = ++seq.current;
    setRes(null); setError(null);
    try {
      const r = await api(`/api/projects/${encodeURIComponent(pid)}/code?jobId=${encodeURIComponent(job.id)}&compare=${encodeURIComponent(t)}`);
      if (mine === seq.current) setRes(r);
    } catch (e: Any) { if (mine === seq.current) setError(e); }
  };
  // Recalculates for the chosen target; the earlier answer is dropped so a slow one can't replace a newer choice.
  useEffect(() => { load(target); return () => { seq.current++; }; }, [job.id, job.finishedAt, job.rounds, target]); // eslint-disable-line react-hooks/exhaustive-deps

  const files = useMemo(() => (res?.diff ? parseDiff(res.diff) : []), [res]);
  const nodes = useRef<Record<string, HTMLElement | null>>({});
  const add = files.reduce((n, f) => n + f.added, 0), del = files.reduce((n, f) => n + f.removed, 0);
  const go = (path: string) => { setShut((s) => { const n = new Set(s); n.delete(path); return n; }); setTimeout(() => nodes.current[path]?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0); };
  const toggle = (path: string) => setShut((s) => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n; });

  return (
    <section className="dv" aria-label="Code changes">
      <div className="dv-bar">
        <span className="dv-bar-l small"><b>Compare with</b></span>
        <div className="dv-targets" role="radiogroup" aria-label="Compare the AI changes with">
          {DIFF_TARGETS.map(([k, l, tip]) => <button key={k} type="button" role="radio" aria-checked={target === k} className={`dv-target ${target === k ? 'on' : ''}`} title={tip} onClick={() => setTarget(k)}>{l}</button>)}
        </div>
      </div>
      <p className="dv-active small" aria-live="polite">
        Showing the AI output against <b>{targetLabel(target)}</b>{res?.against ? <> · <code>{res.against}</code></> : null}
        {res?.available && files.length > 0 && <span className="dv-sum"> · {files.length} file{files.length === 1 ? '' : 's'} <span className="da">+{add}</span> <span className="dr">−{del}</span></span>}
      </p>
      {error ? <ErrorState compact title="Couldn’t load the changes" error={error} onRetry={() => load(target)} />
        : !res ? <div className="muted small dv-note" role="status"><Spinner /> Loading the changes…</div>
        : !res.available ? <EmptyState compact icon={I.clock} tone="neutral" title="Nothing to compare with"><p>{res.reason}</p></EmptyState>
        : !files.length ? <EmptyState compact icon={I.check} tone="neutral" title="No changes"><p>The AI output matches {targetLabel(target).toLowerCase()}.</p></EmptyState>
        : <div className="dv-body">
          <nav className="dv-files" aria-label="Changed files">
            <ul>{files.map((f) => <li key={f.path}><button type="button" onClick={() => go(f.path)} title={f.path}>
              <span className={`dv-st ${f.status}`} aria-label={f.status}>{f.status === 'added' ? 'A' : f.status === 'deleted' ? 'D' : 'M'}</span>
              <code>{f.path}</code><span className="da">+{f.added}</span><span className="dr">−{f.removed}</span></button></li>)}</ul>
          </nav>
          <div className="dv-list">{files.map((f) => {
            const open = !shut.has(f.path);
            return <div key={f.path} className="dv-file" ref={(el) => { nodes.current[f.path] = el; }}>
              <button type="button" className="dv-file-h" aria-expanded={open} onClick={() => toggle(f.path)}>
                <Ico svg={I.chevron} className={open ? '' : 'closed'} /><code>{f.path}</code><span className="spacer" /><span className="da">+{f.added}</span><span className="dr">−{f.removed}</span></button>
              {open && <FileDiff f={f} />}
            </div>;
          })}</div>
        </div>}
    </section>
  );
}
