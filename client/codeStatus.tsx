'use client';
// Coding indicators: which issues have AI-written code, and in what state (writing now, ready for review, pull
// request open, merged, committed, failed). Shown on backlog rows, board cards and the issue panel. The state comes
// from the project's code jobs (this computer and GitHub Actions) and from the issue's linked pull requests, and is
// refreshed every few seconds while a job is running.
import { S, emit, api, P, isDone, can, feat, type Any } from './core';
import { Ico, I, Spinner } from './ui';

type Job = { id: string; ticketId: string; status: string; side?: string; agentName?: string; startedAt?: string; where?: string; pr?: Any };
const G: { pid: string; byTicket: Record<string, Job[]>; at: number; timer: Any; busy: boolean } = { pid: '', byTicket: {}, at: 0, timer: null, busy: false };
const LIVE = ['starting', 'queued', 'running'];

export type CodeInfo = { state: '' | 'working' | 'review' | 'pr' | 'merged' | 'committed' | 'failed'; label: string; title: string; coded: boolean };
const NONE: CodeInfo = { state: '', label: '', title: '', coded: false };

/** The coding state of an issue, from its code jobs and linked pull requests. */
export function codeInfo(t: Any): CodeInfo {
  const jobs = (G.pid === P()?.id ? G.byTicket[t.id] : null) || [];
  const live = jobs.filter((j) => LIVE.includes(j.status));
  const prs: Any[] = t.prs || [];
  const merged = prs.some((r) => r.status === 'Merged');
  const open = prs.some((r) => ['Open', 'Draft'].includes(r.status)) || jobs.some((j) => j.status === 'pr' && !merged);
  if (live.length) {
    const j = live[0];
    return { state: 'working', label: j.status === 'queued' ? 'Waiting' : 'Coding', title: `${j.agentName || 'The AI agent'} ${j.status === 'queued' ? 'is waiting for a free slot to write' : 'is writing'} code for ${t.key}${j.where === 'github' ? ' on GitHub Actions' : ''}`, coded: false };
  }
  if (merged) return { state: 'merged', label: isDone(t) ? 'Coded' : 'Merged', title: `The pull request for ${t.key} is merged${isDone(t) ? ': the issue is done and its code is in' : ''}`, coded: true };
  if (open) return { state: 'pr', label: isDone(t) ? 'Coded · PR' : 'PR open', title: `${t.key} has code in an open pull request${isDone(t) ? ' and the issue is marked done' : ''}`, coded: true };
  const review = jobs.find((j) => ['review', 'report'].includes(j.status));
  if (review) return { state: 'review', label: 'Code ready', title: `AI wrote code for ${t.key}: ready for you to review and open the pull request`, coded: true };
  if (jobs.some((j) => j.status === 'committed')) return { state: 'committed', label: isDone(t) ? 'Coded' : 'Committed', title: `AI code for ${t.key} is committed on a local branch (not pushed)`, coded: true };
  const newest = jobs[0];
  if (newest && newest.status === 'failed') return { state: 'failed', label: 'Code failed', title: `The last code job for ${t.key} failed. Open the issue to see why and try again.`, coded: false };
  return NONE;
}
/** Goes into a row's redraw signature, so rows redraw when their coding state changes. */
export const codeSig = (t: Any) => { const c = codeInfo(t); return c.state ? `${c.state}${c.label}` : ''; };

export function CodeChip({ t, compact = false }: { t: Any; compact?: boolean }) {
  const c = codeInfo(t);
  if (!c.state) return null;
  const icon = c.state === 'working' ? <Spinner /> : <Ico svg={c.state === 'failed' ? I.warn : c.state === 'merged' || c.coded && isDone(t) ? I.check : c.state === 'review' ? I.sparkle : I.pr} />;
  return <span className={`code-ind c-${c.state} ${c.coded && isDone(t) ? 'is-done' : ''}`} title={c.title}>{icon}{!compact && c.label}</span>;
}

async function load(pid: string) {
  if (G.busy) return;
  G.busy = true;
  try {
    const r = await api(`/api/code-jobs?project=${encodeURIComponent(pid)}`);
    const by: Record<string, Job[]> = {};
    for (const j of r.jobs || []) (by[j.ticketId] ||= []).push(j);
    const before = JSON.stringify(G.byTicket);
    G.pid = pid; G.byTicket = by; G.at = Date.now();
    if (JSON.stringify(by) !== before) emit();
    return (r.jobs || []).some((j: Job) => LIVE.includes(j.status));
  } catch { return false; } finally { G.busy = false; }
}

/** Refresh now (after starting, stopping or finishing a job). */
export function refreshCodeStatus() { const pid = P()?.id; if (pid && G.pid === pid) load(pid).catch(() => {}); }

/** Starts keeping the open project's coding state fresh: every 4 s while something is running, else every 30 s. */
export function watchCodeStatus(pid: string) {
  stopWatching();
  if (!pid || !can('ai.use') || !feat('code')) { G.pid = pid; G.byTicket = {}; return; }
  let on = true;
  const tick = async () => {
    if (!on) return;
    const live = document.visibilityState === 'visible' ? await load(pid) : false;
    if (on) G.timer = setTimeout(tick, live ? 4000 : 30000);
  };
  tick();
  G.timer = null;
  (G as Any).stop = () => { on = false; clearTimeout(G.timer); };
}
export function stopWatching() { (G as Any).stop?.(); (G as Any).stop = null; clearTimeout(G.timer); }
