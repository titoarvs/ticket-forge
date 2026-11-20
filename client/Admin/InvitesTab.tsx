'use client';
import { useState, useRef } from 'react';
import Link from 'next/link';
import { type Any, closeModal, copyText, ago, openModal, toast, S } from '../core';
import { Modal, Ico, I, EmptyState } from '../ui';
import { updateUser, revokeInvite, resendInvite, createInvites } from '../api/admin';
import { RB, CB, TF, TA, SF, MenuItem } from '../fields';
import { A, act, inviteState, accessTitle, accessText, load } from './UsersTab';
import { InviteResults } from './RolesTab';

function AccessPicker({ value, onChange }: { value: Any; onChange: (v: Any) => void }) {
  const all = value === 'all';
  const sel = new Set(all ? [] : value || []);
  return (
    <div className="field">
      <span>Project access</span>
      <RB
        checked={all}
        onChange={() => onChange('all')}
        label="All projects, including future ones"
      />
      <RB checked={!all} onChange={() => onChange([])} label="Only selected projects" />
      {!all && (
        <div className="proj-pick">
          {A.projects.length ? (
            A.projects.map((p: Any) => (
              <label key={p.id} className="check">
                <CB
                  checked={sel.has(p.id)}
                  onChange={(e) => {
                    const n = new Set(sel);
                    if (e.target.checked) n.add(p.id);
                    else n.delete(p.id);
                    onChange([...n]);
                  }}
                />{' '}
                <span className="key">{p.key}</span> {p.name}
              </label>
            ))
          ) : (
            <p className="muted small">No projects yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
export function AccessModal({ u }: { u: Any }) {
  const [access, setAccess] = useState(u.projectAccess);
  return (
    <Modal
      title={`Project access for ${u.name}`}
      actions={[
        { label: 'Cancel' },
        {
          label: 'Save',
          kind: 'primary',
          onClick: async () => {
            closeModal();
            await act(
              () => updateUser(u.id, { projectAccess: access }),
              `Updated access for ${u.name}`,
            );
          },
        },
      ]}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {u.email} · {u.roleName}. Their role decides what they can do; this decides which projects
        they can see.
      </p>
      <AccessPicker value={access} onChange={setAccess} />
    </Modal>
  );
}
export function LinkModal({ title, res }: { title: string; res: Any }) {
  return (
    <Modal title={title} actions={[{ label: 'Done', kind: 'primary' }]}>
      {res.linkHidden ? (
        <p style={{ marginTop: 0 }}>
          {res.emailed ? (
            <>
              <Ico svg={I.check} /> Emailed to them.
            </>
          ) : (
            <>{res.emailError || 'Email isn’t configured.'}</>
          )}{' '}
          This person also belongs to other workspaces, so the link goes only to their email.
        </p>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            {res.emailed ? (
              <>
                <Ico svg={I.check} /> Emailed. You can also share the link directly:
              </>
            ) : (
              <>{res.emailError || 'Email isn’t configured.'} Share this link with them:</>
            )}
          </p>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <TF readOnly value={res.link} onFocus={(e) => e.target.select()} />
            <button className="btn" onClick={() => copyText(res.link)}>
              <Ico svg={I.copy} />
              Copy
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
// ---------------------------------------------------------------- invites
export function InvitesTab() {
  return (
    <>
      {!A.email?.configured && (
        <div className="warn-banner">
          <Ico svg={I.warn} />
          <span>
            Email isn’t configured, so invites give you a link to share yourself. See the{' '}
            <Link href="/admin/email">Email</Link> tab to send them automatically.
          </span>
        </div>
      )}
      {A.invites.length ? (
        <table className="tbl">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Projects</th>
              <th>Invited by</th>
              <th>Sent</th>
              <th>Status</th>
              <th>Delivery</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {A.invites.map((i: Any) => {
              const [st, cls] = inviteState(i);
              return (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>{i.role_name}</td>
                  <td title={accessTitle(i.project_access)}>{accessText(i.project_access)}</td>
                  <td className="muted">{i.invited_by_name || '—'}</td>
                  <td className="muted">{ago(i.created_at)}</td>
                  <td>
                    <span className={`loz ${cls}`}>{st}</span>
                    {st === 'Pending' && (
                      <div className="muted small">
                        expires{' '}
                        {new Date(i.expires_at).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </div>
                    )}
                  </td>
                  <td className="muted small">
                    {i.emailed ? (
                      <>
                        <Ico svg={I.check} /> Emailed
                      </>
                    ) : (
                      'Link only'
                    )}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {st !== 'Accepted' && <ResendButton id={i.id} />}
                    {st === 'Pending' && (
                      <button
                        className="btn sm danger-subtle"
                        onClick={() => act(() => revokeInvite(i.id), 'Invite revoked')}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <EmptyState
          icon={I.people}
          title="No invites yet"
          actions={
            <button className="btn primary" onClick={() => openModal(<InviteModal />)}>
              <Ico svg={I.plus} />
              Invite people
            </button>
          }
        >
          <p>Invite teammates by email and choose their role and which projects they can open.</p>
        </EmptyState>
      )}
    </>
  );
}
/**
 * Resend (or new link) for one invite: disabled with a spinner while it sends; the server enforces
 * the cooldown and maximum.
 */
function ResendButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const go = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const r = await act(
      () => resendInvite(id),
      A.email?.configured ? 'Invite resent' : 'New invite link created',
    );
    inFlight.current = false;
    setBusy(false);
    if (r) openModal(<LinkModal title={`New invite link for ${r.email}`} res={r} />);
  };
  return (
    <button className="btn sm subtle" disabled={busy} aria-busy={busy || undefined} onClick={go}>
      {busy && <span className="spinner" />}
      {A.email?.configured ? 'Resend' : 'New link'}
    </button>
  );
}
export function InviteModal() {
  const def = A.roles.find((r: Any) => r.id === 'member') || A.roles[0];
  const [f, setF] = useState<Any>({ emails: '', roleId: def?.id, access: 'all', message: '' });
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false); // set at once, so a second click or Enter before React re-renders can't send again
  const send = async () => {
    if (inFlight.current || !f.emails.trim()) return;
    inFlight.current = true;
    setSending(true);
    try {
      const res = await createInvites({
        emails: f.emails,
        roleId: f.roleId,
        projectAccess: f.access,
        message: f.message,
      });
      const sent = res.results.filter((r: Any) => !r.error).length;
      if (sent) toast(`${sent === 1 ? 'Invite' : `${sent} invites`} sent`);
      for (const r of res.results) if (r.error) toast(`${r.email}: ${r.error}`, 'err');
      await load();
      S.nav('/admin/invites');
      openModal(<InviteResults results={res.results} />);
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };
  return (
    <Modal
      title="Invite people"
      persistent={sending}
      actions={[
        { label: 'Cancel', disabled: sending },
        {
          label: sending ? 'Sending…' : 'Send invites',
          kind: 'primary',
          disabled: !f.emails.trim(),
          busy: sending,
          onClick: send,
        },
      ]}
    >
      <label className="field">
        <span>
          Email addresses <span className="req">*</span>
        </span>
        <TA
          autoFocus
          style={{ minHeight: 70 }}
          value={f.emails}
          onChange={(e) => setF({ ...f, emails: e.target.value })}
          placeholder="ana@company.com, ben@company.com"
        />
        <span className="muted small" style={{ fontWeight: 400 }}>
          Separate several with commas, spaces or new lines.
        </span>
      </label>
      <label className="field">
        <span>Role</span>
        <SF value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })}>
          {A.roles.map((r: Any) => (
            <MenuItem key={r.id} value={r.id}>
              {r.name} — {r.description}
            </MenuItem>
          ))}
        </SF>
      </label>
      <AccessPicker value={f.access} onChange={(v) => setF({ ...f, access: v })} />
      <label className="field">
        <span>Personal message (optional)</span>
        <TA
          value={f.message}
          onChange={(e) => setF({ ...f, message: e.target.value })}
          placeholder="Hi! Join us to plan the next release."
        />
      </label>
      <p className="muted small">
        {A.email?.configured
          ? `Invites are emailed from ${A.email.from || A.email.user}.`
          : 'Email isn’t configured: you’ll get a link to send each person yourself.'}{' '}
        Links expire after 7 days.
      </p>
    </Modal>
  );
}
