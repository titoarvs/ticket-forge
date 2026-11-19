'use client';
// Reviewing a repository sync before anything changes: test cases, delivered work and pages, each
// change ticked in or out. The parts are in client/RepoSync/sync-review/.
import { useState } from 'react';
import { type Any, P } from '../core';
import { Modal } from '../ui';
import { appSetup } from '../AppSetup';
import { pageDiff, initialPick, firstTab, type Pick } from './sync-review/keys';
import { applySync } from './sync-review/apply-sync';
import { SyncSummary, SyncTabs, type Picks } from './sync-review/parts';
import { TestsPane } from './sync-review/tests-pane';
import { BacklogPane } from './sync-review/backlog-pane';
import { PagesPane } from './sync-review/pages-pane';

export function SyncReview({ r }: { r: Any }) {
  const d = pageDiff(r, appSetup(P()).pages);
  const [tab, setTab] = useState(() => firstTab(r));
  const [pick, setPick] = useState<Pick>(() => initialPick(r, d));
  const [open, setOpen] = useState<string | null>(null);
  const ps: Picks = {
    pick,
    tog: (k) => setPick({ ...pick, [k]: !pick[k] }),
    n: (prefix) => Object.entries(pick).filter(([k, v]) => v && k.startsWith(prefix)).length,
  };
  const total = Object.values(pick).filter(Boolean).length;
  const tabs: [string, string, number][] = [
    ['tests', 'Test cases', r.tests.updates.length + r.tests.additions.length],
    ['backlog', 'Already built', r.built.done.length + r.built.newIssues.length],
    ['pages', 'Pages', d.newPages.length + d.gone.length],
  ];
  const actions = [
    { label: 'Cancel' },
    {
      label: total ? `Apply ${total} change${total > 1 ? 's' : ''}` : 'Mark as synced',
      kind: 'primary' as const,
      onClick: () => applySync(r, pick, d.newPages, d.changedPages),
    },
  ];
  return (
    <Modal title="Review the repository sync" wide persistent actions={actions}>
      <SyncSummary r={r} changed={d.changedPages.length} />
      <SyncTabs tabs={tabs} tab={tab} setTab={setTab} />
      {tab === 'tests' && (
        <TestsPane r={r} ps={ps} changed={d.changedPages.length} open={open} setOpen={setOpen} />
      )}
      {tab === 'backlog' && <BacklogPane r={r} ps={ps} />}
      {tab === 'pages' && <PagesPane r={r} ps={ps} {...d} />}
    </Modal>
  );
}
