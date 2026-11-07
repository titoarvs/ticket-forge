'use client';
// Administration: users, invites, roles & permissions, email. Also the "Your account" dialog.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { S, emit, useStore, api, toast, openModal, closeModal, copyText, ago, closeProject, type Any } from './core';
import { Modal, Confirm, Ico, I, Avatar, Spinner } from './ui';
import { TF, TA, SF, CB, RB, DateF, PeopleF, MenuItem, opts } from './fields';

const TABS: [string, string, string][] = [['users', 'Users', I.people], ['invites', 'Invites', I.comment], ['roles', 'Roles & permissions', I.settings], ['email', 'Email & database', I.doc]];
const A: Any = { users: [], roles: [], invites: [], projects: [], email: null, loaded: false };

const accessText = (a: Any) => (a === 'all' ? 'All projects' : `${(a || []).length} project${(a || []).length === 1 ? '' : 's'}`);
const accessTitle = (a: Any) => (a === 'all' ? 'Every current and future project' : (a || []).map((id: string) => A.projects.find((p: Any) => p.id === id)?.name || id).join(', ') || 'No projects');
function inviteState(i: Any): [string, string] {
  if (i.accepted_at) return ['Accepted', 's-done'];
  if (i.revoked_at) return ['Revoked', 's-todo'];
  if (new Date(i.expires_at) < new Date()) return ['Expired', 's-todo'];
  return ['Pending', 's-inprogress'];
}
async function load() {
  const [users, roles, invites, projects, email] = await Promise.all([
    api('/api/admin/users'), api('/api/admin/roles'), api('/api/admin/invites'), api('/api/admin/projects'), api('/api/admin/email'),
  ]);
  Object.assign(A, { users, roles, invites, projects, email, loaded: true });
  emit();
}
const reload = () => load().catch((e) => toast(e.message, 'err'));
async function act(fn: () => Promise<Any>, ok?: string) {
  try { const r = await fn(); await load(); if (ok) toast(ok); return r; } catch (e: Any) { toast(e.message, 'err'); await reload(); return null; }
}

export default function AdminPage({ tab }: { tab: string }) {
  useStore();
  const [q, setQ] = useState('');
  useEffect(() => { closeProject(); reload(); }, []);
  const t = TABS.some(([k]) => k === tab) ? tab : 'users';
  if (!A.loaded) return <div className="page"><div className="page-inner"><Spinner /></div></div>;
  const pending = A.invites.filter((i: Any) => inviteState(i)[0] === 'Pending').length;
  return (
    <div className="page"><div className="page-inner">
      <div className="crumbs"><Link href="/">Projects</Link><span>/</span><span>Administration</span></div>
      <div className="page-h"><h1>Administration</h1><div className="spacer" /><button className="btn primary" onClick={() => openModal(<InviteModal />)}><Ico svg={I.plus} />Invite people</button></div>
      <div className="tabbar">{TABS.map(([k, l, ic]) => (
        <Link key={k} className={`tab ${t === k ? 'active' : ''}`} href={`/admin/${k}`}><Ico svg={ic} />{l}
          {k === 'invites' && <span className="count">{pending}</span>}{k === 'users' && <span className="count">{A.users.length}</span>}</Link>))}</div>
      {t === 'users' && <UsersTab q={q} setQ={setQ} />}
      {t === 'invites' && <InvitesTab />}
      {t === 'roles' && <RolesTab />}
      {t === 'email' && <EmailTab />}
    </div></div>
  );
}

