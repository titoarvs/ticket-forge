'use client';
// Administration → Generation. This component only puts the sections in
// client/GenerationTab/sections/ together.
import { useSection, ErrorState, I, SectionNav, Loading, Sk } from '../ui';
import { GuideCard } from '../GuideCard';
import { AiTold } from '../AiTold';
import { TeamTemplateCards } from '../EpicDocs';
import { type Rules, useGenerationRules } from './sections/use-rules';
import { GeneralSection } from './sections/general';
import { TicketsSection } from './sections/tickets';
import { TestsSection } from './sections/tests';
import { TestMgmtSection } from './sections/test-mgmt';
import { SaveBar } from './sections/save-bar';

const SECTIONS = ['general', 'tickets', 'tests', 'testmgmt', 'documents', 'prompts'];

function LoadingRules() {
  return (
    <Loading>
      <div className="card">
        <Sk w={180} h={16} />
        <Sk w="60%" h={10} style={{ margin: '10px 0 20px' }} />
        {[0, 1, 2, 3].map((i) => (
          <Sk key={i} h={36} style={{ marginBottom: 12 }} />
        ))}
      </div>
    </Loading>
  );
}

/** The section list; a dot marks sections with unsaved changes. */
function navItems(g: Rules) {
  const dot = (keys: string[]) =>
    g.changed(keys) ? <span className="gen-dot" title="Unsaved changes" /> : null;
  return [
    {
      key: 'general',
      label: 'General',
      hint: 'Thinking level and team rules',
      icon: I.sparkle,
      badge: dot(['reasoning', 'stickToDocument', 'custom']),
    },
    {
      key: 'tickets',
      label: 'Tickets',
      hint: 'Titles, criteria, points, types',
      icon: I.backlog,
      badge: dot(['tickets']),
    },
    {
      key: 'tests',
      label: 'Test cases & scripts',
      hint: 'Test cases on issues, Playwright',
      icon: I.test,
      badge: dot(['tests', 'automation']),
    },
    {
      key: 'testmgmt',
      label: 'Test management',
      hint: 'Corporate test standard',
      icon: I.check,
      badge: dot(['testmgmt']),
    },
    { key: 'documents', label: 'Documents', hint: 'Guide and document templates', icon: I.doc },
    {
      key: 'prompts',
      label: 'What the AI is told',
      hint: 'Preview of every prompt',
      icon: I.summary,
    },
  ];
}

export function GenerationTab() {
  const g = useGenerationRules();
  const [sec, setSec] = useSection('tf.adminGenSec', SECTIONS, 'general');
  if (g.err)
    return (
      <div className="card">
        <ErrorState
          compact
          title="Couldn’t load the generation rules"
          error={g.err}
          onRetry={g.load}
        />
      </div>
    );
  if (!g.r || !g.data) return <LoadingRules />;
  return (
    <div className="gen sec-layout">
      <SectionNav label="Generation settings" items={navItems(g)} value={sec} onChange={setSec} />
      <div className="sec-body">
        {sec === 'general' && <GeneralSection g={g} />}
        {sec === 'tickets' && <TicketsSection g={g} />}
        {sec === 'tests' && <TestsSection g={g} />}
        {sec === 'testmgmt' && <TestMgmtSection g={g} />}
        {sec === 'documents' && (
          <div className="cards">
            <GuideCard onChange={g.refreshPrompts} />
            <TeamTemplateCards />
          </div>
        )}
        {sec === 'prompts' && (
          <div className="cards">
            <AiTold prompts={g.prompts} />
          </div>
        )}
        <SaveBar g={g} />
      </div>
    </div>
  );
}
