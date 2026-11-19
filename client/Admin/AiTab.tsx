'use client';
// Administration → AI: the section list and the chosen section. The AI page's own sections are in
// client/Admin/ai-tab/.
import { useSection, ErrorState, SectionNav } from '../ui';
import { getAiSettings } from '../api/admin';
import { RoutingSection } from '../AiRouting';
import { ConfigsSection } from '../AiConfigs';
import { AiFlow } from '../AiFlow';
import { DecisionsSection } from '../Jev';
import { A } from './UsersTab';
import { applyAi } from './ProviderModal';
import { AI_SECTIONS, aiNavItems } from './ai-tab/nav';
import { ConnectionSection } from './ai-tab/connection';
import { LocalSection, ProvidersSection, flowActions } from './ai-tab/other-sections';

const ROUTING_PARTS = ['routing', 'models', 'usage', 'savings'];

function NotReported() {
  return (
    <div className="card">
      <ErrorState
        compact
        title="Couldn’t check the AI connection"
        onRetry={async () => applyAi(await getAiSettings(true))}
      >
        <p>The server didn’t report how TicketForge connects to AI.</p>
      </ErrorState>
    </div>
  );
}

export function AiTab() {
  const c = A.ai;
  const [sec, setSec] = useSection('tf.adminAiSec', AI_SECTIONS, 'flow');
  if (!c) return <NotReported />;
  return (
    <div className="sec-layout">
      <SectionNav label="AI settings" items={aiNavItems(c)} value={sec} onChange={setSec} />
      <div className="sec-body">
        {sec === 'flow' && <AiFlow c={c} actions={flowActions(c, setSec)} />}
        {ROUTING_PARTS.includes(sec) && (
          <RoutingSection
            key={`${sec}${JSON.stringify(c.settings?.routing)}`}
            c={c}
            onSaved={applyAi}
            part={sec as 'routing' | 'models' | 'usage' | 'savings'}
            go={setSec}
          />
        )}
        {sec === 'local' && c.copilot && <LocalSection c={c} />}
        {sec === 'decisions' && <DecisionsSection />}
        {sec === 'configs' && <ConfigsSection c={c} onSaved={applyAi} />}
        {sec === 'providers' && <ProvidersSection c={c} />}
        {sec === 'connection' && <ConnectionSection c={c} go={setSec} />}
      </div>
    </div>
  );
}