// ---------------------------------------------------------------- users
function UsersTab({ q, setQ }: { q: string; setQ: (v: string) => void }) {
  const qq = q.toLowerCase();
  const list = A.users.filter((u: Any) => !qq || `${u.name} ${u.email} ${u.roleName}`.toLowerCase().includes(qq));
  return <>
    <div className="toolbar"><TF search sx={{ width: 220 }} placeholder="Search users" value={q} onChange={(e) => setQ(e.target.value)} /><div className="spacer" />
      <span className="muted small">{A.users.filter((u: Any) => u.status === 'active').length} active · {A.users.length} total</span></div>
    <table className="tbl"><thead><tr><th>User</th><th>Role</th><th>Project access</th><th>Status</th><th>Last signed in</th><th /></tr></thead><tbody>
      {list.map((u: Any) => (
        <tr key={u.id}>
          <td><div className="row" style={{ flexWrap: 'nowrap' }}><Avatar name={u.name} size={32} /><div><b style={{ fontWeight: 500 }}>{u.name}</b>{u.isOwner && <> <span className="loz s-inprogress">Owner</span></>}{u.id === S.user.id && <span className="muted small"> (you)</span>}<div className="muted small">{u.email}</div></div></div></td>
          <td><SF filter value={u.roleId} disabled={u.isOwner} title={u.isOwner ? 'The owner is always an Administrator' : ''} aria-label="Role"
            onChange={(e) => act(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { roleId: e.target.value } }), `${u.name} is now ${A.roles.find((r: Any) => r.id === e.target.value)?.name}`)}>
            {A.roles.map((r: Any) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}</SF></td>
          <td><button className="btn sm" disabled={u.isOwner} title={accessTitle(u.projectAccess)} onClick={() => openModal(<AccessModal u={u} />)}><Ico svg={I.folder} />{accessText(u.projectAccess)}</button></td>
          <td><span className={`loz ${u.status === 'active' ? 's-done' : 's-todo'}`}>{u.status === 'active' ? 'Active' : 'Disabled'}</span></td>
          <td className="muted">{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</td>
          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
            <button className="btn sm subtle" title="Send a password reset link" onClick={async () => { const r = await act(() => api(`/api/admin/users/${u.id}/reset`, { method: 'POST', body: {} })); if (r) openModal(<LinkModal title={`Password reset for ${u.name}`} res={r} />); }}>Reset password</button>
            {!u.isOwner && u.id !== S.user.id && <>
              <button className="btn sm subtle" onClick={() => act(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { status: u.status === 'active' ? 'disabled' : 'active' } }), `${u.name} ${u.status === 'active' ? 'disabled — signed out everywhere' : 'enabled'}`)}>{u.status === 'active' ? 'Disable' : 'Enable'}</button>
              <button className="icon-btn" title="Remove user" onClick={() => openModal(<Confirm title={`Remove ${u.name}?`} label="Remove user" text={`${u.email} loses access immediately. Their past comments and history stay.`}
                onYes={() => act(() => api(`/api/admin/users/${u.id}`, { method: 'DELETE' }), `Removed ${u.name}`)} />)}><Ico svg={I.trash} /></button>
            </>}
          </td>
        </tr>
      ))}
    </tbody></table>
  </>;
}

function AccessPicker({ value, onChange }: { value: Any; onChange: (v: Any) => void }) {
  const all = value === 'all';
  const sel = new Set(all ? [] : value || []);
  return (
    <div className="field"><span>Project access</span>
      <RB checked={all} onChange={() => onChange('all')} label="All projects, including future ones" />
      <RB checked={!all} onChange={() => onChange([])} label="Only selected projects" />
      {!all && <div className="proj-pick">
        {A.projects.length ? A.projects.map((p: Any) => (
          <label key={p.id} className="check"><CB checked={sel.has(p.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(p.id); else n.delete(p.id); onChange([...n]); }} /> <span className="key">{p.key}</span> {p.name}</label>
        )) : <p className="muted small">No projects yet.</p>}
      </div>}
    </div>
  );
}
function AccessModal({ u }: { u: Any }) {
  const [access, setAccess] = useState(u.projectAccess);
  return (
    <Modal title={`Project access for ${u.name}`} actions={[{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => {
      closeModal(); await act(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { projectAccess: access } }), `Updated access for ${u.name}`);
    } }]}>
      <p className="muted" style={{ marginTop: 0 }}>{u.email} · {u.roleName}. Their role decides what they can do; this decides which projects they can see.</p>
      <AccessPicker value={access} onChange={setAccess} />
    </Modal>
  );
}
function LinkModal({ title, res }: { title: string; res: Any }) {
  return (
    <Modal title={title} actions={[{ label: 'Done', kind: 'primary' }]}>
      <p style={{ marginTop: 0 }}>{res.emailed ? <><Ico svg={I.check} /> Emailed. You can also share the link directly:</> : <>{res.emailError || 'Email isn’t configured.'} Share this link with them:</>}</p>
      <div className="row" style={{ flexWrap: 'nowrap' }}><TF readOnly value={res.link} onFocus={(e) => e.target.select()} /><button className="btn" onClick={() => copyText(res.link)}><Ico svg={I.copy} />Copy</button></div>
    </Modal>
  );
}

