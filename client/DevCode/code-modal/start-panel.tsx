'use client';
// Before a job runs: pick the agent, add instructions, and start it (or both repositories at once).
import { useState } from 'react';
import { type Any, api, toast } from '../../core';
import { Spinner, Ico, I } from '../../ui';
import { TA } from '../../fields';
import { refreshCodeStatus } from '../../codeStatus';
import { be, myPath } from '../FolderPicker';
import { dev } from '../dev';
import type { CodeJobs } from './use-code-jobs';
import { AgentPicker } from './agent-picker';

type StartProps = { t: Any; cj: CodeJobs; setContract: (c: string) => void };

/** What the agent will work from and where its branch goes. */
function JobIntro({ t }: { t: Any }) {
  const d = dev();
  return (
    <p className="muted small" style={{ marginTop: 0 }}>
      It runs as a Claude Code agent on <b>{t.title}</b> from its story,{' '}
      {t.acceptanceCriteria?.length || 0} acceptance criteria and {t.testCases?.length || 0} test
      cases, in a new branch{' '}
      <code>
        {d.branchPrefix ?? 'tf/'}
        {String(t.key).toLowerCase()}-…
      </code>{' '}
      from <code>{d.baseBranch || 'the default branch'}</code> of <b>{d.repo || d.localPath}</b>, in
      its own worktree. Nothing is pushed until you review the changes and open the pull request.
    </p>
  );
}

/** Frontend + Backend issue: agree the API, then build both repositories in parallel. */
function BuildBoth({ t, cj, setContract, text }: StartProps & { text: string }) {
  const start = async () => {
    cj.setBusy('both');
    try {
      const r = await api(cj.base, {
        method: 'POST',
        body: { action: 'start-both', ticketId: t.id, instructions: text },
      });
      refreshCodeStatus();
      cj.setJobs((js) => ({ ...js, ...r.jobs }));
      setContract(r.contract || '');
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      cj.setBusy('');
    }
  };
  return (
    <div className="both-box">
      <div>
        <b>Build both at once</b>
        <span className="muted small">
          Agrees the API in a few seconds, then the backend and frontend agents work in parallel,
          each in its own repository. About twice as fast as one after the other.
        </span>
      </div>
      <button className="btn ai" disabled={!!cj.busy} onClick={start}>
        {cj.busy === 'both' ? (
          <>
            <Spinner />
            Agreeing the API…
          </>
        ) : (
          <>
            <Ico svg={I.sparkle} />
            Build both at once
          </>
        )}
      </button>
    </div>
  );
}

function BackendNotDone({ cj }: { cj: CodeJobs }) {
  return (
    <div className="warn-banner" style={{ marginBottom: 8 }}>
      <Ico svg={I.warn} />
      <span>
        The backend part isn’t done yet. You can start the frontend now, but it won’t know the final
        API.
      </span>
      <button
        className="btn sm"
        style={{ marginLeft: 'auto' }}
        onClick={() => cj.setSide('backend')}
      >
        Go to Backend
      </button>
    </div>
  );
}

function BackendWhere() {
  const b = be();
  return (
    <p className="small muted" style={{ marginTop: 0 }}>
      Runs in <code>{myPath('backend')}</code>
      {b.repo ? (
        <>
          {' '}
          · {b.provider === 'GitLab' ? 'merge request on GitLab' : 'pull request on GitHub'}{' '}
          <code>{b.repo}</code>
        </>
      ) : (
        ''
      )}
      .
    </p>
  );
}

export function StartPanel({ t, cj, setContract }: StartProps) {
  const [text, setText] = useState('');
  const { jobs, backend, side, busy, agentId } = cj;
  const idle = (k: string) => !jobs[k] || jobs[k].status === 'discarded';
  const canBoth = backend && t.layer === 'both' && idle('backend') && idle('frontend');
  const backendBusyOrDone = ['committed', 'review', 'starting', 'running'].includes(
    jobs.backend?.status,
  );
  const start = () =>
    cj.act('start', { action: 'start', ticketId: t.id, instructions: text, agentId, side });
  return (
    <>
      <AgentPicker cj={cj} />
      <JobIntro t={t} />
      <label className="field">
        <span>Extra instructions (optional)</span>
        <TA
          rows={4}
          value={text}
          placeholder="e.g. Put the API in app/api/payslips. Reuse the PayslipTable component. Add a Vitest test."
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {canBoth && <BuildBoth t={t} cj={cj} setContract={setContract} text={text} />}
      {backend && side === 'frontend' && t.layer === 'both' && !canBoth && !backendBusyOrDone && (
        <BackendNotDone cj={cj} />
      )}
      {backend && side === 'backend' && <BackendWhere />}
      <button className="btn ai" disabled={!!busy} onClick={start}>
        {busy ? (
          <>
            <Spinner />
            Starting…
          </>
        ) : (
          <>
            <Ico svg={I.sparkle} />
            {agentId === 'feature-tests' ? 'Write the tests' : 'Start the agent'}
          </>
        )}
      </button>
    </>
  );
}
