'use client';
import { S, type Any, emit, toast, openModal, ago } from '../core';
import { I, Avatar, Ico, Confirm, EmptyState } from '../ui';
import { loadAdminData, updateUser, resetUserPassword, deleteUser } from '../api/admin';
import { TF, SF, MenuItem } from '../fields';
import { applyAi } from './ProviderModal';
import { AccessModal, LinkModal } from './InvitesTab';

export const TABS: [string, string, string][] = [
  ['users', 'Users', I.people],
  ['invites', 'Invites', I.comment],
  ['roles', 'Roles & permissions', I.settings],
  ['ai', 'AI', I.sparkle],
  ['generation', 'Generation', I.test],
  ['agents', 'Agents', I.bot],
  ['features', 'Features', I.flag],
  ['github', 'GitHub', I.pr],
  ['gdrive', 'Google Drive', I.folder],
  ['billing', 'Billing', I.chart],
  ['payments', 'Plans & gateways', I.settings],
  ['limits', 'Limits', I.flag],
  ['email', 'Email & database', I.doc],
];
/** Tabs only the owner sees: people (users and invites) and feature flags. */
export const OWNER_TABS = ['users', 'invites', 'features', 'gdrive', 'billing', 'payments'];
/**
 * Features the owner locked. A feature that starts locked (Google Drive storage) isn't counted:
 * nobody locked it.
 */
export const lockedCount = () =>
  (S.flags?.features || []).filter((f: Any) => f.locked && !f.off).length;
export const A: Any = {
  users: [],
  roles: [],
  invites: [],
  projects: [],
  email: null,
  ai: null,
  loaded: false,
  error: null,
};
export const accessText = (a: Any) =>
  a === 'all' ? 'All projects' : `${(a || []).length} project${(a || []).length === 1 ? '' : 's'}`;
export const accessTitle = (a: Any) =>
  a === 'all'
    ? 'Every current and future project'
    : (a || [])
        .map((id: string) => A.projects.find((p: Any) => p.id === id)?.name || id)
        .join(', ') || 'No projects';
export function inviteState(i: Any): [string, string] {
  if (i.accepted_at) return ['Accepted', 's-done'];
  if (i.revoked_at) return ['Revoked', 's-todo'];
  if (new Date(i.expires_at) < new Date()) return ['Expired', 's-todo'];
  return ['Pending', 's-inprogress'];
}
export async function load() {
  // Users and invites are the owner's alone (the server refuses them to other administrators).
  const { users, roles, invites, projects, email, ai } = await loadAdminData(
    Boolean(S.user?.isOwner),
  );
  Object.assign(A, { users, roles, invites, projects, email, loaded: true, error: null });
  if (ai) applyAi(ai);
  else emit();
}
// The first load shows an error screen; later refreshes keep the page and show a toast.
export const reload = () =>
  load().catch((e) => {
    if (A.loaded) toast(e.message, 'err');
    else {
      A.error = e;
      emit();
    }
  });
export async function act(fn: () => Promise<Any>, ok?: string) {
  try {
    const r = await fn();
    await load();
    if (ok) toast(ok);
    return r;
  } catch (e: Any) {
    toast(e.message, 'err');
    await reload();
    return null;
  }
}
// ---------------------------------------------------------------- users
export function UsersTab({ q, setQ }: { q: string; setQ: (v: string) => void }) {
  const qq = q.toLowerCase();
  const list = A.users.filter(
    (u: Any) => !qq || `${u.name} ${u.email} ${u.roleName}`.toLowerCase().includes(qq),
  );
  return (
    <>
      <div className="toolbar">
        <TF
          search
          sx={{ width: 220 }}
          placeholder="Search users"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="spacer" />
        <span className="muted small">
          {A.users.filter((u: Any) => u.status === 'active').length} active · {A.users.length} total
        </span>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th>Project access</th>
            <th>Status</th>
            <th>Last signed in</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((u: Any) => (
            <tr key={u.id}>
              <td>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <Avatar name={u.name} size={32} />
                  <div>
                    <b style={{ fontWeight: 500 }}>{u.name}</b>
                    {u.isOwner && (
                      <>
                        {' '}
                        <span className="loz s-inprogress">Owner</span>
                      </>
                    )}
                    {u.id === S.user.id && <span className="muted small"> (you)</span>}
                    <div className="muted small">{u.email}</div>
                  </div>
                </div>
              </td>
              <td>
                <span
                  title={u.isOwner ? 'The owner is always an Administrator' : undefined}
                  style={{ display: 'inline-block' }}
                >
                  <SF
                    filter
                    value={u.roleId}
                    disabled={u.isOwner}
                    aria-label="Role"
                    onChange={(e) =>
                      act(
                        () => updateUser(u.id, { roleId: e.target.value }),
                        `${u.name} is now ${A.roles.find((r: Any) => r.id === e.target.value)?.name}`,
                      )
                    }
                  >
                    {A.roles.map((r: Any) => (
                      <MenuItem key={r.id} value={r.id}>
                        {r.name}
                      </MenuItem>
                    ))}
                  </SF>
                </span>
              </td>
              <td>
                <button
                  className="btn sm"
                  disabled={u.isOwner}
                  title={accessTitle(u.projectAccess)}
                  onClick={() => openModal(<AccessModal u={u} />)}
                >
                  <Ico svg={I.folder} />
                  {accessText(u.projectAccess)}
                </button>
              </td>
              <td>
                <span className={`loz ${u.status === 'active' ? 's-done' : 's-todo'}`}>
                  {u.status === 'active' ? 'Active' : 'Disabled'}
                </span>
              </td>
              <td className="muted">{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button
                  className="btn sm subtle"
                  title="Send a password reset link"
                  onClick={async () => {
                    const r = await act(() => resetUserPassword(u.id));
                    if (r) openModal(<LinkModal title={`Password reset for ${u.name}`} res={r} />);
                  }}
                >
                  Reset password
                </button>
                {!u.isOwner && u.id !== S.user.id && (
                  <>
                    <button
                      className="btn sm subtle"
                      onClick={() =>
                        act(
                          () =>
                            updateUser(u.id, {
                              status: u.status === 'active' ? 'disabled' : 'active',
                            }),
                          `${u.name} ${u.status === 'active' ? 'disabled — signed out everywhere' : 'enabled'}`,
                        )
                      }
                    >
                      {u.status === 'active' ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      className="icon-btn"
                      title="Remove user"
                      onClick={() =>
                        openModal(
                          <Confirm
                            title={`Remove ${u.name}?`}
                            label="Remove user"
                            text={`${u.email} loses access immediately. Their past comments and history stay.`}
                            onYes={() => act(() => deleteUser(u.id), `Removed ${u.name}`)}
                          />,
                        )
                      }
                    >
                      <Ico svg={I.trash} />
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.length && (
        <EmptyState
          compact
          icon={I.search}
          tone="neutral"
          title={<>No users match “{q}”</>}
          actions={
            <button className="btn" onClick={() => setQ('')}>
              Clear search
            </button>
          }
        >
          <p>Search by name, email or role.</p>
        </EmptyState>
      )}
    </>
  );
}