// ---------------------------------------------------------------- invites
function InvitesTab() {
  return <>
    {!A.email?.configured && <div className="warn-banner"><Ico svg={I.warn} /><span>Email isn’t configured, so invites give you a link to share yourself. See the <Link href="/admin/email">Email</Link> tab to send them automatically.</span></div>}
    {A.invites.length ? <table className="tbl"><thead><tr><th>Email</th><th>Role</th><th>Projects</th><th>Invited by</th><th>Sent</th><th>Status</th><th>Delivery</th><th /></tr></thead><tbody>
      {A.invites.map((i: Any) => {
        const [st, cls] = inviteState(i);
        return (
          <tr key={i.id}>
            <td>{i.email}</td><td>{i.role_name}</td><td title={accessTitle(i.project_access)}>{accessText(i.project_access)}</td>
            <td className="muted">{i.invited_by_name || '—'}</td><td className="muted">{ago(i.created_at)}</td>
            <td><span className={`loz ${cls}`}>{st}</span>{st === 'Pending' && <div className="muted small">expires {new Date(i.expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</div>}</td>
            <td className="muted small">{i.emailed ? <><Ico svg={I.check} /> Emailed</> : 'Link only'}</td>
            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              {st !== 'Accepted' && <button className="btn sm subtle" onClick={async () => { const r = await act(() => api(`/api/admin/invites/${i.id}/resend`, { method: 'POST', body: {} })); if (r) openModal(<LinkModal title={`New invite link for ${r.email}`} res={r} />); }}>{A.email?.configured ? 'Resend' : 'New link'}</button>}
              {st === 'Pending' && <button className="btn sm danger-subtle" onClick={() => act(() => api(`/api/admin/invites/${i.id}`, { method: 'DELETE' }), 'Invite revoked')}>Revoke</button>}
            </td>
          </tr>
        );
      })}
    </tbody></table> : <div className="empty"><h3>No invites yet</h3><p>Invite teammates by email and choose their role and projects.</p><button className="btn primary" onClick={() => openModal(<InviteModal />)}>Invite people</button></div>}
  </>;
}
function InviteModal() {
  const def = A.roles.find((r: Any) => r.id === 'member') || A.roles[0];
  const [f, setF] = useState<Any>({ emails: '', roleId: def?.id, access: 'all', message: '' });
  return (
    <Modal title="Invite people" actions={[{ label: 'Cancel' }, { label: 'Send invites', kind: 'primary', disabled: !f.emails.trim(), onClick: async () => {
      try {
        const res = await api('/api/admin/invites', { method: 'POST', body: { emails: f.emails, roleId: f.roleId, projectAccess: f.access, message: f.message } });
        await load();
        S.nav('/admin/invites');
        openModal(<InviteResults results={res.results} />);
      } catch (e: Any) { toast(e.message, 'err'); }
    } }]}>
      <label className="field"><span>Email addresses <span className="req">*</span></span><TA autoFocus style={{ minHeight: 70 }} value={f.emails} onChange={(e) => setF({ ...f, emails: e.target.value })} placeholder="ana@company.com, ben@company.com" />
        <span className="muted small" style={{ fontWeight: 400 }}>Separate several with commas, spaces or new lines.</span></label>
      <label className="field"><span>Role</span><SF value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })}>{A.roles.map((r: Any) => <MenuItem key={r.id} value={r.id}>{r.name} — {r.description}</MenuItem>)}</SF></label>
      <AccessPicker value={f.access} onChange={(v) => setF({ ...f, access: v })} />
      <label className="field"><span>Personal message (optional)</span><TA value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="Hi! Join us to plan the next release." /></label>
      <p className="muted small">{A.email?.configured ? `Invites are emailed from ${A.email.from || A.email.user}.` : 'Email isn’t configured: you’ll get a link to send each person yourself.'} Links expire after 7 days.</p>
    </Modal>
  );
}
function InviteResults({ results }: { results: Any[] }) {
  return (
    <Modal title="Invites created" wide actions={[{ label: 'Done', kind: 'primary' }]}>
      {results.map((r) => (
        <div key={r.email} className="inv-res">
          <div className="row" style={{ justifyContent: 'space-between' }}><b style={{ fontWeight: 500 }}>{r.email}</b>
            {r.error ? <span className="loz t-fail">{r.error}</span> : r.emailed ? <span className="loz s-done"><Ico svg={I.check} /> Emailed</span> : <span className="loz s-todo">Not emailed</span>}</div>
          {r.link && <div className="row" style={{ flexWrap: 'nowrap', marginTop: 6 }}><TF readOnly value={r.link} onFocus={(e) => e.target.select()} /><button className="btn" onClick={() => copyText(r.link)}><Ico svg={I.copy} />Copy</button></div>}
          {r.emailError && <div className="muted small" style={{ marginTop: 4 }}>{r.emailError}</div>}
        </div>
      ))}
      <p className="muted small" style={{ marginBottom: 0 }}>Each link works once and expires in 7 days. Anyone with the link can create the account, so share it only with that person.</p>
    </Modal>
  );
}

