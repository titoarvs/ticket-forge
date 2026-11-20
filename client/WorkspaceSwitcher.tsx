'use client';
// The workspace you are in (top bar): switch to another of your workspaces, create one, or rename
// this one (owner).
// Switching reloads the app, so nothing from the previous workspace stays on screen or in memory.
import { useState } from 'react';
import { S, api, openModal, closeModal, setMenu, toast, type Any } from './core';
import { Ico, I, Menu, Modal } from './ui';
import { TF } from './fields';

const go = (to = '/projects') => {
  location.href = to;
};

/**
 * Switch to another of your workspaces and reload there (`to`: a page to open afterwards, such as a
 * project).
 */
export async function switchWorkspace(id: string, to = '/projects') {
  try {
    await api('/api/workspaces/current', { method: 'PUT', body: { id } });
    go(to.startsWith('/') && !to.startsWith('//') ? to : '/projects');
  } catch (e: Any) {
    toast(e.message, 'err');
  }
}
const switchTo = (id: string) => switchWorkspace(id);

function NameModal({ mode }: { mode: 'create' | 'rename' }) {
  const [name, setName] = useState(mode === 'rename' ? S.user?.workspaceName || '' : '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (mode === 'create') {
        await api('/api/workspaces', { method: 'POST', body: { name: name.trim() } });
        go();
        return;
      }
      await api('/api/workspaces/current', { method: 'PATCH', body: { name: name.trim() } });
      closeModal();
      go();
    } catch (e: Any) {
      toast(e.message, 'err');
      setBusy(false);
    }
  };
  return (
    <Modal
      title={mode === 'create' ? 'Create a workspace' : 'Rename this workspace'}
      actions={[
        { label: 'Cancel' },
        {
          label: mode === 'create' ? 'Create workspace' : 'Save',
          kind: 'primary',
          disabled: !name.trim() || busy,
          onClick: save,
        },
      ]}
    >
      {mode === 'create' && (
        <p className="muted" style={{ marginTop: 0 }}>
          A workspace is a separate space for a company or team: its own projects, people, roles and
          AI settings. You’ll be its owner.
        </p>
      )}
      <label className="field">
        <span>
          Workspace name <span className="req">*</span>
        </span>
        <TF
          autoFocus
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Acme Corporation"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim() && !busy) save();
          }}
        />
      </label>
    </Modal>
  );
}

export function WorkspaceSwitcher() {
  const list: Any[] = S.auth?.workspaces || [];
  const cur = S.user?.workspaceId;
  const name = S.user?.workspaceName || 'Workspace';
  const canCreate = Boolean(S.auth?.saas || S.user?.isOwner);
  // One workspace and nothing to do with it: no switcher, just room for the rest of the bar.
  if (list.length <= 1 && !canCreate && !S.user?.isOwner) return null;
  return (
    <Menu
      id="workspace"
      left
      style={{ flex: 'none', minWidth: 0 }}
      button={
        <button
          className="ws-chip"
          data-tour="workspace"
          aria-haspopup="menu"
          aria-expanded={S.menu === 'workspace'}
          title={`Workspace: ${name}`}
          onClick={() => setMenu('workspace')}
        >
          <span className="ws-avatar" aria-hidden>
            {name.slice(0, 1).toUpperCase()}
          </span>
          <span className="ws-name hide-sm">{name}</span>
          <Ico svg={I.chevron} />
        </button>
      }
    >
      <div className="mh">Your workspaces</div>
      {list.map((w) => (
        <button
          key={w.id}
          onClick={() => (w.id === cur ? null : switchTo(w.id))}
          aria-current={w.id === cur ? 'true' : undefined}
        >
          <span className="ws-avatar sm" aria-hidden>
            {String(w.name).slice(0, 1).toUpperCase()}
          </span>
          <span className="ws-row">
            <b>{w.name}</b>
            <small className="muted">
              {w.isOwner ? 'Owner' : w.role || 'Member'}
              {typeof w.projects === 'number'
                ? ` · ${w.projects} project${w.projects === 1 ? '' : 's'}`
                : ''}
            </small>
          </span>
          {w.id === cur && <Ico svg={I.check} />}
        </button>
      ))}
      <hr />
      {S.user?.isOwner && (
        <button onClick={() => openModal(<NameModal mode="rename" />)}>
          <Ico svg={I.pencil} />
          Rename this workspace
        </button>
      )}
      {canCreate && (
        <button onClick={() => openModal(<NameModal mode="create" />)}>
          <Ico svg={I.plus} />
          Create a workspace
        </button>
      )}
    </Menu>
  );
}
