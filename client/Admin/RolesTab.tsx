'use client';
import { useState } from 'react';
import { type Any, copyText, S, emit, openModal, closeModal } from '../core';
import { Modal, Ico, I } from '../ui';
import { updateRole, createRole, deleteRole } from '../api/admin';
import { TF, CB, SF, MenuItem } from '../fields';
import { act, A } from './UsersTab';

export function InviteResults({ results }: { results: Any[] }) {
  return (
    <Modal title="Invites created" wide actions={[{ label: 'Done', kind: 'primary' }]}>
      {results.map((r) => (
        <div key={r.email} className="inv-res">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b style={{ fontWeight: 500 }}>{r.email}</b>
            {r.error ? (
              <span className="loz t-fail">{r.error}</span>
            ) : r.emailed ? (
              <span className="loz s-done">
                <Ico svg={I.check} /> Emailed
              </span>
            ) : (
              <span className="loz s-todo">Not emailed</span>
            )}
          </div>
          {r.link && (
            <div className="row" style={{ flexWrap: 'nowrap', marginTop: 6 }}>
              <TF readOnly value={r.link} onFocus={(e) => e.target.select()} />
              <button className="btn" onClick={() => copyText(r.link)}>
                <Ico svg={I.copy} />
                Copy
              </button>
            </div>
          )}
          {r.emailError && (
            <div className="muted small" style={{ marginTop: 4 }}>
              {r.emailError}
            </div>
          )}
        </div>
      ))}
      <p className="muted small" style={{ marginBottom: 0 }}>
        Each link works once and expires in 7 days. Anyone with the link can create the account, so
        share it only with that person.
      </p>
    </Modal>
  );
}
// ---------------------------------------------------------------- roles
export function RolesTab() {
  const perms = S.auth.permissions;
  const groups = [...new Set(perms.map((p: Any) => p.group))] as string[];
  const toggle = async (r: Any, key: string, on: boolean) => {
    const permissions = on
      ? [...new Set([...r.permissions, key])]
      : r.permissions.filter((k: string) => k !== key);
    r.permissions = permissions;
    emit();
    await act(
      () => updateRole(r.id, { name: r.name, description: r.description, permissions }),
      `${r.name}: ${on ? 'can now' : 'can no longer'} ${perms.find((p: Any) => p.key === key).label.toLowerCase()}`,
    );
  };
  return (
    <>
      <p className="muted" style={{ marginTop: -4 }}>
        Tick what each role can do. Changes apply immediately to everyone with that role. The
        Administrator role always has every permission.
      </p>
      <div className="toolbar">
        <button className="btn" onClick={() => openModal(<RoleModal />)}>
          <Ico svg={I.plus} />
          Create role
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl matrix">
          <thead>
            <tr>
              <th>Permission</th>
              {A.roles.map((r: Any) => (
                <th key={r.id} className="role-col">
                  <div className="role-h">
                    <b>{r.name}</b>
                    <span className="muted small">
                      {r.users} user{r.users === 1 ? '' : 's'}
                    </span>
                    {r.is_system ? (
                      <span className="muted small">Locked</span>
                    ) : (
                      <span>
                        <button
                          className="icon-btn"
                          title="Rename"
                          onClick={() => openModal(<RoleModal role={r} />)}
                        >
                          <Ico svg={I.pencil} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Delete role"
                          onClick={() => openModal(<DeleteRoleModal role={r} />)}
                        >
                          <Ico svg={I.trash} />
                        </button>
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => [
              <tr key={g} className="grp">
                <td colSpan={A.roles.length + 1}>{g}</td>
              </tr>,
              ...perms
                .filter((p: Any) => p.group === g)
                .map((p: Any) => (
                  <tr key={p.key}>
                    <td>
                      <b style={{ fontWeight: 500 }}>{p.label}</b>
                      <div className="muted small">{p.desc}</div>
                    </td>
                    {A.roles.map((r: Any) => (
                      <td key={r.id} className="role-col">
                        <CB
                          aria-label={`${r.name}: ${p.label}`}
                          checked={r.permissions.includes(p.key)}
                          disabled={r.is_system}
                          onChange={(e) => toggle(r, p.key, e.target.checked)}
                        />
                      </td>
                    ))}
                  </tr>
                )),
            ])}
          </tbody>
        </table>
      </div>
    </>
  );
}
function RoleModal({ role }: { role?: Any }) {
  const [f, setF] = useState({
    name: role?.name || '',
    description: role?.description || '',
    copy: '',
  });
  return (
    <Modal
      title={role ? `Edit ${role.name}` : 'Create role'}
      actions={[
        { label: 'Cancel' },
        {
          label: role ? 'Save' : 'Create',
          kind: 'primary',
          disabled: !f.name.trim(),
          onClick: async () => {
            closeModal();
            await act(
              () =>
                role
                  ? updateRole(role.id, {
                      name: f.name.trim(),
                      description: f.description.trim(),
                      permissions: role.permissions,
                    })
                  : createRole({
                      name: f.name.trim(),
                      description: f.description.trim(),
                      permissions: A.roles.find((r: Any) => r.id === f.copy)?.permissions || [],
                    }),
              role ? 'Role updated' : `Created ${f.name.trim()}`,
            );
          },
        },
      ]}
    >
      <label className="field">
        <span>
          Name <span className="req">*</span>
        </span>
        <TF
          autoFocus
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          placeholder="e.g. Business analyst"
        />
      </label>
      <label className="field">
        <span>Description</span>
        <TF
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          placeholder="What this role is for"
        />
      </label>
      {!role && (
        <label className="field">
          <span>Start with the permissions of</span>
          <SF value={f.copy} onChange={(e) => setF({ ...f, copy: e.target.value })}>
            <MenuItem value="">No permissions</MenuItem>
            {A.roles.map((r: Any) => (
              <MenuItem key={r.id} value={r.id}>
                {r.name}
              </MenuItem>
            ))}
          </SF>
        </label>
      )}
    </Modal>
  );
}
function DeleteRoleModal({ role }: { role: Any }) {
  const others = A.roles.filter((r: Any) => r.id !== role.id);
  const [to, setTo] = useState(others.find((r: Any) => r.id === 'viewer')?.id || others[0]?.id);
  return (
    <Modal
      title={`Delete ${role.name}?`}
      actions={[
        { label: 'Cancel' },
        {
          label: 'Delete role',
          kind: 'danger',
          onClick: async () => {
            closeModal();
            await act(
              () => deleteRole(role.id, role.users ? to : undefined),
              `Deleted ${role.name}`,
            );
          },
        },
      ]}
    >
      {role.users ? (
        <>
          <p style={{ marginTop: 0 }}>
            {role.users} user{role.users === 1 ? ' has' : 's have'} this role. Move them to:
          </p>
          <SF value={to} onChange={(e) => setTo(e.target.value)}>
            {others.map((r: Any) => (
              <MenuItem key={r.id} value={r.id}>
                {r.name}
              </MenuItem>
            ))}
          </SF>
        </>
      ) : (
        <p style={{ marginTop: 0 }}>Nobody has this role. Pending invites with it are cancelled.</p>
      )}
    </Modal>
  );
}
