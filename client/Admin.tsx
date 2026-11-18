'use client';
// Administration: users, invites, roles & permissions, email. Also the "Your account" dialog.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { S, emit, useStore, feat, toast, openModal, closeModal, copyText, ago, closeProject, readNdjson, type Any } from './core';
import { Modal, Confirm, Ico, I, Avatar, Spinner, EmptyState, ErrorState, SectionNav, useSection, PlanLimits } from './ui';
import { loadAdminData, updateUser, resetUserPassword, deleteUser, revokeInvite, resendInvite, createInvites, updateRole, createRole, deleteRole,
  getAiSettings, saveAiSettings, patchAiSettings, aiAction, removeAiEntry, sendTestEmail, changePassword } from './api/admin';
import { RoutingSection } from './AiRouting';
import { ConfigsSection } from './AiConfigs';
import { AdminSkeleton } from './skeletons';
import { GenerationTab } from './GenerationTab';
import { AgentsTab } from './AgentsTab';
import { FeaturesTab } from './FeatureFlags';
import { DriveTab } from './Drive';
import { AiFlow } from './AiFlow';
import { BillingTab } from './Billing';
import { DecisionsSection } from './Jev';
import { PaymentsTab } from './Payments';
import { LimitsTab } from './Limits';
import { TF, TA, SF, CB, RB, DateF, PeopleF, MenuItem, opts } from './fields';

const TABS: [string, string, string][] = [['users', 'Users', I.people], ['invites', 'Invites', I.comment], ['roles', 'Roles & permissions', I.settings], ['ai', 'AI', I.sparkle], ['generation', 'Generation', I.test], ['agents', 'Agents', I.bot], ['features', 'Features', I.flag], ['gdrive', 'Google Drive', I.folder], ['billing', 'Billing', I.chart], ['payments', 'Plans & gateways', I.settings], ['limits', 'Limits', I.flag],['email', 'Email & database', I.doc]];
/** Tabs only the owner sees: people (users and invites) and feature flags. */
const OWNER_TABS = ['users', 'invites', 'features', 'gdrive', 'billing', 'payments'];
/** Features the owner locked. A feature that starts locked (Google Drive storage) isn't counted: nobody locked it. */
const lockedCount = () => (S.flags?.features || []).filter((f: Any) => f.locked && !f.off).length;
const A: Any = { users: [], roles: [], invites: [], projects: [], email: null, ai: null, loaded: false, error: null };

const accessText = (a: Any) => (a === 'all' ? 'All projects' : `${(a || []).length} project${(a || []).length === 1 ? '' : 's'}`);
const accessTitle = (a: Any) => (a === 'all' ? 'Every current and future project' : (a || []).map((id: string) => A.projects.find((p: Any) => p.id === id)?.name || id).join(', ') || 'No projects');
function inviteState(i: Any): [string, string] {
  if (i.accepted_at) return ['Accepted', 's-done'];
  if (i.revoked_at) return ['Revoked', 's-todo'];
  if (new Date(i.expires_at) < new Date()) return ['Expired', 's-todo'];
  return ['Pending', 's-inprogress'];
}
async function load() {
  // Users and invites are the owner's alone (the server refuses them to other administrators).
  const { users, roles, invites, projects, email, ai } = await loadAdminData(Boolean(S.user?.isOwner));
  Object.assign(A, { users, roles, invites, projects, email, loaded: true, error: null });
  if (ai) applyAi(ai); else emit();
}
// The first load shows an error screen; later refreshes keep the page and show a toast.
const reload = () => load().catch((e) => { if (A.loaded) toast(e.message, 'err'); else { A.error = e; emit(); } });
async function act(fn: () => Promise<Any>, ok?: string) {
  try { const r = await fn(); await load(); if (ok) toast(ok); return r; } catch (e: Any) { toast(e.message, 'err'); await reload(); return null; }
}