// ---------------------------------------------------------------- roles
function RolesTab() {
  const perms = S.auth.permissions;
  const groups = [...new Set(perms.map((p: Any) => p.group))] as string[];
  const toggle = async (r: Any, key: string, on: boolean) => {
    const permissions = on ? [...new Set([...r.permissions, key])] : r.permissions.filter((k: string) => k !== key);
    r.permissions = permissions; emit();
    await act(() => api(`/api/admin/roles/${r.id}`, { method: 'PUT', body: { name: r.name, description: r.description, permissions } }),
      `${r.name}: ${on ? 'can now' : 'can no longer'} ${perms.find((p: Any) => p.key === key).label.toLowerCase()}`);
  };
  return <>
    <p className="muted" style={{ marginTop: -4 }}>Tick what each role can do. Changes apply immediately to everyone with that role. The Administrator role always has every permission.</p>
    <div className="toolbar"><button className="btn" onClick={() => openModal(<RoleModal />)}><Ico svg={I.plus} />Create role</button></div>
    <div style={{ overflowX: 'auto' }}><table className="tbl matrix"><thead><tr><th>Permission</th>
      {A.roles.map((r: Any) => (
        <th key={r.id} className="role-col"><div className="role-h"><b>{r.name}</b><span className="muted small">{r.users} user{r.users === 1 ? '' : 's'}</span>
          {r.is_system ? <span className="muted small">Locked</span> : <span>
            <button className="icon-btn" title="Rename" onClick={() => openModal(<RoleModal role={r} />)}><Ico svg={I.pencil} /></button>
            <button className="icon-btn" title="Delete role" onClick={() => openModal(<DeleteRoleModal role={r} />)}><Ico svg={I.trash} /></button></span>}</div></th>))}
    </tr></thead><tbody>
      {groups.map((g) => [
        <tr key={g} className="grp"><td colSpan={A.roles.length + 1}>{g}</td></tr>,
        ...perms.filter((p: Any) => p.group === g).map((p: Any) => (
          <tr key={p.key}><td><b style={{ fontWeight: 500 }}>{p.label}</b><div className="muted small">{p.desc}</div></td>
            {A.roles.map((r: Any) => <td key={r.id} className="role-col"><CB aria-label={`${r.name}: ${p.label}`} checked={r.permissions.includes(p.key)} disabled={r.is_system} onChange={(e) => toggle(r, p.key, e.target.checked)} /></td>)}</tr>
        )),
      ])}
    </tbody></table></div>
  </>;
}
function RoleModal({ role }: { role?: Any }) {
  const [f, setF] = useState({ name: role?.name || '', description: role?.description || '', copy: '' });
  return (
    <Modal title={role ? `Edit ${role.name}` : 'Create role'} actions={[{ label: 'Cancel' }, { label: role ? 'Save' : 'Create', kind: 'primary', disabled: !f.name.trim(), onClick: async () => {
      closeModal();
      await act(() => (role
        ? api(`/api/admin/roles/${role.id}`, { method: 'PUT', body: { name: f.name.trim(), description: f.description.trim(), permissions: role.permissions } })
        : api('/api/admin/roles', { method: 'POST', body: { name: f.name.trim(), description: f.description.trim(), permissions: A.roles.find((r: Any) => r.id === f.copy)?.permissions || [] } })), role ? 'Role updated' : `Created ${f.name.trim()}`);
    } }]}>
      <label className="field"><span>Name <span className="req">*</span></span><TF autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Business analyst" /></label>
      <label className="field"><span>Description</span><TF value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What this role is for" /></label>
      {!role && <label className="field"><span>Start with the permissions of</span><SF value={f.copy} onChange={(e) => setF({ ...f, copy: e.target.value })}><MenuItem value="">No permissions</MenuItem>{A.roles.map((r: Any) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}</SF></label>}
    </Modal>
  );
}
function DeleteRoleModal({ role }: { role: Any }) {
  const others = A.roles.filter((r: Any) => r.id !== role.id);
  const [to, setTo] = useState(others.find((r: Any) => r.id === 'viewer')?.id || others[0]?.id);
  return (
    <Modal title={`Delete ${role.name}?`} actions={[{ label: 'Cancel' }, { label: 'Delete role', kind: 'danger', onClick: async () => {
      closeModal();
      await act(() => api(`/api/admin/roles/${role.id}${role.users ? `?replacement=${encodeURIComponent(to)}` : ''}`, { method: 'DELETE' }), `Deleted ${role.name}`);
    } }]}>
      {role.users ? <><p style={{ marginTop: 0 }}>{role.users} user{role.users === 1 ? ' has' : 's have'} this role. Move them to:</p>
        <SF value={to} onChange={(e) => setTo(e.target.value)}>{others.map((r: Any) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}</SF></>
        : <p style={{ marginTop: 0 }}>Nobody has this role. Pending invites with it are cancelled.</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------- email & database
function EmailTab() {
  const e = A.email || {};
  const row = (k: string, v: React.ReactNode) => <tr><td className="muted" style={{ width: 200 }}>{k}</td><td>{v}</td></tr>;
  return (
    <div className="cards">
      <div className="card"><h3>Email</h3><p className="sub">Used for invites and password resets.</p>
        <table className="tbl"><tbody>
          {row('Status', e.configured ? <span className="loz s-done">Configured{e.provider ? ` · ${e.provider}` : ''}</span> : <span className="loz s-todo">Not configured</span>)}
          {row('Server', e.host ? `${e.host}:${e.port}${e.secure ? ' (TLS)' : ''}` : '—')}
          {row('Username', e.user || '—')}
          {row('From', e.from || '—')}
          {row('Links point to', <>{e.appUrl}{!e.appUrlSet && <span className="muted small"> (detected — set APP_URL for a public address)</span>}</>)}
        </tbody></table>
        <div className="row" style={{ marginTop: 12 }}><button className="btn" disabled={!e.configured} onClick={async () => {
          try { const r = await api('/api/admin/email/test', { method: 'POST', body: {} }); toast(`Test email sent to ${r.to}`); } catch (err: Any) { toast(err.message, 'err'); }
        }}>Send a test email to me</button></div></div>
      <div className="card"><h3>Database</h3><p className="sub">Where projects, users and invites are stored.</p>
        <table className="tbl"><tbody>{row('Connected to', e.database || '—')}</tbody></table>
        <p className="muted small" style={{ marginBottom: 0 }}>{/Supabase|PostgreSQL/.test(e.database || '') ? 'Data is stored in your Postgres database.' : <>Using the built-in local database. Set DATABASE_URL to your Supabase connection string and run <code>npm run db:push</code> to move your data there.</>}</p></div>
      <div className="card wide"><h3>Configuration</h3><p className="sub">Add these to the <code>.env</code> file in the project folder, then restart TicketForge. Passwords are never shown here.</p>
        <pre className="code">{`DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
APP_URL=https://tickets.yourcompany.com
# SendGrid
SENDGRID_API_KEY=SG....
SENDGRID_FROM=no-reply@yourcompany.com
SENDGRID_FROM_NAME="Your Company"
# …or any SMTP server
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@yourcompany.com
SMTP_PASS=your-app-password
SMTP_FROM="TicketForge <you@yourcompany.com>"`}</pre></div>
    </div>
  );
}

// ---------------------------------------------------------------- account
export function AccountModal() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  return (
    <Modal title="Your account" actions={[{ label: 'Close' }, { label: 'Change password', kind: 'primary', disabled: !cur || next.length < 8, onClick: async () => {
      try { await api('/api/auth/password', { method: 'POST', body: { current: cur, next } }); closeModal(); toast('Password changed'); }
      catch (e: Any) { toast(e.message, 'err'); }
    } }]}>
      <div className="row" style={{ flexWrap: 'nowrap', marginBottom: 16 }}><Avatar name={S.user.name} size={40} /><div><b>{S.user.name}</b><div className="muted small">{S.user.email} · {S.user.roleName}</div></div></div>
      <h4 style={{ margin: '0 0 8px' }}>Change password</h4>
      <label className="field"><span>Current password</span><TF type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
      <label className="field"><span>New password (at least 8 characters)</span><TF type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
    </Modal>
  );
}
