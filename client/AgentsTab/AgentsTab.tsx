'use client';
// Administration → Agents: the counts, the default agents, filters, and the agents as cards or a
// list. The parts are in client/AgentsTab/tab/.
import { ErrorState } from '../ui';
import { DefaultAgents } from './BuiltInsModal';
import { useAgentsTab } from './tab/use-agents-tab';
import { LoadingGrid, AgentsHead, Stats, NoAgents } from './tab/head';
import { AgentsToolbar } from './tab/toolbar';
import { AgentViews } from './tab/agent-views';

export function AgentsTab() {
  const g = useAgentsTab();
  if (g.err)
    return (
      <div className="card">
        <ErrorState compact title="Couldn’t load the agents" error={g.err} onRetry={g.load} />
      </div>
    );
  if (!g.data) return <LoadingGrid />;
  const any = g.all.length > 0;
  return (
    <div className="ag-page">
      <AgentsHead g={g} />
      <Stats all={g.all} />
      <DefaultAgents data={g.data} onData={g.onData} />
      {!any && <NoAgents g={g} />}
      {any && <AgentsToolbar g={g} />}
      {any && <AgentViews g={g} />}
    </div>
  );
}
