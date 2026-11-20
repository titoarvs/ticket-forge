'use client';
import { useState, useEffect } from 'react';
import { type Any, mutate, P, S, api, emit, can, uid } from '../core';
import { Ico, I } from '../ui';
import { TF, TA } from '../fields';
import { RepoSyncCard } from '../RepoSync';
import { SetupOverview, PagesSection } from './PagesSection';
import { SourceSection, ago } from './SourceSection';
import { RoleRow } from './RoleRow';
import { LoginFinder } from './RoutesModal';

const blankApp = () => ({ pages: [] as Any[], roles: [] as Any[], login: {} as Any, notes: '' });
export const appSetup = (p: Any) => ({ ...blankApp(), ...(p?.automation?.app || {}) });
/** Edits the App setup; `tag` merges quick typing into one undo step. */
export const edit = (fn: (a: Any) => void, tag?: string) =>
  mutate(
    (pp: Any) => {
      pp.automation.app = { ...blankApp(), ...(pp.automation.app || {}) };
      fn(pp.automation.app);
    },
    tag ? { tag } : undefined,
  );
async function loadCreds() {
  const p = P();
  if (!p) return;
  try {
    S.creds = { pid: p.id, roles: await api(`/api/projects/${p.id}/credentials`) };
    emit();
  } catch {
    /* no access */
  }
}
export const credOf = (roleId: string) =>
  S.creds?.pid === P()?.id ? S.creds.roles?.[roleId] : null;
