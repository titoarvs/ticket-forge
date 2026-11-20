'use client';
import { useState } from 'react';
import { toast, closeModal, S } from '../core';
import { Modal, Avatar } from '../ui';
import { sendTestEmail, changePassword } from '../api/admin';
import { TF } from '../fields';
import { A } from './UsersTab';

// ---------------------------------------------------------------- email & database
export function EmailTab() {
  const e = A.email || {};
  const row = (k: string, v: React.ReactNode) => (
    <tr>
      <td className="muted" style={{ width: 200 }}>
        {k}
      </td>
      <td>{v}</td>
    </tr>
  );
  return (
    <div className="cards">
      <div className="card">
        <h3>Email</h3>
        <p className="sub">Used for invites and password resets.</p>
        <table className="tbl">
          <tbody>
            {row(
              'Status',
              e.configured ? (
                <span className="loz s-done">Configured{e.provider ? ` · ${e.provider}` : ''}</span>
              ) : (
                <span className="loz s-todo">Not configured</span>
              ),
            )}
            {row('Server', e.host ? `${e.host}:${e.port}${e.secure ? ' (TLS)' : ''}` : '—')}
            {row('Username', e.user || '—')}
            {row('From', e.from || '—')}
            {row(
              'Links point to',
              <>
                {e.appUrl}
                {!e.appUrlSet && (
                  <span className="muted small">
                    {' '}
                    (detected — set APP_URL for a public address)
                  </span>
                )}
              </>,
            )}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn"
            disabled={!e.configured}
            onClick={async () => {
              try {
                const r = await sendTestEmail();
                toast(`Test email sent to ${r.to}`);
              } catch (err: any) {
                toast(err.message, 'err');
              }
            }}
          >
            Send a test email to me
          </button>
        </div>
      </div>
      <div className="card">
        <h3>Database</h3>
        <p className="sub">Where projects, users and invites are stored.</p>
        <table className="tbl">
          <tbody>
            {row('Connected to', e.database || '—')}
            {e.rls &&
              row(
                'Row-level security',
                e.rls.appRole ? (
                  <span className="loz t-pass">On · {e.rls.tables} tables</span>
                ) : e.rls.enabled ? (
                  <span className="loz t-blocked" title={e.rls.error || ''}>
                    Tables locked, app runs as owner
                  </span>
                ) : (
                  <span className="loz">Not available (local database)</span>
                ),
              )}
          </tbody>
        </table>
        <p className="muted small" style={{ marginBottom: 0 }}>
          {/Supabase|PostgreSQL/.test(e.database || '') ? (
            'Data is stored in your Postgres database.'
          ) : (
            <>
              Using the built-in local database. Set DATABASE_URL to your Supabase connection string
              and run <code>npm run db:push</code> to move your data there.
            </>
          )}
        </p>
      </div>
      <div className="card wide">
        <h3>Configuration</h3>
        <p className="sub">
          Add these to the <code>.env</code> file in the project folder, then restart TicketForge.
          Passwords are never shown here.
        </p>
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
SMTP_FROM="TicketForge <you@yourcompany.com>"`}</pre>
      </div>
    </div>
  );
}
// ---------------------------------------------------------------- account
export function AccountModal() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  return (
    <Modal
      title="Your account"
      actions={[
        { label: 'Close' },
        {
          label: 'Change password',
          kind: 'primary',
          disabled: !cur || next.length < 8,
          onClick: async () => {
            try {
              await changePassword(cur, next);
              closeModal();
              toast('Password changed');
            } catch (e: any) {
              toast(e.message, 'err');
            }
          },
        },
      ]}
    >
      <div className="row" style={{ flexWrap: 'nowrap', marginBottom: 16 }}>
        <Avatar name={S.user.name} size={40} />
        <div>
          <b>{S.user.name}</b>
          <div className="muted small">
            {S.user.email} · {S.user.roleName}
          </div>
        </div>
      </div>
      <h4 style={{ margin: '0 0 8px' }}>Change password</h4>
      <label className="field">
        <span>Current password</span>
        <TF
          type="password"
          autoComplete="current-password"
          value={cur}
          onChange={(e) => setCur(e.target.value)}
        />
      </label>
      <label className="field">
        <span>New password (at least 8 characters)</span>
        <TF
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
    </Modal>
  );
}