export default function AdminPage({ tab }: { tab: string }) {
  useStore();
  const [q, setQ] = useState('');
  useEffect(() => { closeProject(); reload(); }, []);
  const tt = tab === 'claude' ? 'ai' : tab;
  const tabs = TABS.filter(([k]) => (S.user?.isOwner || !OWNER_TABS.includes(k)) && (k !== 'gdrive' || (Boolean(S.flags) && feat('gdrive'))) && (k !== 'billing' || S.auth?.saas) && (k !== 'payments' || (S.auth?.saas && S.auth?.canManageBilling)));
  // A non-owner who opens Billing stays on it and is told it's for the owner (BillingTab), not sent to another tab.
  const t = tabs.some(([k]) => k === tt) || (tt === 'billing' && S.auth?.saas) ? tt : tabs[0][0];
  if (!A.loaded) {
    if (!A.error) return <AdminSkeleton />;
    return <div className="page"><div className="page-inner">
      <ErrorState title="Couldn’t load Administration" error={A.error} onRetry={async () => { A.error = null; emit(); await reload(); }}
        actions={<Link className="btn" href="/projects">Back to projects</Link>}><p>Users, roles and invites couldn’t be loaded.</p></ErrorState>
    </div></div>;
  }
  const pending = A.invites.filter((i: Any) => inviteState(i)[0] === 'Pending').length;
  return (
    <div className="page"><div className="page-inner">
      <div className="crumbs"><Link href="/projects">Projects</Link><span>/</span><span>Administration</span></div>
      <div className="page-h"><h1>Administration</h1><div className="spacer" />{S.user?.isOwner && <button className="btn primary" onClick={() => openModal(<InviteModal />)}><Ico svg={I.plus} />Invite people</button>}</div>
      <div className="tabbar">{tabs.map(([k, l, ic]) => (
        <Link key={k} className={`tab ${t === k ? 'active' : ''}`} href={`/admin/${k}`}><Ico svg={ic} />{l}
          {k === 'invites' && <span className="count">{pending}</span>}{k === 'features' && lockedCount() > 0 && <span className="count bad">{lockedCount()}</span>}{k === 'users' && <span className="count">{A.users.length}</span>}</Link>))}</div>
      {t === 'users' && <UsersTab q={q} setQ={setQ} />}
      {t === 'invites' && <InvitesTab />}
      {t === 'roles' && <RolesTab />}
      {t === 'ai' && <AiTab />}
      {t === 'generation' && <GenerationTab />}
      {t === 'agents' && <AgentsTab />}
      {t === 'features' && <FeaturesTab />}
      {t === 'gdrive' && <DriveTab />}
      {t === 'billing' && <BillingTab />}
      {t === 'payments' && <PaymentsTab />}
      {t === 'limits' && <LimitsTab />}
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
          <td><span title={u.isOwner ? 'The owner is always an Administrator' : undefined} style={{ display: 'inline-block' }}><SF filter value={u.roleId} disabled={u.isOwner} aria-label="Role"
            onChange={(e) => act(() => updateUser(u.id, { roleId: e.target.value }), `${u.name} is now ${A.roles.find((r: Any) => r.id === e.target.value)?.name}`)}>
            {A.roles.map((r: Any) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}</SF></span></td>
          <td><button className="btn sm" disabled={u.isOwner} title={accessTitle(u.projectAccess)} onClick={() => openModal(<AccessModal u={u} />)}><Ico svg={I.folder} />{accessText(u.projectAccess)}</button></td>
          <td><span className={`loz ${u.status === 'active' ? 's-done' : 's-todo'}`}>{u.status === 'active' ? 'Active' : 'Disabled'}</span></td>
          <td className="muted">{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</td>
          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
            <button className="btn sm subtle" title="Send a password reset link" onClick={async () => { const r = await act(() => resetUserPassword(u.id)); if (r) openModal(<LinkModal title={`Password reset for ${u.name}`} res={r} />); }}>Reset password</button>
            {!u.isOwner && u.id !== S.user.id && <>
              <button className="btn sm subtle" onClick={() => act(() => updateUser(u.id, { status: u.status === 'active' ? 'disabled' : 'active' }), `${u.name} ${u.status === 'active' ? 'disabled — signed out everywhere' : 'enabled'}`)}>{u.status === 'active' ? 'Disable' : 'Enable'}</button>
              <button className="icon-btn" title="Remove user" onClick={() => openModal(<Confirm title={`Remove ${u.name}?`} label="Remove user" text={`${u.email} loses access immediately. Their past comments and history stay.`}
                onYes={() => act(() => deleteUser(u.id), `Removed ${u.name}`)} />)}><Ico svg={I.trash} /></button>
            </>}
          </td>
        </tr>
      ))}
    </tbody></table>
    {!list.length && <EmptyState compact icon={I.search} tone="neutral" title={<>No users match “{q}”</>}
      actions={<button className="btn" onClick={() => setQ('')}>Clear search</button>}><p>Search by name, email or role.</p></EmptyState>}
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
      closeModal(); await act(() => updateUser(u.id, { projectAccess: access }), `Updated access for ${u.name}`);
    } }]}>
      <p className="muted" style={{ marginTop: 0 }}>{u.email} · {u.roleName}. Their role decides what they can do; this decides which projects they can see.</p>
      <AccessPicker value={access} onChange={setAccess} />
    </Modal>
  );
}
function LinkModal({ title, res }: { title: string; res: Any }) {
  return (
    <Modal title={title} actions={[{ label: 'Done', kind: 'primary' }]}>
      {res.linkHidden ? <p style={{ marginTop: 0 }}>{res.emailed ? <><Ico svg={I.check} /> Emailed to them.</> : <>{res.emailError || 'Email isn’t configured.'}</>} This person also belongs to other workspaces, so the link goes only to their email.</p> : <>
      <p style={{ marginTop: 0 }}>{res.emailed ? <><Ico svg={I.check} /> Emailed. You can also share the link directly:</> : <>{res.emailError || 'Email isn’t configured.'} Share this link with them:</>}</p>
      <div className="row" style={{ flexWrap: 'nowrap' }}><TF readOnly value={res.link} onFocus={(e) => e.target.select()} /><button className="btn" onClick={() => copyText(res.link)}><Ico svg={I.copy} />Copy</button></div></>}
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
              {st !== 'Accepted' && <ResendButton id={i.id} />}
              {st === 'Pending' && <button className="btn sm danger-subtle" onClick={() => act(() => revokeInvite(i.id), 'Invite revoked')}>Revoke</button>}
            </td>
          </tr>
        );
      })}
    </tbody></table> : <EmptyState icon={I.people} title="No invites yet" actions={<button className="btn primary" onClick={() => openModal(<InviteModal />)}><Ico svg={I.plus} />Invite people</button>}>
      <p>Invite teammates by email and choose their role and which projects they can open.</p></EmptyState>}
  </>;
}
/** Resend (or new link) for one invite: disabled with a spinner while it sends; the server enforces the cooldown and maximum. */
function ResendButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const go = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    const r = await act(() => resendInvite(id), A.email?.configured ? 'Invite resent' : 'New invite link created');
    inFlight.current = false; setBusy(false);
    if (r) openModal(<LinkModal title={`New invite link for ${r.email}`} res={r} />);
  };
  return <button className="btn sm subtle" disabled={busy} aria-busy={busy || undefined} onClick={go}>{busy && <span className="spinner" />}{A.email?.configured ? 'Resend' : 'New link'}</button>;
}
function InviteModal() {
  const def = A.roles.find((r: Any) => r.id === 'member') || A.roles[0];
  const [f, setF] = useState<Any>({ emails: '', roleId: def?.id, access: 'all', message: '' });
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false); // set at once, so a second click or Enter before React re-renders can't send again
  const send = async () => {
    if (inFlight.current || !f.emails.trim()) return;
    inFlight.current = true; setSending(true);
    try {
      const res = await createInvites({ emails: f.emails, roleId: f.roleId, projectAccess: f.access, message: f.message });
      const sent = res.results.filter((r: Any) => !r.error).length;
      if (sent) toast(`${sent === 1 ? 'Invite' : `${sent} invites`} sent`);
      for (const r of res.results) if (r.error) toast(`${r.email}: ${r.error}`, 'err');
      await load();
      S.nav('/admin/invites');
      openModal(<InviteResults results={res.results} />);
    } catch (e: Any) { toast(e.message, 'err'); } finally { inFlight.current = false; setSending(false); }
  };
  return (
    <Modal title="Invite people" persistent={sending} actions={[{ label: 'Cancel', disabled: sending }, { label: sending ? 'Sending…' : 'Send invites', kind: 'primary', disabled: !f.emails.trim(), busy: sending, onClick: send }]}>
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
    await act(() => updateRole(r.id, { name: r.name, description: r.description, permissions }),
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
        ? updateRole(role.id, { name: f.name.trim(), description: f.description.trim(), permissions: role.permissions })
        : createRole({ name: f.name.trim(), description: f.description.trim(), permissions: A.roles.find((r: Any) => r.id === f.copy)?.permissions || [] })), role ? 'Role updated' : `Created ${f.name.trim()}`);
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
      await act(() => deleteRole(role.id, role.users ? to : undefined), `Deleted ${role.name}`);
    } }]}>
      {role.users ? <><p style={{ marginTop: 0 }}>{role.users} user{role.users === 1 ? ' has' : 's have'} this role. Move them to:</p>
        <SF value={to} onChange={(e) => setTo(e.target.value)}>{others.map((r: Any) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}</SF></>
        : <p style={{ marginTop: 0 }}>Nobody has this role. Pending invites with it are cancelled.</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------- AI connection
/** Stores the admin view of the AI connection and refreshes the top-bar status. */
function applyAi(st: Any) {
  A.ai = st;
  const acct = st.account;
  S.status = { ...(S.status || {}), ...st, account: acct && { cli: acct.cli, signedIn: acct.signedIn, loggedIn: acct.loggedIn, subscriptionType: acct.subscriptionType } };
  emit();
}
const PLAN: Record<string, string> = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise', free: 'Free' };

function envExample(c: Any, id: string) {
  const p = c.providers.find((x: Any) => x.id === id) || {};
  const lines = [`AI_PROVIDER=${id}`];
  if (id === 'ollama') lines.push(`AI_BASE_URL=${p.base}`);
  else if (id === 'custom') lines.push('AI_BASE_URL=https://your-endpoint.example.com/v1', 'AI_API_KEY=your-key');
  else lines.push(`AI_API_KEY=your-key        # or ${p.keys?.[0]}`);
  lines.push(p.model ? `AI_MODEL=${p.model}` : 'AI_MODEL=a-model-your-key-can-use');
  return lines.join('\n');
}
const MISSING: Record<string, string> = { provider: 'a provider', key: 'the API key', model: 'the model', baseUrl: 'the endpoint URL' };
const ENV_MISSING: Record<string, string> = { provider: 'AI_PROVIDER', key: 'AI_API_KEY', model: 'AI_MODEL', baseUrl: 'AI_BASE_URL' };
const join = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');

function TestResult({ t, onPick }: { t: Any; onPick?: (m: string) => void }) {
  if (t.ok) return <div className="ok-banner"><Ico svg={I.check} /><span>Connected{t.used ? <> using <b>{t.used}</b></> : ''}. The AI replied “{t.reply}” in {(t.ms / 1000).toFixed(1)} s.</span></div>;
  return (
    <div className="test-fail">
      <div className="warn-banner danger"><Ico svg={I.warn} /><span>{t.error}</span></div>
      {t.models?.length > 0 && <ModelList models={t.models} onPick={onPick} />}
    </div>
  );
}
function ModelList({ models, onPick }: { models: string[]; onPick?: (m: string) => void }) {
  return <>
    <p className="small" style={{ margin: '12px 0 6px' }}>{models.length} models this key can use{onPick ? '. Click one to use it' : ''}:</p>
    <div className="model-list">{models.map((m) => <button key={m} type="button" className="label-chip" onClick={() => (onPick ? onPick(m) : copyText(m))}>{m}</button>)}</div>
  </>;
}

/** Add or edit one AI provider. The key is saved encrypted and never shown again. */
function ProviderModal({ c, entry }: { c: Any; entry?: Any }) {
  const saved = entry ? (c.settings?.providers || []).find((x: Any) => x.id === entry.entryId) : null;
  const [f, setF] = useState(() => ({ provider: saved?.provider || 'claude-sub', model: saved?.model || '', baseUrl: saved?.baseUrl || '', apiKey: '' }));
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<Any>(null);
  const [models, setModels] = useState<string[]>([]);
  const p = c.providers.find((x: Any) => x.id === f.provider) || {};
  const set = (k: string, v: string) => { setF((x) => ({ ...x, [k]: v })); setResult(null); };
  const pickProvider = (v: string) => { setF({ provider: v, model: '', baseUrl: '', apiKey: '' }); setModels([]); setResult(null); };
  // The saved key is reused only for the same provider and endpoint, so it's never sent to a different service.
  const keepsKey = Boolean(saved?.hasKey && saved.provider === f.provider && (saved.baseUrl || '') === f.baseUrl.trim().replace(/\/+$/, ''));
  const keyOptional = f.provider === 'ollama' || f.provider === 'custom';
  const needsUrl = f.provider === 'custom';
  const sub = p.kind === 'claude-code';
  const [advanced, setAdvanced] = useState(Boolean(saved?.baseUrl) && !needsUrl);
  const showUrl = !sub && (needsUrl || f.provider === 'ollama' || advanced);
  const canSave = Boolean(f.provider && (f.model.trim() || p.model) && (!needsUrl || f.baseUrl.trim()) && (keyOptional || keepsKey || f.apiKey.trim()));
  const draft = { id: saved?.id, provider: f.provider, model: f.model.trim(), baseUrl: f.baseUrl.trim(), apiKey: f.apiKey.trim() };
  const run = async (what: string, fn: () => Promise<void>) => { setBusy(what); try { await fn(); } catch (e: Any) { setResult({ ok: false, error: e.message }); } finally { setBusy(''); } };
  const loadModels = () => run('models', async () => {
    const r = await aiAction({ action: 'models', draft });
    setModels(r.models || []);
    if (!r.models?.length) setResult({ ok: false, error: 'The provider didn’t list any models. Type the model name instead.' });
  });
  const test = () => run('test', async () => setResult(await aiAction({ action: 'test', draft })));
  const save = () => run('save', async () => {
    applyAi(await saveAiSettings(draft));
    closeModal();
    toast(saved ? `${p.label} updated` : `${p.label} added`);
  });
  return (
    <Modal title={saved ? `Edit ${p.label || 'provider'}` : 'Add an AI provider'} wide
      left={<button className="btn" disabled={!!busy || !canSave} onClick={test}>{busy === 'test' ? <><Spinner />Testing…</> : 'Test'}</button>}
      actions={[{ label: 'Cancel' }, { label: busy === 'save' ? 'Saving…' : saved ? 'Save' : 'Add provider', kind: 'primary', disabled: !!busy || !canSave, onClick: save }]}>
      <div className="grid2">
        <label className="field"><span>Provider</span>
          <SF value={f.provider} onChange={(e) => pickProvider(e.target.value)}>{c.providers.map((x: Any) => <MenuItem key={x.id} value={x.id}>{x.label}</MenuItem>)}</SF></label>
        <label className="field"><span>{p.keyLabel || 'API key'}{keyOptional ? ' (optional)' : ''}</span>
          <TF type="password" value={f.apiKey} onChange={(e) => set('apiKey', e.target.value)} autoComplete="off"
            placeholder={keepsKey ? `Saved, ends with ${saved.keyHint}. Leave blank to keep it` : sub ? 'sk-ant-oat01-… from claude setup-token' : p.site ? `Paste your key from ${p.site}` : 'Paste your API key'} /></label>
      </div>
      {sub && <div className="sub-note small">
        <p style={{ margin: '0 0 6px' }}><b>Shared:</b> everyone’s AI requests use this plan. To use your subscription only for yourself, set it up in <b>My AI</b> (your avatar menu) instead; each person can add their own there. TicketForge runs Claude Code on this server, signed in with the token (no API billing).</p>
        <ol style={{ margin: '0 0 6px', paddingLeft: 18 }}>
          <li>In a terminal on your computer run <code>claude setup-token</code> and sign in with your Claude account.</li>
          <li>Paste the <code>sk-ant-oat01-…</code> token it prints here (shown once; valid for a year).</li>
        </ol>
        <p className="muted" style={{ margin: 0 }}>Needs Claude Code installed where TicketForge runs (your computer or a VPS: <code>npm install -g @anthropic-ai/claude-code</code>); serverless hosting such as Vercel can’t run it. It counts toward your plan’s limits, and your plan is meant for your own use: for a whole team, use a team plan or an API.</p>
      </div>}
      {showUrl ? <label className="field"><span>Endpoint URL{needsUrl ? '' : ' (optional)'}</span>
        <TF value={f.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder={p.base || 'https://your-endpoint.example.com/v1'} spellCheck={false} />
        {!needsUrl && <span className="muted small" style={{ fontWeight: 400 }}>Leave blank for {p.base || 'the default'}.</span>}</label>
        : sub ? null : <p className="small" style={{ margin: '-4px 0 12px' }}><a href="#" onClick={(e) => { e.preventDefault(); setAdvanced(true); }}>Use a custom endpoint</a></p>}
      <div className="field"><span>Model</span>
        <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'stretch' }}>
          <PeopleF avatars={false} value={f.model} onChange={(v) => set('model', v)} options={models} placeholder={p.model ? `${p.model} (default)` : 'Type a model name, or load the list'} />
          <button type="button" className="btn" disabled={!!busy || (!keyOptional && !keepsKey && !f.apiKey.trim()) || (needsUrl && !f.baseUrl.trim())} onClick={loadModels}>
            {busy === 'models' ? <><Spinner />Loading…</> : 'Load models'}</button>
        </div>
      </div>
      {models.length > 0 && !result && <ModelList models={models} onPick={(m) => set('model', m)} />}
      {result && <div style={{ marginTop: 12 }}><TestResult t={result} onPick={(m) => set('model', m)} /></div>}
    </Modal>
  );
}

/** The AI APIs in priority order, with their health and the controls to reorder, switch and test them. */
function ProvidersCard({ c }: { c: Any }) {
  const [busy, setBusy] = useState('');
  const [tests, setTests] = useState<Record<string, Any>>({});
  const list: Any[] = c.apis || [];
  const panel = list.filter((x) => x.source === 'panel');
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); } catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const patch = (b: Any) => patchAiSettings(b).then(applyAi);
  const move = (id: string, to: number) => run(`move:${id}`, async () => {
    const ids = panel.map((x) => x.entryId).filter((x) => x !== id);
    ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id);
    await patch({ order: ids });
  });
  const test = (x: Any) => run(`test:${x.entryId}`, async () => {
    const r = await aiAction({ action: 'test', id: x.entryId });
    setTests((t) => ({ ...t, [x.entryId]: r }));
    applyAi(await getAiSettings());
  });
  const reset = (id?: string) => run(`reset:${id || 'all'}`, async () => applyAi(await aiAction({ action: 'reset', id })));
  const remove = (x: Any) => openModal(<Confirm title={`Remove ${x.label}?`} label="Remove"
    text={<>{x.label}{x.model ? ` (${x.model})` : ''} and its saved API key are deleted. {list.length > 1 ? 'TicketForge keeps using the other providers.' : ''}</>}
    onYes={() => run(`remove:${x.entryId}`, async () => { applyAi(await removeAiEntry(x.entryId)); toast(`${x.label} removed`); })} />);
  const chip = (x: Any) => {
    if (!x.enabled) return <span className="loz">Off</span>;
    if (!x.configured) return <span className="loz t-fail" title={x.error || ''}>Incomplete</span>;
    if (x.cooldown) return <span className="loz t-blocked" title={x.cooldown.message}>{x.cooldown.kind === 'credits' ? 'Out of credits' : x.cooldown.kind === 'auth' ? 'Key rejected' : 'Limited'} · retry {new Date(x.cooldown.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>;
    if (x.active) return <span className="loz t-pass">In use</span>;
    return <span className="loz">Backup</span>;
  };
  const anyCooling = list.some((x) => x.cooldown) || c.account?.cooldown;
  return (
    <div className="card wide">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}><h3>AI providers</h3>
          <p className="sub" style={{ marginBottom: 12 }}>TicketForge uses the first provider that’s available. When one hits a rate limit, runs out of credits or fails, it
            switches to the next one automatically and tries the first again later. Keys are stored encrypted and never shown again.</p></div>
        <button className="btn primary" onClick={() => openModal(<ProviderModal c={c} />)}><Ico svg={I.plus} />Add provider</button>
      </div>

      {list.length ? <div className="prov-list">{list.map((x, i) => {
        const isPanel = x.source === 'panel';
        const pi = panel.findIndex((y) => y.entryId === x.entryId);
        const t = tests[x.entryId];
        return (
          <div key={x.entryId} className={`prov ${x.active ? 'active' : ''} ${x.enabled ? '' : 'off'}`}>
            <div className="prov-main">
              <span className="prov-n" title="Priority">{i + 1}</span>
              <div className="prov-info">
                <div className="row" style={{ gap: 8 }}><b>{x.label}</b>{x.model && <code>{x.model}</code>}{chip(x)}</div>
                <div className="muted small">{isPanel ? 'Set up in this panel' : 'From environment variables'}
                  {x.kind === 'openai' && x.baseUrl ? ` · ${x.baseUrl}` : ''}
                  {isPanel && (c.settings?.providers?.find((y: Any) => y.id === x.entryId)?.keyHint ? ` · key ends with ${c.settings.providers.find((y: Any) => y.id === x.entryId).keyHint}` : x.keySet ? '' : ' · no key')}
                  {!x.configured && x.missing?.length ? ` · missing ${join(x.missing.map((m: string) => MISSING[m]))}` : ''}
                  {x.cooldown && <> · {x.cooldown.reason}</>}</div>
              </div>
              <div className="prov-actions">
                {x.cooldown && <button className="btn sm" disabled={!!busy} onClick={() => reset(x.entryId)} title="Clear the cooldown and use it again now">Retry now</button>}
                <button className="btn sm subtle" disabled={!!busy || !x.configured} onClick={() => test(x)}>{busy === `test:${x.entryId}` ? <><Spinner />Testing</> : 'Test'}</button>
                {isPanel && <>
                  {pi > 0 && <button className="btn sm subtle" disabled={!!busy} onClick={() => move(x.entryId, 0)} title="Make this the provider TicketForge tries first">Use first</button>}
                  <button className="icon-btn" disabled={!!busy || pi <= 0} onClick={() => move(x.entryId, pi - 1)} aria-label="Move up" title="Move up"><Ico svg={I.up} /></button>
                  <button className="icon-btn" disabled={!!busy || pi >= panel.length - 1} onClick={() => move(x.entryId, pi + 1)} aria-label="Move down" title="Move down"><Ico svg={I.down} /></button>
                  <label className="check small" title={x.enabled ? 'Turn off' : 'Turn on'}><CB checked={x.enabled} disabled={!!busy} onChange={(e: Any) => run(`toggle:${x.entryId}`, () => patch({ id: x.entryId, enabled: e.target.checked }))} />On</label>
                  <button className="btn sm subtle" disabled={!!busy} onClick={() => openModal(<ProviderModal c={c} entry={x} />)}>Edit</button>
                  <button className="icon-btn" disabled={!!busy} onClick={() => remove(x)} aria-label={`Remove ${x.label}`} title="Remove"><Ico svg={I.trash} /></button>
                </>}
              </div>
            </div>
            {t && <div style={{ margin: '8px 0 0 36px' }}><TestResult t={t} /></div>}
          </div>
        );
      })}</div> : <EmptyState compact icon={I.sparkle} title="No AI providers yet" actions={<button className="btn primary" onClick={() => openModal(<ProviderModal c={c} />)}><Ico svg={I.plus} />Add provider</button>}>
        <p>Add one or more AI APIs. With two or more, TicketForge switches automatically when one is limited.</p></EmptyState>}

      <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
        <label className="check small" style={{ maxWidth: 620 }}><CB checked={c.accountFallback !== false} disabled={!!busy}
          onChange={(e: Any) => run('fallback', () => patch({ accountFallback: e.target.checked }))} />
          On your own computer, use these providers when the local AI can’t: not installed, not signed in, sign-in expired, or usage limit reached</label>
        {anyCooling && <button className="btn sm subtle" disabled={!!busy} onClick={() => reset()}>Clear all cooldowns</button>}
      </div>
    </div>
  );
}

