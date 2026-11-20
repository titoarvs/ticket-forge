'use client';
// Deleting a project: only its creator and owners can, after a data-loss warning and re-entering
// their password.
// The server archives the project (soft delete), so the app owner can restore it later.
import { useState } from 'react';
import { S, api, toast, openModal, closeModal, type Any } from './core';
import { Modal } from './ui';
import { TF } from './fields';

export const ONLY_OWNERS = 'Only the project creator or an owner can delete this project.';

/** The same rule as the server (store.canDeleteProject): the creator, or the workspace owner. */
export const canDeleteProject = (p: Any) =>
  Boolean(S.user && (S.user.isOwner || (p?.createdBy && p.createdBy === S.user.id)));

function DeleteProjectDialog({ project, onDone }: { project: Any; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (!password) {
      setError('Enter your password to delete this project.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: 'DELETE',
        body: { password },
      });
      closeModal();
      toast('Project deleted');
      onDone();
    } catch (e: Any) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Delete project?"
      persistent
      actions={[
        { label: 'Cancel', disabled: busy },
        { label: 'Delete project', kind: 'danger', busy, onClick: confirm },
      ]}
    >
      <p style={{ marginTop: 0 }}>
        <b>Warning:</b> all data in “{project.name}” will be lost: its issues, epics, sprints, test
        cases and documents disappear for everyone on the team. Only the app owner can restore it.
      </p>
      <label className="field">
        <span>Re-enter your password to confirm</span>
        <TF
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          disabled={busy}
          onChange={(e) => {
            setPassword(e.target.value);
            setError('');
          }}
          onKeyDown={(e: Any) => {
            if (e.key === 'Enter' && !busy) confirm();
          }}
        />
      </label>
      {error && (
        <div className="err-box" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}

/** Opens the confirmation dialog. onDone runs once the project is deleted. */
export const openDeleteProject = (project: Any, onDone: () => void) =>
  openModal(<DeleteProjectDialog project={project} onDone={onDone} />);
