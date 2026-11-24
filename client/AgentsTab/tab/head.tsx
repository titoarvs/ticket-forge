'use client';
// The top of the Agents page: title and who last changed the agents, Built-in agents and Create
// agent, the counts, the loading placeholder, and the page when every agent is removed.
import { type Any, ago, can } from '../../core';
import { Loading, Sk, Ico, I, EmptyState } from '../../ui';
import { statsOf } from './filter';
import { openBuiltIns, openCreate } from './open';
import type { AgentsPage } from './use-agents-tab';

export function LoadingGrid() {
  return (
    <Loading>
      <div className="agent-grid">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="agent-card">
            <div className="agent-head">
              <Sk w={44} h={44} r={12} />
              <div>
                <Sk w={140} h={14} />
                <Sk w={60} h={10} style={{ marginTop: 6 }} />
              </div>
            </div>
            <Sk w="90%" h={10} />
            <Sk w="60%" h={10} />
          </div>
        ))}
      </div>
    </Loading>
  );
}

export function AgentsHead({ g }: { g: AgentsPage }) {
  const { data } = g;
  return (
    <div className="ag-head">
      <div>
        <h2>Agents</h2>
        <p className="muted small">
          AI teammates for each step of a feature: plan, build, review, test and release. Turn them
          on or off, tune their model and instructions, or create your own.
          {data.updatedAt && (
            <>
              {' '}
              Last changed by {data.updatedBy || 'an administrator'} {ago(data.updatedAt)}.
            </>
          )}
        </p>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" onClick={() => openBuiltIns(g)}>
          Built-in agents{data.removed?.length ? ` (${data.removed.length} removed)` : ''}
        </button>
        {can('ai.use') && (
          <button className="btn primary" onClick={() => openCreate(g)}>
            <Ico svg={I.plus} />
            Create agent
          </button>
        )}
      </div>
    </div>
  );
}

export function Stats({ all }: { all: Any[] }) {
  return (
    <div className="ag-stats">
      {statsOf(all).map(([l, n, tone]) => (
        <div key={l} className={`ag-stat ${tone}`}>
          <b>{n}</b>
          <span>{l}</span>
        </div>
      ))}
    </div>
  );
}

export function NoAgents({ g }: { g: AgentsPage }) {
  const actions = can('ai.use') ? (
    <>
      <button className="btn primary" onClick={() => openCreate(g, '__repo')}>
        <Ico svg={I.sparkle} />
        Start with the Repo-native Builder
      </button>
      <button className="btn" onClick={() => openCreate(g)}>
        <Ico svg={I.plus} />
        Create your own
      </button>
    </>
  ) : null;
  return (
    <EmptyState icon={I.bot} tone="neutral" title="No agents yet" actions={actions}>
      <p>
        All built-in agents are removed. Create your own: describe what it should do and the AI
        writes its rules, or start from a template. Restore built-in agents any time from{' '}
        <b>Built-in agents</b>.
      </p>
    </EmptyState>
  );
}
