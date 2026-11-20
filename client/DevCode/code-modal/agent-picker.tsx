'use client';
// Which agent writes the code, with what the chosen one does.
import type { Any } from '../../core';
import { Ico, I } from '../../ui';
import type { CodeJobs } from './use-code-jobs';

function AgentOption({ a, cj }: { a: Any; cj: CodeJobs }) {
  const on = cj.agentId === a.id;
  return (
    <button
      role="radio"
      aria-checked={on}
      className={`${on ? 'on' : ''} ph-${String(a.phase).toLowerCase()}`}
      disabled={!a.enabled}
      onClick={() => cj.setAgentId(a.id)}
      title={a.does.join(' ')}
    >
      <span className="agent-icon sm" aria-hidden>
        {a.icon}
      </span>
      <span className="ap-text">
        <b>{a.name}</b>
        <span className="muted small">
          {a.summary}
          {!a.enabled ? ' (turned off)' : ''}
        </span>
        <span className="ap-meta">
          {a.workspaceLabel} · {a.model}
          {a.effort ? ` · ${a.effort}` : ''}
        </span>
      </span>
    </button>
  );
}

export function AgentPicker({ cj }: { cj: CodeJobs }) {
  const { agents } = cj;
  if (!agents.length) return null;
  const chosen = agents.find((x: Any) => x.id === cj.agentId);
  return (
    <>
      <div className="pick-label small">Which agent?</div>
      {!agents.some((a: Any) => a.writes && a.enabled) && (
        <div className="warn-banner" style={{ marginBottom: 8 }}>
          <Ico svg={I.warn} />
          <span>
            No agent can write code yet. Create one in Administration → Agents (kind: <b>Code</b>).
          </span>
        </div>
      )}
      <div className="agent-pick" role="radiogroup" aria-label="Agent">
        {agents
          .filter((a: Any) => !['review', 'review-panel'].includes(a.id))
          .map((a: Any) => (
            <AgentOption key={a.id} a={a} cj={cj} />
          ))}
      </div>
      {chosen && (
        <ul className="ap-does small">
          {chosen.does.map((x: string) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
    </>
  );
}
