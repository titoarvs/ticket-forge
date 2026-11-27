'use client';
// The Code job page: /p/<projectId>/code/<issueId>?side=frontend|backend. Everything the Write code
// modal showed (start, live log, changes, review, pull request) on a page of its own, so a running
// job can be followed full width, linked to, and left open in a tab.
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type Any, P, S, emit, ticket } from '../core';
import { Ico, I, EmptyState, TypeIcon, StatusLoz } from '../ui';
import { Crumbs } from '../views';
import { useCodeJobs } from './code-modal/use-code-jobs';
import { CodeView, codeTitle } from './CodeModal';

type PageProps = { t: Any; side?: string; agentId?: string; again: () => void };
function Page({ t, side, agentId, again }: PageProps) {
  const cj = useCodeJobs(t, agentId || 'build', side);
  const p = P();
  const openIssue = () => {
    Object.assign(S, { drawer: { kind: 'issue', id: t.id }, menu: null });
    emit();
  };
  return (
    <div className="code-page">
      <Crumbs>
        <Link href={`/p/${p.id}/summary`}>{p.name}</Link>
        <span aria-hidden>/</span>
        <Link href={`/p/${p.id}/codejobs`}>Code jobs</Link>
      </Crumbs>
      <div className="page-h code-page-h">
        <Ico svg={I.bot} size={24} className="page-ic" />
        <div className="code-page-title">
          <span className="muted small">
            {codeTitle(cj.job)}
            {cj.running ? ' · running' : ''}
          </span>
          <h1>
            <TypeIcon type={t.type} /> <span className="key">{t.key}</span> {t.title}
          </h1>
        </div>
        <div className="spacer" />
        <StatusLoz s={t.status} />
        <button className="btn" onClick={openIssue}>
          <Ico svg={I.doc} />
          Open issue
        </button>
        <Link className="btn" href={`/p/${p.id}/codejobs`}>
          <Ico svg={I.left} />
          All code jobs
        </Link>
      </div>
      <div className="code-page-body">
        <CodeView t={t} cj={cj} onDiscarded={again} />
      </div>
    </div>
  );
}

/** The page for the issue in the path (`sub`), or "not found". */
export function CodePage({ sub }: { sub?: string }) {
  const params = useSearchParams();
  const [round, setRound] = useState(0);
  const t = sub ? ticket(sub) : null;
  if (!t)
    return (
      <EmptyState icon={I.bot} title="That issue isn’t in this project">
        <p>
          It may have been deleted or moved.{' '}
          <Link href={`/p/${P().id}/codejobs`}>Back to Code jobs</Link>
        </p>
      </EmptyState>
    );
  const side = params.get('side') === 'backend' ? 'backend' : params.get('side') || undefined;
  // A new key per issue and side: the page starts fresh when either changes.
  return (
    <Page
      key={`${t.id}:${side || ''}:${round}`}
      again={() => setRound(round + 1)}
      t={t}
      side={side}
      agentId={params.get('agent') || undefined}
    />
  );
}

/** The page's address for an issue (and the repository side, for split projects). */
export const codePageHref = (projectId: string, ticketId: string, side?: string) =>
  `/p/${projectId}/code/${encodeURIComponent(ticketId)}${side ? `?side=${side}` : ''}`;
