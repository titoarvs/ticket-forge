'use client';
// Desktop, two or more workspaces: a thin rail at the left edge to switch between them in one click.
import { S, type Any, hashColor, COLORS, openModal } from '../core';
import { I, Ico } from '../ui';
import {
  NameModal,
  WorkspaceSwitcher,
  canCreateWorkspace,
  switchWorkspace,
  workspaceList,
} from '../WorkspaceSwitcher';

export const hasRail = () => workspaceList().length > 1;

export function WorkspaceRail() {
  const cur = S.user?.workspaceId;
  return (
    <nav className="ws-rail" aria-label="Workspaces">
      <WorkspaceSwitcher compact />
      {canCreateWorkspace() && (
        <button
          className="ws-rail-add"
          title="Create a workspace"
          aria-label="Create a workspace"
          onClick={() => openModal(<NameModal mode="create" />)}
        >
          <Ico svg={I.plus} />
        </button>
      )}
      <hr />
      <div className="ws-rail-list">
        {workspaceList().map((w: Any) => (
          <button
            key={w.id}
            className={`ws-tile ${w.id === cur ? 'on' : ''}`}
            style={{ ['--wc' as string]: hashColor(String(w.name), COLORS) }}
            title={w.name}
            aria-label={w.id === cur ? `${w.name} (current workspace)` : `Switch to ${w.name}`}
            aria-current={w.id === cur ? 'true' : undefined}
            onClick={() => {
              if (w.id !== cur) switchWorkspace(w.id);
            }}
          >
            <span aria-hidden>{String(w.name).slice(0, 1).toUpperCase()}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
