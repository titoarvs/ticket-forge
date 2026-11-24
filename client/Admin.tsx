'use client';

// Administration: users, invites, roles & permissions, email. Also the "Your account" dialog.

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useStore, closeProject, S, feat, emit, type Any, openModal } from './core';
import { ErrorState, Ico, I } from './ui';
import { Crumbs } from './views';
import { AdminSkeleton } from './skeletons';
import { GenerationTab } from './GenerationTab';
import { AgentsTab } from './AgentsTab';
import { FeaturesTab } from './FeatureFlags';
import { DriveTab } from './Drive';
import { BillingTab } from './Billing';
import { PaymentsTab } from './Payments';
import { LimitsTab } from './Limits';
import { reload, TABS, OWNER_TABS, A, inviteState, lockedCount, UsersTab } from './Admin/UsersTab';
import { InviteModal, InvitesTab } from './Admin/InvitesTab';
import { RolesTab } from './Admin/RolesTab';
import { AiTab } from './Admin/AiTab';
import { EmailTab } from './Admin/AccountModal';
import { GithubTab } from './Admin/GithubTab';

export { AccountModal } from './Admin/AccountModal';

export default function AdminPage({ tab }: { tab: string }) {
  useStore();
  const [q, setQ] = useState('');
  useEffect(() => {
    closeProject();
    reload();
  }, []);
  const tt = tab === 'claude' ? 'ai' : tab;
  const tabs = TABS.filter(
    ([k]) =>
      (S.user?.isOwner || !OWNER_TABS.includes(k)) &&
      (k !== 'gdrive' || (Boolean(S.flags) && feat('gdrive'))) &&
      (k !== 'billing' || S.auth?.saas) &&
      (k !== 'payments' || (S.auth?.saas && S.auth?.canManageBilling)),
  );
  // A non-owner who opens Billing stays on it and is told it's for the owner (BillingTab), not sent
  // to another tab.
  const t = tabs.some(([k]) => k === tt) || (tt === 'billing' && S.auth?.saas) ? tt : tabs[0][0];
  if (!A.loaded) {
    if (!A.error) return <AdminSkeleton />;
    return (
      <div className="page">
        <div className="page-inner">
          <ErrorState
            title="Couldn’t load Administration"
            error={A.error}
            onRetry={async () => {
              A.error = null;
              emit();
              await reload();
            }}
            actions={
              <Link className="btn" href="/projects">
                Back to projects
              </Link>
            }
          >
            <p>Users, roles and invites couldn’t be loaded.</p>
          </ErrorState>
        </div>
      </div>
    );
  }
  const pending = A.invites.filter((i: Any) => inviteState(i)[0] === 'Pending').length;
  return (
    <div className="page">
      <div className="page-inner">
        <Crumbs>
          <span>Administration</span>
        </Crumbs>
        <div className="page-h">
          <Ico svg={I.people} size={24} className="page-ic" />
          <h1>Administration</h1>
          <div className="spacer" />
          {S.user?.isOwner && (
            <button className="btn primary" onClick={() => openModal(<InviteModal />)}>
              <Ico svg={I.plus} />
              Invite people
            </button>
          )}
        </div>
        <div className="tabbar">
          {tabs.map(([k, l, ic]) => (
            <Link key={k} className={`tab ${t === k ? 'active' : ''}`} href={`/admin/${k}`}>
              <Ico svg={ic} />
              {l}
              {k === 'invites' && <span className="count">{pending}</span>}
              {k === 'features' && lockedCount() > 0 && (
                <span className="count bad">{lockedCount()}</span>
              )}
              {k === 'users' && <span className="count">{A.users.length}</span>}
            </Link>
          ))}
        </div>
        {t === 'users' && <UsersTab q={q} setQ={setQ} />}
        {t === 'invites' && <InvitesTab />}
        {t === 'roles' && <RolesTab />}
        {t === 'ai' && <AiTab />}
        {t === 'generation' && <GenerationTab />}
        {t === 'agents' && <AgentsTab />}
        {t === 'features' && <FeaturesTab />}
        {t === 'github' && <GithubTab />}
        {t === 'gdrive' && <DriveTab />}
        {t === 'billing' && <BillingTab />}
        {t === 'payments' && <PaymentsTab />}
        {t === 'limits' && <LimitsTab />}
        {t === 'email' && <EmailTab />}
      </div>
    </div>
  );
}
