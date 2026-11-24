'use client';
// You, at the bottom of the sidebar: your name, and the account menu.
import {
  S,
  can,
  emit,
  isDeployed,
  openModal,
  runPlace,
  setMenu,
  setRunPlace,
  toast,
} from '../core';
import { I, Ico, Menu, Avatar } from '../ui';
import { logout } from '../actions';
import { AccountModal } from '../Admin/AccountModal';
import { MyAiModal } from '../MyAi';
import { startTourHere, resetTours } from '../tour';

function toggleRunPlace() {
  const to = runPlace() === 'github' ? 'local' : 'github';
  setRunPlace(to);
  toast(
    to === 'github'
      ? 'Code jobs and test runs now run on GitHub Actions'
      : 'Code jobs and test runs now run on this computer',
  );
}
/** Closes the menu first, so the tour can point at the page. */
export function showAround() {
  S.menu = null;
  emit();
  setTimeout(() => {
    if (!startTourHere()) toast('There’s no tour for this page.');
  }, 150);
}
async function restartTours() {
  S.menu = null;
  emit();
  await resetTours();
  toast('Tours will show again on each page.');
  setTimeout(startTourHere, 150);
}
const openTab = (url: string) => window.open(url, '_blank', 'noopener');

function AccountMenuItems() {
  const onGithub = runPlace() === 'github';
  return (
    <>
      <div className="acct">
        <Avatar name={S.user.name} size={36} />
        <div>
          <b>{S.user.name}</b>
          <span className="muted small">{S.user.email}</span>
          <span className="label-chip">
            {S.user.roleName}
            {S.user.isOwner ? ' · Owner' : ''}
          </span>
        </div>
      </div>
      <hr />
      {can('users.manage') && S.user?.isOwner && (
        <button onClick={() => S.nav('/admin/invites')}>
          <Ico svg={I.plus} />
          Invite people
        </button>
      )}
      <button onClick={() => openModal(<AccountModal />)}>
        <Ico svg={I.user} />
        Your account &amp; password
      </button>
      <button onClick={() => openModal(<MyAiModal />)}>
        <Ico svg={I.sparkle} />
        My AI (your Claude subscription)
      </button>
      {!isDeployed() && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleRunPlace();
          }}
          title="Where Write code with AI and test runs go (this browser only; the deployed app always uses GitHub Actions)"
        >
          <Ico svg={onGithub ? I.pr : I.folder} />
          {onGithub ? 'Code & tests: GitHub Actions' : 'Code & tests: this computer'}
        </button>
      )}
      <hr />
      <button onClick={restartTours}>
        <Ico svg={I.undo} />
        Restart all tours
      </button>
      <button onClick={() => openTab('/timeline')}>
        <Ico svg={I.history} />
        What’s new: product timeline
      </button>
      <button onClick={() => openTab('/terms')}>
        <Ico svg={I.doc} />
        Terms of Use
      </button>
      <button onClick={() => openTab('/privacy')}>
        <Ico svg={I.doc} />
        Privacy Policy
      </button>
      <hr />
      <button onClick={logout}>
        <Ico svg={I.external} />
        Log out
      </button>
    </>
  );
}

export function AccountCard() {
  const open = S.menu === 'account';
  return (
    <Menu
      id="account"
      left
      up
      style={{ display: 'flex' }}
      button={
        <button
          className={`me-card ${open ? 'on' : ''}`}
          data-tour="account"
          aria-label="Account menu"
          aria-haspopup="menu"
          aria-expanded={open}
          title={`${S.user.name}: account`}
          onClick={() => setMenu('account')}
        >
          <Avatar name={S.user.name} size={36} />
          <span className="me-txt side-text">
            <b>{S.user.name}</b>
            <small>{S.user.email}</small>
          </span>
          <Ico svg={I.updown} className="me-updown" />
        </button>
      }
    >
      <AccountMenuItems />
    </Menu>
  );
}
