'use client';
import Link from 'next/link';
import { S, P, emit, openProject } from '../core';
import { EmptyState, I, ErrorState } from '../ui';
import { switchWorkspace } from '../WorkspaceSwitcher';

export function LockedView({ label }: { label: string }) {
  return (
    <EmptyState
      icon={I.settings}
      tone="neutral"
      title={`${label} is locked`}
      actions={
        S.user?.isOwner ? (
          <Link className="btn primary" href="/admin/features">
            Manage features
          </Link>
        ) : (
          <Link className="btn" href={`/p/${P().id}/backlog`}>
            Go to the backlog
          </Link>
        )
      }
    >
      <p>
        {S.user?.isOwner
          ? 'You locked this feature. Unlock it in Administration → Features.'
          : 'The owner locked this feature. Ask them if you need it.'}
      </p>
    </EmptyState>
  );
}
/** The project couldn't be opened: missing, no access, or a failed request. */
export function ProjectError({ id }: { id: string }) {
  const e = S.projectError;
  const back = (
    <Link className="btn" href="/projects">
      Back to projects
    </Link>
  );
  if (e.status === 404 || e.status === 403) {
    if (e.elsewhere) {
      return (
        <EmptyState
          icon={I.folder}
          tone="neutral"
          title={`This project is in ${e.elsewhere.name}`}
          actions={
            <>
              <button
                className="btn primary"
                onClick={() => switchWorkspace(e.elsewhere.id, location.pathname)}
              >
                Switch to {e.elsewhere.name}
              </button>
              {back}
            </>
          }
        >
          <p>
            You’re working in <b>{S.user?.workspaceName}</b> right now. Switch workspaces to open
            it.
          </p>
        </EmptyState>
      );
    }
    return (
      <EmptyState
        icon={I.folder}
        tone="neutral"
        title="Project not found"
        actions={
          <Link className="btn primary" href="/projects">
            Back to projects
          </Link>
        }
      >
        <p>
          It may have been deleted, or you don’t have access to it. If you think you should, ask an
          administrator to add you.
        </p>
      </EmptyState>
    );
  }
  return (
    <ErrorState
      title="Couldn’t open this project"
      error={e.message}
      actions={back}
      onRetry={async () => {
        S.projectError = null;
        emit();
        await openProject(id);
      }}
    >
      <p>Something went wrong while loading it. Your saved work isn’t affected.</p>
    </ErrorState>
  );
}