/** Which AI runs on this computer (localhost): Claude Code or the GitHub Copilot CLI, and Copilot as Claude's backup. */
function LocalAiCard({ c }: { c: Any }) {
  const [busy, setBusy] = useState('');
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); } catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const patch = (b: Any) => patchAiSettings(b).then(applyAi);
  return (
    <div className="card wide"><h3>Local AI</h3>
      <p className="sub">Used when TicketForge is opened on this computer (localhost), with your own subscription. Model routing picks the model per task.</p>
      <div className="local-ai" style={{ marginTop: 0 }}>
        <div className="local-ai-h"><b>Local AI on this computer</b><span className="muted small">Used when TicketForge is opened at localhost. Runs with your own subscription.</span></div>
        <div className="local-ai-opts" role="radiogroup" aria-label="Local AI">
          {([['claude', 'Claude Code', 'Your Claude account (Claude Code).'], ['copilot', 'GitHub Copilot CLI', 'Your GitHub Copilot subscription (copilot).']] as [string, string, string][]).map(([k, l, d]) => (
            <button key={k} role="radio" aria-checked={(c.localEngine || 'claude') === k} className={(c.localEngine || 'claude') === k ? 'on' : ''} disabled={!!busy || (k === 'copilot' && !c.copilot.available)}
              onClick={() => run(`engine:${k}`, () => patch({ localEngine: k }))}><b>{l}</b><span className="muted small">{d}</span></button>))}
        </div>
        <div className="local-ai-cp small">
          <span className={`dot ${!c.copilot.available ? 'bad' : c.copilot.cooldown ? 'warn' : 'ok'}`} />
          {c.copilot.available
            ? <>GitHub Copilot CLI {c.copilot.version}{c.copilot.cooldown ? <> · {c.copilot.cooldown.reason} · back {new Date(c.copilot.cooldown.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</> : ' · ready'}</>
            : <>GitHub Copilot CLI isn’t installed. Run <code>npm install -g @github/copilot</code>, then <code>copilot</code> and <code>/login</code>.</>}
          {c.copilot.available && <label className="local-ai-model">Model
            <SF value={c.copilotModel || ''} disabled={!!busy} onChange={(e) => run('cpmodel', () => patch({ copilotModel: e.target.value }))}>
              {(c.copilot.models || ['']).map((m: string) => <MenuItem key={m || 'default'} value={m}>{m || 'Copilot’s default'}</MenuItem>)}</SF></label>}
        </div>
        {(c.localEngine || 'claude') === 'claude' && c.copilot.available && <label className="check small"><CB checked={Boolean(c.copilotBackup)} disabled={!!busy}
          onChange={(e: Any) => run('cpbackup', () => patch({ copilotBackup: e.target.checked }))} />
          When your Claude account is limited or signed out, use GitHub Copilot before the providers below</label>}
      </div>
    </div>
  );
}

function AiTab() {
  const c = A.ai;
  const [test, setTest] = useState<Any>(null);
  const [busy, setBusy] = useState('');
  const [showEnv, setShowEnv] = useState(false);
  const [envProv, setEnvProv] = useState('openai');
  const [sec, setSec] = useSection('tf.adminAiSec', ['flow', 'connection', 'routing', 'models', 'usage', 'savings', 'configs', 'providers', 'local'], 'flow');
  const refresh = async () => { setBusy('refresh'); try { applyAi(await getAiSettings(true)); setTest(null); } catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); } };
  if (!c) {
    return <div className="card"><ErrorState compact title="Couldn’t check the AI connection" onRetry={async () => applyAi(await getAiSettings(true))}>
      <p>The server didn’t report how TicketForge connects to AI.</p></ErrorState></div>;
  }
  const row = (k: string, v: React.ReactNode) => <tr><td className="muted" style={{ width: 200 }}>{k}</td><td>{v}</td></tr>;
  const acct = c.account;
  const runTest = async () => {
    setBusy('test'); setTest(null);
    try { setTest(await aiAction({ action: 'test' })); applyAi(await getAiSettings()); } catch (e: Any) { setTest({ ok: false, error: e.message }); } finally { setBusy(''); }
  };
  const why = c.forced ? `Chosen with AI_MODE=${c.mode} on the server.`
    : c.mode === 'account' ? 'You opened TicketForge on this computer (localhost), so it uses your personal Claude account through Claude Code.'
    : c.serverless ? 'This copy runs on serverless hosting, so it uses the AI providers below.'
    : 'TicketForge was opened on a web address (not localhost), so it uses the AI providers below.';
  const now = c.mode === 'account' && !c.switched ? 'Your Claude account' : c.label;
  const items = [
    { key: 'flow', label: 'AI flow', hint: 'Connect providers like nodes', icon: I.grid },
    { key: 'connection', label: 'Connection', hint: 'Status, sign-in and test', icon: I.sparkle },
    { key: 'routing', label: 'Model routing', hint: 'Presets and the tier for each task', icon: I.chart, badge: c.routingOn ? null : <span className="loz">Off</span> },
    { key: 'models', label: 'Models per tier', hint: 'High, Standard and Light on each AI', icon: I.bot },
    { key: 'usage', label: 'Usage & suggestions', hint: 'Calls, tokens, cost and how to use less', icon: I.history },
    { key: 'savings', label: 'Savings & limits', hint: 'Reused answers, budget and prices', icon: I.check, badge: c.budget?.over ? <span className="loz t-fail">Budget</span> : c.budget?.near ? <span className="loz t-blocked">{Math.round(c.budget.pct * 100)}%</span> : null },
    { key: 'configs', label: 'Configurations', hint: 'Named AI setups for AI buttons', icon: I.settings, badge: (c.settings?.configs || []).length ? <span className="count">{c.settings.configs.length}</span> : null },
    { key: 'providers', label: 'Providers', hint: 'AI APIs, in priority order', icon: I.grid, badge: (c.apis || []).some((x: Any) => x.cooldown) ? <span className="loz t-blocked">Limited</span> : null },
    { key: 'decisions', label: 'Decisions', hint: 'Fast choices with Jev (optional)', icon: I.flag },
    ...(c.copilot ? [{ key: 'local', label: 'Local AI', hint: 'Claude Code or GitHub Copilot', icon: I.user }] : []),
  ];
  return (
    <div className="sec-layout">
      <SectionNav label="AI settings" items={items} value={sec} onChange={setSec} />
      <div className="sec-body">
      {sec === 'flow' && <AiFlow c={c} actions={{
        onSaved: applyAi,
        add: () => openModal(<ProviderModal c={c} />),
        edit: (x: Any) => openModal(<ProviderModal c={c} entry={x} />),
        remove: (x: Any) => openModal(<Confirm title={`Remove ${x.label}?`} label="Remove"
          text={<>{x.label}{x.model ? ` (${x.model})` : ''} and its saved API key are deleted.</>}
          onYes={async () => { try { applyAi(await removeAiEntry(x.entryId)); toast(`${x.label} removed`); } catch (e: Any) { toast(e.message, 'err'); } }} />),
        goto: setSec,
      }} />}
      {['routing', 'models', 'usage', 'savings'].includes(sec) && <RoutingSection key={`${sec}${JSON.stringify(c.settings?.routing)}`} c={c} onSaved={applyAi} part={sec as 'routing' | 'models' | 'usage' | 'savings'} go={setSec} />}
      {sec === 'local' && c.copilot && <div className="cards"><LocalAiCard c={c} />
        {c.account?.signedIn && <div className="card wide"><h3>Claude plan limits</h3>
          <p className="sub">Your Claude {c.account?.subscriptionType ? `${String(c.account.subscriptionType).replace(/^./, (x: string) => x.toUpperCase())} ` : ''}plan’s usage, read from Anthropic with your Claude Code sign-in on this computer (the same numbers as Claude’s own usage page). The AI pill warns at 80%.{c.localEngine !== 'copilot' && c.copilot.available ? ' Near the weekly limit? Switch to Copilot with ⌥⇧A.' : ''}</p>
          {c.planUsage ? <PlanLimits u={c.planUsage} /> : <p className="muted small">Not available: sign in to Claude Code with a Pro or Max plan to see these.</p>}
          {c.planUsage?.checkedAt && <p className="muted small" style={{ marginBottom: 0 }}>Checked {new Date(c.planUsage.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · updates every minute.</p>}
        </div>}</div>}
      {sec === 'decisions' && <DecisionsSection />}
      {sec === 'configs' && <ConfigsSection c={c} onSaved={applyAi} />}
      {sec === 'providers' && <div className="cards"><ProvidersCard c={c} />
      <div className="card wide">
        <p className="muted small" style={{ margin: 0 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); setShowEnv(!showEnv); }}>{showEnv ? 'Hide' : 'Prefer environment variables?'}</a>
          {showEnv && <> A provider set with environment variables (on Vercel: <b>Settings → Environment Variables</b>, then redeploy) is used after the ones above.</>}</p>
        {showEnv && <>
          <label className="field" style={{ maxWidth: 280, marginTop: 12 }}><span>Provider</span>
            <SF value={envProv} onChange={(e) => setEnvProv(e.target.value)}>{c.providers.map((x: Any) => <MenuItem key={x.id} value={x.id}>{x.label}</MenuItem>)}</SF></label>
          <pre className="code">{envExample(c, envProv)}</pre></>}
      </div></div>}
      {sec === 'connection' && <div className="cards">
      <div className="card wide"><h3>AI connection</h3>
        <p className="sub">TicketForge uses AI to write and improve tickets and test scripts. On your own computer it uses your Claude account; anywhere else, the providers below.</p>
        <table className="tbl"><tbody>
          {row('This address uses', <><span className={`loz ${c.ready ? 't-pass' : 't-fail'}`}>{c.ready ? 'Ready' : 'Not set up'}</span>{' '}
            <b>{now}</b>{c.switched && <span className="loz t-blocked" style={{ marginLeft: 6 }}>Switched</span>}{c.backups > 0 && <span className="muted small"> · {c.backups} backup{c.backups > 1 ? 's' : ''}</span>}
            <div className="muted small">{why}{c.mode === 'account' && c.switched && <> Your Claude account {acct?.cooldown ? 'hit its usage limit' : 'isn’t available'}, so the providers below stand in.</>}</div></>)}
          {c.mode === 'account' && <>
            {row('Claude Code', acct?.cli?.available
              ? <>{acct.cli.version}{acct.cli.outdated && <span className="loz t-blocked" style={{ marginLeft: 6 }}>Outdated</span>}<div className="muted small" style={{ wordBreak: 'break-all' }}>{acct.cli.path}</div></>
              : <span className="loz t-fail">Not installed</span>)}
            {acct?.cli?.available && row('Signed in', acct.loggedIn
              ? <><b>{acct.email || 'Claude account'}</b>{acct.subscriptionType && <span className="label-chip" style={{ marginLeft: 6 }}>{PLAN[acct.subscriptionType] || acct.subscriptionType}</span>}
                  {acct.orgName && <div className="muted small">{acct.orgName}</div>}
                  {acct.cooldown && <div className="small" style={{ color: 'var(--warning)' }}>Usage limit reached · resets {new Date(acct.cooldown.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{c.accountFallback ? '. Using the providers below until then.' : '.'}</div>}</>
              : acct.loggedIn === false ? <span className="loz t-fail">Not signed in</span> : <span className="muted">Unknown: update Claude Code to see this</span>)}
          </>}
          {c.last && row('Last answered by', <>{c.last.label} <span className="muted small">· {ago(c.last.at)}</span></>)}
        </tbody></table>

        {c.mode === 'account' && !acct?.signedIn && <div className="claude-steps"><p style={{ marginBottom: 0 }}>
          {acct?.cli?.available ? <>Open Terminal on this computer, run <code>claude</code> and sign in with your Claude account. Then click <b>Check again</b>.</>
            : <>Install Claude Code on this computer with <code>npm install -g @anthropic-ai/claude-code</code>, run <code>claude</code> and sign in with your Claude account. Then click <b>Check again</b>.</>}</p></div>}

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={!!busy || !c.ready} onClick={runTest}>{busy === 'test' ? <><Spinner />Testing…</> : 'Test connection'}</button>
          <button className="btn subtle" disabled={!!busy} onClick={refresh}><Ico svg={I.refresh} />Check again</button>
        </div>
        {test && <div style={{ marginTop: 12 }}><TestResult t={test} /></div>}
      </div>
      <div className="card wide"><h3>At a glance</h3>
        <table className="tbl"><tbody>
          {row('Model routing', c.routingOn ? <>On · <a href="#" onClick={(e) => { e.preventDefault(); setSec('routing'); }}>{(c.tasks || []).length} tasks across High, Standard and Light</a></> : <>Off · every task uses the main model</>)}
          {row('AI APIs', <><a href="#" onClick={(e) => { e.preventDefault(); setSec('providers'); }}>{(c.apis || []).filter((x: Any) => x.enabled && x.configured).length} ready</a>{(c.apis || []).some((x: Any) => x.cooldown) && <span className="loz t-blocked" style={{ marginLeft: 6 }}>Some limited</span>}</>)}
          {c.copilot && row('Local AI', <a href="#" onClick={(e) => { e.preventDefault(); setSec('local'); }}>{c.localEngine === 'copilot' ? 'GitHub Copilot' : 'Claude Code'}{c.localEngine !== 'copilot' && c.copilotBackup ? ', Copilot as backup' : ''}</a>)}
        </tbody></table>
      </div>
      </div>}
      </div>
    </div>
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
          try { const r = await sendTestEmail(); toast(`Test email sent to ${r.to}`); } catch (err: Any) { toast(err.message, 'err'); }
        }}>Send a test email to me</button></div></div>
      <div className="card"><h3>Database</h3><p className="sub">Where projects, users and invites are stored.</p>
        <table className="tbl"><tbody>{row('Connected to', e.database || '—')}
          {e.rls && row('Row-level security', e.rls.appRole
            ? <span className="loz t-pass">On · {e.rls.tables} tables</span>
            : e.rls.enabled ? <span className="loz t-blocked" title={e.rls.error || ''}>Tables locked, app runs as owner</span>
            : <span className="loz">Not available (local database)</span>)}</tbody></table>
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
      try { await changePassword(cur, next); closeModal(); toast('Password changed'); }
      catch (e: Any) { toast(e.message, 'err'); }
    } }]}>
      <div className="row" style={{ flexWrap: 'nowrap', marginBottom: 16 }}><Avatar name={S.user.name} size={40} /><div><b>{S.user.name}</b><div className="muted small">{S.user.email} · {S.user.roleName}</div></div></div>
      <h4 style={{ margin: '0 0 8px' }}>Change password</h4>
      <label className="field"><span>Current password</span><TF type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
      <label className="field"><span>New password (at least 8 characters)</span><TF type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
    </Modal>
  );
}
