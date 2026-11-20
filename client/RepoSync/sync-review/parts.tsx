'use client';
// Shared pieces of the sync review: a change you can tick in or out, a pane's warning, and the
// summary of what was read.
import type { ReactNode } from 'react';
import type { Any } from '../../core';
import { Ico, I } from '../../ui';
import { CB } from '../../fields';
import type { Pick } from './keys';

/** What the panes need: the ticks, flipping one, and how many of a kind are ticked. */
export type Picks = { pick: Pick; tog: (k: string) => void; n: (prefix: string) => number };

/** One change in the review: greyed out when not ticked. */
export function Item({ ps, k, children }: { ps: Picks; k: string; children: ReactNode }) {
  const on = Boolean(ps.pick[k]);
  return (
    <div className={`sync-item ${on ? '' : 'off'}`}>
      <CB checked={on} onChange={() => ps.tog(k)} aria-label="Include" />
      <div className="sync-body">{children}</div>
    </div>
  );
}

export function Warn({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="warn-banner">
      <span>{text}</span>
    </div>
  );
}

export function SyncSummary({ r, changed }: { r: Any; changed: number }) {
  const { repo } = r;
  return (
    <div className="sync-sum">
      <span>
        <Ico svg={I.pr} /> <b>{repo.branch}</b> at <code>{String(repo.head).slice(0, 7)}</code>
      </span>
      <span>
        {r.pages.length} pages · {repo.frameworks.join(', ') || 'no router found'}
      </span>
      <span>
        {changed} changed — {repo.baseNote}
      </span>
      {repo.uncommitted > 0 && (
        <span className="warn-text">
          {repo.uncommitted} uncommitted file{repo.uncommitted > 1 ? 's' : ''} included
        </span>
      )}
    </div>
  );
}

type TabsProps = { tabs: [string, string, number][]; tab: string; setTab: (k: string) => void };

export function SyncTabs({ tabs, tab, setTab }: TabsProps) {
  return (
    <div className="sync-tabs" role="tablist">
      {tabs.map(([k, l, c]) => (
        <button
          key={k}
          role="tab"
          aria-selected={tab === k}
          className={tab === k ? 'on' : ''}
          onClick={() => setTab(k)}
        >
          {l} <span className="count">{c}</span>
        </button>
      ))}
    </div>
  );
}
