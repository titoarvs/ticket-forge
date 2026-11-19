'use client';
// The code jobs of one issue: loading them, following the running ones, and asking the server to
// act on the job shown. Projects with a separate backend have one job per repository (side).
import { useState, useEffect } from 'react';
import { type Any, P, api, toast } from '../../core';
import { refreshCodeStatus } from '../../codeStatus';
import { saveReview } from '../../CodeRabbit';
import { hasBackend } from '../FolderPicker';

export const isRunning = (j: Any) =>
  Boolean(j) && ['starting', 'queued', 'running'].includes(j.status);

/** "Both" issues start with the backend. */
const firstSide = (t: Any, initialSide?: string) =>
  initialSide ||
  (hasBackend() && (t.layer === 'backend' || t.layer === 'both') ? 'backend' : 'frontend');

/** Polls every running job (both repositories when they run at once) and appends the new log lines. */
function usePollJobs(base: string, jobs: Record<string, Any>, setJobs: (f: Any) => void) {
  useEffect(() => {
    const live = Object.entries(jobs).filter(
      ([, j]) => j && (isRunning(j) || j.coderabbit?.status === 'running'),
    );
    if (!live.length) return;
    const poll = async () => {
      const got = await Promise.all(
        live.map(async ([k, j]) => {
          try {
            return [k, j.id, await api(`${base}?jobId=${j.id}&since=${j.logSize || 0}`)] as const;
          } catch {
            return null;
          }
        }),
      );
      setJobs((js: Record<string, Any>) => {
        const next = { ...js };
        for (const g of got) {
          if (!g) continue;
          const [k, id, r] = g;
          if (next[k]?.id !== id) continue;
          next[k] = { ...r, log: [...(next[k]?.log || []), ...r.log] };
        }
        return next;
      });
    };
    const h = setTimeout(poll, live.some(([, j]) => j.remote) ? 6000 : 1500);
    return () => clearTimeout(h);
  }, [jobs]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useCodeJobs(t: Any, initialAgent: string, initialSide?: string) {
  const [jobs, setJobs] = useState<Record<string, Any>>({});
  const [backend, setBackend] = useState(hasBackend());
  const [side, setSide] = useState<string>(firstSide(t, initialSide));
  const [agents, setAgents] = useState<Any[]>([]);
  const [agentId, setAgentId] = useState(initialAgent);
  const [roles, setRoles] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const base = `/api/projects/${P().id}/code`;
  const job = jobs[side] || null;
  const setJob = (v: Any) =>
    setJobs((js) => ({ ...js, [side]: typeof v === 'function' ? v(js[side]) : v }));

  useEffect(() => {
    api(`${base}?ticketId=${t.id}`)
      .then((r) => {
        setJobs(r.jobs || { frontend: r.job });
        setBackend(Boolean(r.backend));
        setAgents(r.agents || []);
        setRoles(r.roles || {});
        if (initialAgent === 'build' && r.roles?.build) setAgentId(r.roles.build);
        // A "both" issue whose backend is done: open on the frontend.
        const backendDone = ['committed', 'review'].includes(r.jobs?.backend?.status);
        if (r.backend && t.layer === 'both' && backendDone && !r.jobs?.frontend)
          setSide('frontend');
      })
      .catch((e) => toast(e.message, 'err'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // With two repositories, default to that repository's agent (Administration → Agents → Default
  // agents), unless an agent was chosen for you.
  useEffect(() => {
    if (backend && initialAgent === 'build' && roles[side]) setAgentId(roles[side]);
  }, [side, backend, roles]); // eslint-disable-line react-hooks/exhaustive-deps
  usePollJobs(base, jobs, setJobs);
  // A finished CodeRabbit review is saved on the issue (findings, then their status: bug, sent to
  // agent, dismissed).
  useEffect(() => {
    if (job?.coderabbit?.status === 'done') saveReview(t, job);
  }, [job?.coderabbit?.status, job?.coderabbit?.round]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Asks the server to act on the job shown; returns its answer, or null when it failed. */
  const act = async (kind: string, body: Any) => {
    setBusy(kind);
    try {
      const r = await api(base, { method: 'POST', body: { ...body, jobId: job?.id } });
      refreshCodeStatus();
      if (r?.id)
        setJob((j: Any) => ({
          ...r,
          log: kind === 'start' ? r.log : [...(j?.log || []), ...r.log.slice(j?.logSize ?? 0)],
        }));
      return r;
    } catch (e: Any) {
      toast(e.message, 'err');
      return null;
    } finally {
      setBusy('');
    }
  };
  /** Reads the job again (e.g. the approval count after a blocked merge). */
  const reloadJob = async () => {
    try {
      const r = await api(`${base}?jobId=${job.id}&since=${job.logSize || 0}`);
      setJob((j: Any) => ({ ...r, log: [...(j?.log || []), ...r.log] }));
    } catch {
      /* the next poll or reopening shows it */
    }
  };
  return {
    jobs,
    setJobs,
    job,
    setJob,
    side,
    setSide,
    backend,
    agents,
    agentId,
    setAgentId,
    roles,
    loading,
    busy,
    setBusy,
    base,
    act,
    reloadJob,
    running: isRunning(job),
  };
}
export type CodeJobs = ReturnType<typeof useCodeJobs>;