// App setup sections, in the order you set things up. The overview says what's ready and what's
// missing.
const SETUP_STEPS: [string, string, string, string][] = [
  ['overview', 'Overview', 'check', 'What’s ready, what’s missing'],
  ['repo', 'Repository', 'pr', 'Pages and changes from the code'],
  ['pages', 'Pages', 'doc', 'Where things are, by name'],
  ['roles', 'Roles & sign-in', 'people', 'Who signs in, and how'],
  ['login', 'Login form', 'settings', 'Only if signing in fails'],
  ['notes', 'Notes for the AI', 'comment', 'Test data and things to avoid'],
];
export function AppSetup() {
  const p = P();
  const a = appSetup(p);
  const canEdit = can('project.settings');
  const [step, setStepState] = useState<string>(() => {
    try {
      return sessionStorage.getItem('tf.setupStep') || 'overview';
    } catch {
      return 'overview';
    }
  });
  const setStep = (k: string) => {
    setStepState(k);
    try {
      sessionStorage.setItem('tf.setupStep', k);
    } catch {
      /* private mode */
    }
  };
  useEffect(() => {
    loadCreds();
  }, [p.id]);
  const [srcOpen, setSrcOpen] = useState(false);
  const base = String(p.automation.baseUrl || '').replace(/\/+$/, '');
  const loginSet = Object.values(a.login || {}).some(Boolean);
  const status = setupStatus(p);
  const cur = SETUP_STEPS.find(([k]) => k === step) || SETUP_STEPS[0];
  const badge = (k: string) => {
    if (k === 'pages')
      return a.pages.length ? (
        <span className="count">{a.pages.length}</span>
      ) : (
        <span className="dot bad" />
      );
    if (k === 'roles')
      return a.roles.length ? (
        <span className="count">{a.roles.length}</span>
      ) : (
        <span className="dot warn" />
      );
    if (k === 'repo') return p.automation.repoSync ? <span className="dot ok" /> : null;
    if (k === 'overview')
      return status.todo ? (
        <span className="count bad">{status.todo}</span>
      ) : (
        <span className="dot ok" />
      );
    if (k === 'login') return loginSet ? <span className="count">custom</span> : null;
    if (k === 'notes') return a.notes ? <span className="dot ok" /> : null;
    return null;
  };
  return (
    <div className="set-layout app-setup">
      <nav className="set-nav" aria-label="App setup">
        {SETUP_STEPS.map(([k, l, icon, d]) => (
          <button
            key={k}
            className={`set-nav-item ${k === cur[0] ? 'on' : ''}`}
            aria-current={k === cur[0] ? 'page' : undefined}
            onClick={() => setStep(k)}
          >
            <Ico svg={(I as Any)[icon]} />
            <span>
              <b>
                {l} {badge(k)}
              </b>
              <small>{d}</small>
            </span>
          </button>
        ))}
        <p className="muted small as-nav-note">
          Scripts use <code>{"app.goto('Page')"}</code> and <code>{"app.loginAs('Role')"}</code>, so
          they keep working when an address or password changes.
        </p>
      </nav>
      <div className="set-main">
        <div className="set-section-h">
          <h2>{cur[1]}</h2>
          <p className="muted">{cur[3]}.</p>
        </div>
        {cur[0] === 'overview' && <SetupOverview status={status} go={setStep} />}
        {cur[0] === 'repo' && (
          <>
            <div className="card">
              <RepoSyncCard />
            </div>
            <div className="card repo-source">
              <SourceSection
                canEdit={canEdit}
                open={Boolean(srcOpen)}
                toggle={() => setSrcOpen(!srcOpen)}
              />
            </div>
          </>
        )}
        {cur[0] === 'pages' && <PagesSection canEdit={canEdit} base={base} />}
        {cur[0] === 'roles' && (
          <div className="card">
            <p className="sub" style={{ marginTop: 0 }}>
              One role per kind of user, each with a test account. Choose how each signs in: the
              login form, single sign-on, or a saved session. Passwords, MFA secrets and sessions
              are stored encrypted and never shown again.
            </p>
            {a.roles.length ? (
              <div className="role-list">
                {a.roles.map((r: Any, i: number) => (
                  <RoleRow key={r.id} r={r} i={i} canEdit={canEdit} />
                ))}
              </div>
            ) : (
              <p className="muted small">
                No roles yet. Add one per kind of user (e.g. Admin, Cashier) with a test account, so
                scripts can sign in.
              </p>
            )}
            {canEdit && (
              <div className="row as-actions">
                <button
                  className="btn sm"
                  onClick={() =>
                    edit((x) => {
                      x.roles.push({ id: uid(), name: '', description: '', username: '' });
                    })
                  }
                >
                  <Ico svg={I.plus} />
                  Add role
                </button>
              </div>
            )}
          </div>
        )}
        {cur[0] === 'login' && (
          <div className="card">
            <p className="sub" style={{ marginTop: 0 }}>
              Found automatically. Change these only if <b>Test login</b> fails for a role that uses
              the login form.
            </p>
            <LoginFinder base={base} canEdit={canEdit} current={a.login?.path || ''} />
            <div className="grid2">
              {(
                [
                  ['path', 'Login page', 'Found automatically (/login, /sign-in…)'],
                  [
                    'success',
                    'Signed in when… (a path like /dashboard, or text on the page)',
                    'Leaves the login page',
                  ],
                  [
                    'usernameField',
                    'Username field: its label or a CSS selector (not the email)',
                    'Found automatically, e.g. Email',
                  ],
                  [
                    'passwordField',
                    'Password field: its label or a CSS selector',
                    'The password input',
                  ],
                  [
                    'submitButton',
                    'Sign-in button: its text or a CSS selector',
                    'Sign in / Log in button',
                  ],
                ] as [string, string, string][]
              ).map(([k, label, ph]) => {
                const v = String(a.login?.[k] || '').trim();
                const misplaced =
                  k !== 'path' && k !== 'success' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
                return (
                  <label key={k} className="field">
                    <span>{label}</span>
                    <TF
                      disabled={!canEdit}
                      value={a.login?.[k] || ''}
                      placeholder={ph}
                      spellCheck={false}
                      error={misplaced}
                      onChange={(e) =>
                        edit((x) => {
                          x.login = { ...(x.login || {}), [k]: e.target.value };
                        }, `login${k}`)
                      }
                    />
                    {misplaced && (
                      <span className="field-warn">
                        <Ico svg={I.warn} />
                        This looks like an email address. This box is for the field’s label (like
                        “Email”), and it’s ignored when signing in. Put the address in the role’s{' '}
                        <b>Username</b> under Roles &amp; logins.
                        {canEdit && (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={(e) => {
                              e.preventDefault();
                              edit((x) => {
                                x.login = { ...(x.login || {}), [k]: '' };
                              });
                            }}
                          >
                            Clear it
                          </button>
                        )}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        )}
        {cur[0] === 'notes' && (
          <div className="card">
            <p className="sub" style={{ marginTop: 0 }}>
              Anything the AI should know when it writes scripts: test data to use, conventions,
              things never to click.
            </p>
            <TA
              disabled={!canEdit}
              value={a.notes || ''}
              rows={6}
              placeholder={
                'e.g. Use the employee "Test Employee" for pay runs. Never press "Delete all". Dates are DD/MM/YYYY.'
              }
              onChange={(e) =>
                edit((x) => {
                  x.notes = e.target.value;
                }, 'appnotes')
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
/** What App setup still needs, for the overview and the menu badge. */
export function setupStatus(p: Any) {
  const a = appSetup(p);
  const creds = S.creds?.pid === p.id ? S.creds.roles || {} : {};
  const readyRole = (r: Any) =>
    r.signIn === 'session' ? creds[r.id]?.hasSession : r.username && creds[r.id]?.hasPassword;
  const items = [
    {
      key: 'url',
      ok: Boolean(p.automation.baseUrl),
      label: 'Application URL',
      detail: p.automation.baseUrl || 'Not set: tests don’t know where to run',
      go: 'settings',
    },
    {
      key: 'browser',
      ok: Boolean(S.engine?.browser),
      label: 'Test browser',
      detail: S.engine?.browser ? `${S.engine.label}` : 'Not ready',
      go: 'settings',
    },
    {
      key: 'repo',
      ok: Boolean(p.automation.repoSync),
      optional: true,
      label: 'Repository',
      detail: p.automation.repoSync
        ? `Synced ${ago(p.automation.repoSync.at)} on ${p.automation.repoSync.branch}`
        : p.dev?.localPath
          ? 'Not synced yet'
          : 'No local repository set (Project settings → Code & GitHub)',
      go: 'repo',
    },
    {
      key: 'pages',
      ok: a.pages.length > 0,
      label: 'Pages',
      detail: a.pages.length
        ? `${a.pages.length} pages${a.pages.some((x: Any) => x.missing) ? `, ${a.pages.filter((x: Any) => x.missing).length} no longer in the code` : ''}`
        : 'None yet: scripts can’t open pages by name',
      go: 'pages',
    },
    {
      key: 'roles',
      ok: a.roles.length > 0 && a.roles.every(readyRole),
      label: 'Roles & sign-in',
      detail: !a.roles.length
        ? 'No roles: tests of signed-in pages will fail'
        : `${a.roles.filter(readyRole).length} of ${a.roles.length} ready to sign in`,
      go: 'roles',
    },
  ];
  return { items, todo: items.filter((x) => !x.ok && !x.optional).length };
}
