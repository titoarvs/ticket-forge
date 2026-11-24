'use client';
// Code jobs → Office: the terminal for one job. Streams the job's log (what the agent says, the
// tools it runs, warnings and errors) from /api/projects/:id/code?jobId=…&since=N, a few lines at
// a time while the job runs; a finished job shows its whole log. Sticks to the bottom unless you
// scroll up to read.
import { useEffect, useRef, useState } from 'react';
import { type Any, api } from '../core';
import { LIVE, LABEL } from './TicketContext';
import { MaxButton } from '../Office/OfficePanels';

type Line = { at: string; kind: string; text: string };

const PROMPT: Record<string, string> = {
  tool: '$',
  error: '✖',
  warn: '!',
  done: '✔',
  text: '›',
  info: '·',
};
const time = (at: string) => {
  const d = new Date(at);
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

/** The job's log, kept up to date while it runs. */
function useJobLog(j: Any) {
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState<string>(j.status);
  const [err, setErr] = useState('');
  useEffect(() => {
    let on = true;
    let size = 0;
    let timer: Any = null;
    setLines([]);
    setErr('');
    const tick = async () => {
      try {
        const r = await api(
          `/api/projects/${j.projectId}/code?jobId=${encodeURIComponent(j.id)}&since=${size}`,
        );
        if (!on) return;
        size = r.logSize ?? size + (r.log || []).length;
        if (r.log?.length) setLines((l) => [...l, ...r.log].slice(-2000));
        setStatus(r.status);
        if (LIVE.includes(r.status)) timer = setTimeout(tick, 1500);
      } catch (e: Any) {
        if (on) setErr(e.message || 'Couldn’t load the log');
      }
    };
    tick();
    return () => {
      on = false;
      clearTimeout(timer);
    };
  }, [j.id, j.projectId]);
  return { lines, status, err };
}

type Props = { j: Any; onClose: () => void; max?: boolean; onMax?: () => void };

/** max: filling the office (full view); onMax flips it. */
export function JobTerminal({ j, onClose, max = false, onMax }: Props) {
  const { lines, status, err } = useJobLog(j);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const live = LIVE.includes(status);
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  const onScroll = () => {
    const el = box.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  return (
    <section
      className={`of-term ${max ? 'of-maxed' : ''}`}
      aria-label={`Terminal for ${j.ticketKey}`}
    >
      <header>
        <span className="of-term-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <b>
          {j.ticketKey} · {j.agentName || 'agent'}
        </b>
        <span className={`of-term-st ${live ? 'live' : ''}`}>
          {live && <i aria-hidden />}
          {LABEL[status] || status}
        </span>
        {onMax && <MaxButton max={max} onClick={onMax} what="terminal" />}
        <button className="of-x sm" aria-label="Close terminal" onClick={onClose}>
          ×
        </button>
      </header>
      <div
        ref={box}
        className="of-term-body"
        onScroll={onScroll}
        role="log"
        aria-live={live ? 'polite' : 'off'}
      >
        {j.branch && <div className="of-tl info">{`# ${j.branch}`}</div>}
        {lines.map((l, i) => (
          <div key={i} className={`of-tl ${l.kind}`}>
            <span className="t">{time(l.at)}</span>
            <span className="p">{PROMPT[l.kind] || '·'}</span>
            <span className="x">{l.text}</span>
          </div>
        ))}
        {!lines.length && !err && <div className="of-tl info">Waiting for output…</div>}
        {err && <div className="of-tl error">{err}</div>}
        {live && <span className="of-term-cursor" aria-hidden />}
      </div>
    </section>
  );
}
