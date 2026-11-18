'use client';
// Test automation → App setup: the app's pages, its user roles with their logins, and how to sign in. Test
// scripts then read like `await app.loginAs('Admin'); await app.goto('Orders')`. Passwords are saved
// encrypted on the server, separately from the project, and are never shown again.
import { useEffect, useState } from 'react';
import { S, emit, P, mutate, api, toast, openModal, closeModal, can, uid, saveNow, saveUi, readNdjson, startTask, type Any } from './core';
import { Ico, I, Modal, Spinner, EmptyState, Confirm } from './ui';
import { TF, TA, SF, RB, MenuItem } from './fields';
import { RepoSyncCard } from './RepoSync';

const blankApp = () => ({ pages: [] as Any[], roles: [] as Any[], login: {} as Any, notes: '' });
export const appSetup = (p: Any) => ({ ...blankApp(), ...(p?.automation?.app || {}) });
/** Edits the App setup; `tag` merges quick typing into one undo step. */
const edit = (fn: (a: Any) => void, tag?: string) =>
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
const credOf = (roleId: string) => (S.creds?.pid === P()?.id ? S.creds.roles?.[roleId] : null);

// App setup sections, in the order you set things up. The overview says what's ready and what's missing.
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
    if (k === 'pages') return a.pages.length ? <span className="count">{a.pages.length}</span> : <span className="dot bad" />;
    if (k === 'roles') return a.roles.length ? <span className="count">{a.roles.length}</span> : <span className="dot warn" />;
    if (k === 'repo') return p.automation.repoSync ? <span className="dot ok" /> : null;
    if (k === 'overview') return status.todo ? <span className="count bad">{status.todo}</span> : <span className="dot ok" />;
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
          Scripts use <code>{"app.goto('Page')"}</code> and <code>{"app.loginAs('Role')"}</code>, so they keep working when an address or
          password changes.
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
              <SourceSection canEdit={canEdit} open={Boolean(srcOpen)} toggle={() => setSrcOpen(!srcOpen)} />
            </div>
          </>
        )}
        {cur[0] === 'pages' && <PagesSection canEdit={canEdit} base={base} />}
        {cur[0] === 'roles' && (
          <div className="card">
            <p className="sub" style={{ marginTop: 0 }}>
              One role per kind of user, each with a test account. Choose how each signs in: the login form, single sign-on, or a saved
              session. Passwords, MFA secrets and sessions are stored encrypted and never shown again.
            </p>
            {a.roles.length ? (
              <div className="role-list">
                {a.roles.map((r: Any, i: number) => (
                  <RoleRow key={r.id} r={r} i={i} canEdit={canEdit} />
                ))}
              </div>
            ) : (
              <p className="muted small">
                No roles yet. Add one per kind of user (e.g. Admin, Cashier) with a test account, so scripts can sign in.
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
              Found automatically. Change these only if <b>Test login</b> fails for a role that uses the login form.
            </p>
            <LoginFinder base={base} canEdit={canEdit} current={a.login?.path || ''} />
            <div className="grid2">
              {(
                [
                  ['path', 'Login page', 'Found automatically (/login, /sign-in…)'],
                  ['success', 'Signed in when… (a path like /dashboard, or text on the page)', 'Leaves the login page'],
                  ['usernameField', 'Username field: its label or a CSS selector (not the email)', 'Found automatically, e.g. Email'],
                  ['passwordField', 'Password field: its label or a CSS selector', 'The password input'],
                  ['submitButton', 'Sign-in button: its text or a CSS selector', 'Sign in / Log in button'],
                ] as [string, string, string][]
              ).map(([k, label, ph]) => {
                const v = String(a.login?.[k] || '').trim();
                const misplaced = k !== 'path' && k !== 'success' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
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
                        This looks like an email address. This box is for the field’s label (like “Email”), and it’s ignored when signing
                        in. Put the address in the role’s <b>Username</b> under Roles &amp; logins.
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
              Anything the AI should know when it writes scripts: test data to use, conventions, things never to click.
            </p>
            <TA
              disabled={!canEdit}
              value={a.notes || ''}
              rows={6}
              placeholder={'e.g. Use the employee "Test Employee" for pay runs. Never press "Delete all". Dates are DD/MM/YYYY.'}
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
  const readyRole = (r: Any) => (r.signIn === 'session' ? creds[r.id]?.hasSession : r.username && creds[r.id]?.hasPassword);
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
function SetupOverview({ status, go }: { status: ReturnType<typeof setupStatus>; go: (k: string) => void }) {
  return (
    <div className="card setup-overview">
      {status.todo ? (
        <p className="sub" style={{ marginTop: 0 }}>
          {status.todo} thing{status.todo > 1 ? 's' : ''} to set up before every test can run.
        </p>
      ) : (
        <p className="sub" style={{ marginTop: 0 }}>
          Everything is set up. Tests can run.
        </p>
      )}
      <ul className="setup-list">
        {status.items.map((x) => (
          <li key={x.key} className={x.ok ? 'ok' : x.optional ? 'opt' : 'todo'}>
            <span className="setup-ic">{x.ok ? <Ico svg={I.check} /> : x.optional ? <Ico svg={I.clock} /> : <Ico svg={I.warn} />}</span>
            <span className="setup-text">
              <b>{x.label}</b>
              <span className="muted small">{x.detail}</span>
            </span>
            <button
              className="btn sm subtle"
              onClick={() => (x.go === 'settings' ? ((S.autoTab = 'settings'), saveUi(), emit()) : go(x.go))}
            >
              {x.ok ? 'Open' : 'Set up'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- pages, organized by area
const SIGN_IN_SEG = /^(auth|sign-?in|signin|log-?in|sign-?up|register|forgot|reset|verify|mfa|sso|account)$/i;
const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const MAIN = 'Main pages';
/**
 * The area a page belongs to, from its path: sign-in pages together; a section with several pages
 * ("/dashboard/pay-runs/…") gets its own group ("Dashboard › Pay runs"); lone top-level pages are "Main pages".
 */
function areaOf(path: string, all: string[]) {
  const segs = String(path || '/')
    .split('/')
    .filter(Boolean);
  const [first = '', second = ''] = segs;
  if (!first) return MAIN;
  if (SIGN_IN_SEG.test(first)) return 'Sign-in & account';
  if (!all.some((x) => (x !== path && x.startsWith(`/${first}/`)) || (x !== path && x === `/${first}`))) return MAIN;
  const sub =
    second && !second.startsWith(':') && all.filter((x) => x === `/${first}/${second}` || x.startsWith(`/${first}/${second}/`)).length > 1
      ? second
      : '';
  return [titleCase(first), sub && titleCase(sub)].filter(Boolean).join(' › ');
}
const areaRank = (a: string) => (a === MAIN ? 0 : a === 'Sign-in & account' ? 1 : 2);
function PagesSection({ canEdit, base }: { canEdit: boolean; base: string }) {
  const a = appSetup(P());
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const paths = a.pages.map((x: Any) => String(x.path || ''));
  const rows = a.pages
    .map((pg: Any, i: number) => ({ pg, i, area: areaOf(pg.path, paths) }))
    .filter(
      ({ pg }: Any) =>
        filter === 'all' ||
        (filter === 'code' && pg.fromCode) ||
        (filter === 'manual' && !pg.fromCode) ||
        (filter === 'dynamic' && String(pg.path).includes(':')) ||
        (filter === 'missing' && pg.missing),
    )
    .filter(
      ({ pg }: Any) =>
        !q.trim() || `${pg.name} ${pg.path} ${pg.description || ''} ${pg.file || ''}`.toLowerCase().includes(q.trim().toLowerCase()),
    )
    .sort(
      (x: Any, y: Any) =>
        areaRank(x.area) - areaRank(y.area) || x.area.localeCompare(y.area) || String(x.pg.path).localeCompare(String(y.pg.path)),
    );
  const groups: [string, Any[]][] = [];
  for (const r of rows) {
    const g = groups.find(([k]) => k === r.area);
    if (g) g[1].push(r);
    else groups.push([r.area, [r]]);
  }
  const count = (f: (pg: Any) => boolean) => a.pages.filter(f).length;
  return (
    <div className="card">
      <div className="pages-tools">
        <TF
          value={q}
          placeholder={`Search ${a.pages.length} pages by name, path or file`}
          onChange={(e) => setQ(e.target.value)}
          sx={{ flex: 1, minWidth: 220 }}
          aria-label="Search pages"
        />
        <SF filter value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show">
          <MenuItem value="all">All pages ({a.pages.length})</MenuItem>
          <MenuItem value="code">From the code ({count((x) => x.fromCode)})</MenuItem>
          <MenuItem value="manual">Added by hand ({count((x) => !x.fromCode)})</MenuItem>
          <MenuItem value="dynamic">Need values, like :id ({count((x) => String(x.path).includes(':'))})</MenuItem>
          {count((x) => x.missing) > 0 && <MenuItem value="missing">No longer in the code ({count((x) => x.missing)})</MenuItem>}
        </SF>
        {canEdit && (
          <button
            className="btn sm"
            onClick={() => {
              edit((x) => {
                x.pages.push({ id: uid(), name: '', path: '/', description: '' });
              });
              setQ('');
              setFilter('manual');
            }}
          >
            <Ico svg={I.plus} />
            Add page
          </button>
        )}
        {canEdit && (
          <button
            className="btn sm"
            disabled={!base}
            title={base ? 'Follow the app’s links to find its pages' : 'Set the application URL first'}
            onClick={() => openModal(<DiscoverModal />)}
          >
            <Ico svg={I.search} />
            Discover
          </button>
        )}
      </div>
      {!a.pages.length ? (
        <p className="muted small">
          No pages yet. Sync with the repository, discover them from the running app, or add the main ones by hand, so scripts can open them
          by name.
        </p>
      ) : !rows.length ? (
        <p className="muted small">No page matches.</p>
      ) : (
        groups.map(([area, list]) => (
          <div key={area} className="pg-group">
            <button
              type="button"
              className={`as-h ${closed[area] ? 'closed' : ''}`}
              onClick={() => setClosed({ ...closed, [area]: !closed[area] })}
            >
              <Ico svg={I.chevron} />
              <b>{area}</b>
              <span className="count">{list.length}</span>
            </button>
            {!closed[area] && (
              <table className="tbl as-tbl pg-tbl">
                <tbody>
                  {list.map(({ pg, i }: Any) => {
                    const dyn = String(pg.path || '').includes(':');
                    return (
                      <tr key={pg.id} className={pg.missing ? 'pg-missing' : ''}>
                        <td style={{ width: '26%' }}>
                          <TF
                            disabled={!canEdit}
                            value={pg.name}
                            placeholder="e.g. Orders"
                            onChange={(e) =>
                              edit((x) => {
                                x.pages[i] = { ...x.pages[i], name: e.target.value };
                              }, `pg${pg.id}n`)
                            }
                          />
                        </td>
                        <td style={{ width: '30%' }}>
                          <TF
                            mono
                            disabled={!canEdit}
                            value={pg.path}
                            placeholder="/orders"
                            spellCheck={false}
                            onChange={(e) =>
                              edit((x) => {
                                x.pages[i] = { ...x.pages[i], path: e.target.value.trim() };
                              }, `pg${pg.id}p`)
                            }
                          />
                          <div className="pg-badges">
                            {pg.fromCode && (
                              <span className="pg-badge" title={pg.file || ''}>
                                {pg.missing ? 'No longer in the code' : 'From code'}
                              </span>
                            )}
                            {dyn && (
                              <span className="pg-badge dyn" title="Scripts pass values: app.goto('Name', { id: … })">
                                {(() => {
                                  const ps = [...String(pg.path).matchAll(/:(\w+)([?*]?)/g)];
                                  const need = ps.filter((m) => !m[2]).map((m) => m[1]);
                                  const opt = ps.filter((m) => m[2]).map((m) => m[1]);
                                  return [need.length && `Needs ${need.join(', ')}`, opt.length && `Optional ${opt.join(', ')}`]
                                    .filter(Boolean)
                                    .join(' · ');
                                })()}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <TF
                            disabled={!canEdit}
                            value={pg.description || ''}
                            placeholder="What’s on it (helps the AI)"
                            onChange={(e) =>
                              edit((x) => {
                                x.pages[i] = { ...x.pages[i], description: e.target.value };
                              }, `pg${pg.id}d`)
                            }
                          />
                          {pg.file && (
                            <div className="muted small as-file" title={pg.file}>
                              <Ico svg={I.doc} /> {pg.file}
                            </div>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right', width: 72 }}>
                          {base && !dyn && (
                            <a
                              className="icon-btn"
                              href={`${base}${String(pg.path || '/').startsWith('/') || String(pg.path).startsWith('#') ? '' : '/'}${pg.path || ''}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open in a new tab"
                            >
                              <Ico svg={I.external} />
                            </a>
                          )}
                          {canEdit && (
                            <button
                              className="icon-btn"
                              aria-label={`Remove ${pg.name || 'page'}`}
                              title="Remove"
                              onClick={() =>
                                edit((x) => {
                                  x.pages.splice(i, 1);
                                })
                              }
                            >
                              <Ico svg={I.trash} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function RoleRow({ r, i, canEdit }: { r: Any; i: number; canEdit: boolean }) {
  const cred = credOf(r.id);
  const [pw, setPw] = useState('');
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<Any>(null);
  const p = P();
  const savePw = async (value: string) => {
    setBusy('pw');
    try {
      const st = await api(`/api/projects/${p.id}/credentials`, { method: 'PUT', body: { roleId: r.id, password: value } });
      S.creds = { pid: p.id, roles: st };
      emit();
      setPw('');
      setChanging(false);
      toast(value ? `Password saved for ${r.name || 'the role'}` : 'Password removed');
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const testLogin = async () => {
    setBusy('test');
    setResult(null);
    try {
      await saveNow(); // the test uses the saved setup
      setResult(await api(`/api/projects/${p.id}/login-test`, { method: 'POST', body: { roleId: r.id } }));
    } catch (e: Any) {
      setResult({ ok: false, error: e.message });
    } finally {
      setBusy('');
    }
  };
  const remove = () =>
    openModal(
      <Confirm
        title={`Remove ${r.name || 'this role'}?`}
        label="Remove"
        text="The role and its saved password are removed. Scripts that sign in as this role will fail."
        onYes={async () => {
          edit((x) => {
            x.roles.splice(i, 1);
          });
          if (cred)
            await api(`/api/projects/${p.id}/credentials`, { method: 'PUT', body: { roleId: r.id, clearAll: true } })
              .then((st) => {
                S.creds = { pid: p.id, roles: st };
                emit();
              })
              .catch(() => {});
        }}
      />,
    );
  const editingPw = canEdit && (!cred?.hasPassword || changing);
  const method = r.signIn || 'form';
  const ready = method === 'session' ? Boolean(cred?.hasSession) : Boolean(r.username && cred?.hasPassword);
  const notReady = method === 'session' ? 'Save a session first: Sign in in a browser' : 'Add a username and password first';
  return (
    <div className="role-card">
      <div className="role-fields">
        <label className="field">
          <span>Role</span>
          <TF
            disabled={!canEdit}
            value={r.name}
            placeholder="e.g. Admin"
            onChange={(e) =>
              edit((x) => {
                x.roles[i] = { ...x.roles[i], name: e.target.value };
              }, `rl${r.id}n`)
            }
          />
        </label>
        <label className="field">
          <span>What they can do</span>
          <TF
            disabled={!canEdit}
            value={r.description || ''}
            placeholder="e.g. Manages products and refunds"
            onChange={(e) =>
              edit((x) => {
                x.roles[i] = { ...x.roles[i], description: e.target.value };
              }, `rl${r.id}d`)
            }
          />
        </label>
        <label className="field">
          <span>Username</span>
          <TF
            disabled={!canEdit}
            value={r.username || ''}
            placeholder="Email or username"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) =>
              edit((x) => {
                x.roles[i] = { ...x.roles[i], username: e.target.value.trim() };
              }, `rl${r.id}u`)
            }
          />
        </label>
        <div className="field">
          <span>Password</span>
          {method === 'session' ? (
            <span className="muted small">Not needed: uses the saved session</span>
          ) : editingPw ? (
            <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
              <TF
                type="password"
                value={pw}
                placeholder={cred?.hasPassword ? 'New password' : 'Password'}
                autoComplete="new-password"
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e: Any) => {
                  if (e.key === 'Enter' && pw) savePw(pw);
                }}
              />
              <button className="btn sm primary" disabled={!pw || !!busy} onClick={() => savePw(pw)}>
                {busy === 'pw' ? <Spinner /> : 'Save'}
              </button>
              {changing && (
                <button
                  className="btn sm subtle"
                  onClick={() => {
                    setChanging(false);
                    setPw('');
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          ) : cred?.hasPassword ? (
            <span className="row" style={{ gap: 6 }}>
              <span className="loz t-pass">Saved</span>
              {canEdit && (
                <>
                  <button className="btn sm subtle" onClick={() => setChanging(true)}>
                    Change
                  </button>
                  <button className="btn sm subtle" disabled={!!busy} onClick={() => savePw('')}>
                    Clear
                  </button>
                </>
              )}
            </span>
          ) : (
            <span className="loz">Not set</span>
          )}
        </div>
        <div className="role-actions">
          {can('test.run') && (
            <button
              className="btn sm subtle"
              disabled={!!busy || !ready}
              title={!ready ? notReady : 'Sign in as this role on the application URL'}
              onClick={testLogin}
            >
              {busy === 'test' ? (
                <>
                  <Spinner />
                  Signing in…
                </>
              ) : (
                'Test login'
              )}
            </button>
          )}
          {canEdit && (
            <button className="icon-btn" aria-label={`Remove ${r.name || 'role'}`} title="Remove" onClick={remove}>
              <Ico svg={I.trash} />
            </button>
          )}
        </div>
      </div>
      <SignInRow r={r} i={i} canEdit={canEdit} cred={cred} />
      {result && (
        <div className="role-result">
          {result.ok ? (
            <div className="ok-banner">
              <Ico svg={I.check} />
              <span>
                Signed in as <b>{r.name}</b>. Landed on <code>{new URL(result.url).pathname}</code>
                {result.title ? ` (“${result.title}”)` : ''}.
              </span>
              {result.screenshot && (
                <a href={`${result.screenshot}?t=${Date.now()}`} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto' }}>
                  <Ico svg={I.external} /> Screenshot
                </a>
              )}
            </div>
          ) : (
            <div className="warn-banner danger">
              <Ico svg={I.warn} />
              <span>
                {result.error}
                {result.url ? (
                  <>
                    {' '}
                    (on{' '}
                    <code>
                      {(() => {
                        try {
                          return new URL(result.url).pathname;
                        } catch {
                          return result.url;
                        }
                      })()}
                    </code>
                    )
                  </>
                ) : (
                  ''
                )}
                . Check the username and password, or the <b>Login form</b> settings.
              </span>
              {result.screenshot && (
                <a
                  href={`${result.screenshot}?t=${Date.now()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}
                >
                  <Ico svg={I.external} /> Screenshot
                </a>
              )}
            </div>
          )}
          {result.notes?.length > 0 && (
            <ul className="login-notes small">
              {result.notes.map((n: string, i: number) => (
                <li key={i}>
                  <Ico svg={I.warn} />
                  {n}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Follows the app's links (optionally signed in) and lets you pick which pages to add. */
function DiscoverModal() {
  const p = P();
  const a = appSetup(p);
  const roles = a.roles.filter((r: Any) => r.name && r.username && credOf(r.id)?.hasPassword);
  const [role, setRole] = useState(roles[0]?.name || '');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Any[] | null>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState('');
  const have = new Set(a.pages.map((x: Any) => x.path));
  const start = async () => {
    setBusy(true);
    setErr('');
    setFound(null);
    try {
      await saveNow();
      const r = await api(`/api/projects/${p.id}/discover`, { method: 'POST', body: { role: role || undefined } });
      setFound(r.pages);
      setPick(Object.fromEntries(r.pages.map((x: Any) => [x.path, !have.has(x.path)])));
    } catch (e: Any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const chosen = (found || []).filter((x) => pick[x.path]);
  const add = () => {
    edit((x) => {
      for (const f of chosen)
        if (!x.pages.some((y: Any) => y.path === f.path))
          x.pages.push({ id: uid(), name: f.name, path: f.path, description: f.title && f.title !== f.name ? f.title : '' });
    });
    closeModal();
    toast(`Added ${chosen.length} page${chosen.length === 1 ? '' : 's'}`);
  };
  return (
    <Modal
      title="Discover pages"
      wide
      actions={[
        { label: 'Cancel' },
        ...(found
          ? [
              {
                label: `Add ${chosen.length} page${chosen.length === 1 ? '' : 's'}`,
                kind: 'primary' as const,
                disabled: !chosen.length,
                onClick: add,
              },
            ]
          : []),
      ]}
    >
      <p style={{ marginTop: 0 }}>
        TicketForge opens <b>{p.automation.baseUrl}</b> and follows its links (up to 30 pages). It only follows links: it doesn’t click
        buttons or submit forms, and it skips links that look like logging out or deleting.
      </p>
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}>
        <label className="field" style={{ margin: 0, flex: 1 }}>
          <span>Explore as</span>
          <SF value={role} onChange={(e) => setRole(e.target.value)}>
            <MenuItem value="">Not signed in</MenuItem>
            {roles.map((r: Any) => (
              <MenuItem key={r.id} value={r.name}>
                {r.name}
              </MenuItem>
            ))}
          </SF>
        </label>
        <button className="btn primary" disabled={busy} onClick={start}>
          {busy ? (
            <>
              <Spinner />
              Exploring…
            </>
          ) : found ? (
            'Explore again'
          ) : (
            'Start'
          )}
        </button>
      </div>
      {!roles.length && a.roles.length > 0 && (
        <p className="muted small">Save a username and password for a role to explore the pages behind the login.</p>
      )}
      {err && (
        <div className="warn-banner danger" style={{ marginTop: 12 }}>
          <Ico svg={I.warn} />
          <span>{err}</span>
        </div>
      )}
      {found &&
        (found.length ? (
          <div className="discover-list">
            {found.map((f) => (
              <label key={f.path} className={`check ${have.has(f.path) ? 'muted' : ''}`}>
                <input type="checkbox" checked={Boolean(pick[f.path])} onChange={(e) => setPick({ ...pick, [f.path]: e.target.checked })} />
                <b>{f.name}</b>
                <code>{f.path}</code>
                {have.has(f.path) && <span className="small">already added</span>}
              </label>
            ))}
          </div>
        ) : (
          <EmptyState compact icon={I.search} tone="neutral" title="No pages found">
            <p>The start page has no links TicketForge could follow. Add pages by hand instead.</p>
          </EmptyState>
        ))}
    </Modal>
  );
}

// ---------------------------------------------------------------- source code → routes
const ago = (t: string) => {
  const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const checked: Record<string, number> = {}; // project id → last automatic check (per browser session)

/** Compares a scan with the pages: new routes, pages whose route is gone, and the rest. */
function diffRoutes(a: Any, scan: Any) {
  const have = new Map(a.pages.map((p: Any) => [p.path, p]));
  const inCode = new Set(scan.routes.map((r: Any) => r.path));
  return {
    added: scan.routes.filter((r: Any) => !have.has(r.path)),
    removed: a.pages.filter((p: Any) => p.fromCode && !inCode.has(p.path)),
    kept: scan.routes.filter((r: Any) => have.has(r.path)),
  };
}
async function runScan(p: Any, src: Any) {
  return api(`/api/projects/${p.id}/routes`, {
    method: 'POST',
    body: { action: 'scan', kind: src.kind, location: src.location, branch: src.branch },
  });
}

function SourceSection({ canEdit, open, toggle }: { canEdit: boolean; open: boolean; toggle: () => void }) {
  const p = P();
  const a = appSetup(p);
  const src = a.source || { kind: 'github', location: '', branch: '' };
  const [info, setInfo] = useState<Any>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [changes, setChanges] = useState<Any>(null);
  useEffect(() => {
    api(`/api/projects/${p.id}/routes`)
      .then(setInfo)
      .catch(() => {});
  }, [p.id]);
  // Once in a while, check the code quietly and say if routes changed.
  useEffect(() => {
    if (!canEdit || !src.location || (checked[p.id] && Date.now() - checked[p.id] < 10 * 60000)) return;
    checked[p.id] = Date.now();
    runScan(p, src)
      .then((scan) => {
        const d = diffRoutes(appSetup(P()), scan);
        setChanges(d.added.length || d.removed.length ? { scan, ...d } : null);
        edit((x) => {
          x.source = {
            ...(x.source || src),
            lastScan: { at: scan.at, count: scan.routes.length, frameworks: scan.frameworks, label: scan.label },
          };
        }, 'srcscan');
      })
      .catch(() => {});
  }, [p.id, src.location]); // eslint-disable-line react-hooks/exhaustive-deps
  const setSrc = (k: string, v: string) =>
    edit((x) => {
      x.source = { ...(x.source || { kind: 'github', location: '', branch: '' }), [k]: v };
    }, `src${k}`);
  const scan = async () => {
    setBusy('scan');
    try {
      const res = await runScan(p, src);
      edit((x) => {
        x.source = {
          ...(x.source || src),
          lastScan: { at: res.at, count: res.routes.length, frameworks: res.frameworks, label: res.label },
        };
      });
      setChanges(null);
      openModal(<RoutesModal scan={res} />);
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const saveToken = async (value: string) => {
    setBusy('token');
    try {
      setInfo({
        ...info,
        ...(await api(`/api/projects/${p.id}/routes`, {
          method: 'POST',
          body: value ? { action: 'saveToken', token: value } : { action: 'clearToken' },
        })),
      });
      setToken('');
      toast(value ? 'GitHub token saved' : 'GitHub token removed');
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const last = src.lastScan;
  const summary = src.location ? (
    <>
      {last ? (
        <>
          {last.label || src.location} · {last.frameworks?.join(', ') || 'no routes found'} · {last.count} route
          {last.count === 1 ? '' : 's'} · checked {ago(last.at)}
        </>
      ) : (
        <>{src.location} · not scanned yet</>
      )}
    </>
  ) : (
    'Find pages from the web app’s code, and keep them in sync'
  );
  return (
    <div className="as-sec">
      <button type="button" className={`as-h ${open ? '' : 'closed'}`} onClick={toggle}>
        <Ico svg={I.chevron} />
        <b>Where routes are read from</b>
        <span className="muted small">{summary}</span>
      </button>
      {changes && (
        <div className="warn-banner as-change">
          <Ico svg={I.doc} />
          <span>
            The code changed:{' '}
            {changes.added.length > 0 && (
              <b>
                {changes.added.length} new route{changes.added.length === 1 ? '' : 's'}
              </b>
            )}
            {changes.added.length > 0 && changes.removed.length > 0 && ', '}
            {changes.removed.length > 0 && (
              <b>
                {changes.removed.length} page{changes.removed.length === 1 ? '' : 's'} no longer in the code
              </b>
            )}
            .
          </span>
          <button
            className="btn sm"
            onClick={() => {
              openModal(<RoutesModal scan={changes.scan} />);
              setChanges(null);
            }}
          >
            Review
          </button>
        </div>
      )}
      {open && (
        <div className="as-body">
          <div className="row" style={{ gap: 16, marginBottom: 8 }}>
            <RB disabled={!canEdit} checked={src.kind !== 'folder'} onChange={() => setSrc('kind', 'github')} label="GitHub repository" />
            <RB
              disabled={!canEdit || !info?.canReadFolders}
              checked={src.kind === 'folder'}
              onChange={() => setSrc('kind', 'folder')}
              label={info && !info.canReadFolders ? 'Folder on this computer (open TicketForge at localhost)' : 'Folder on this computer'}
            />
          </div>
          {src.kind === 'folder' ? (
            <label className="field">
              <span>Folder</span>
              <TF
                disabled={!canEdit}
                value={src.location}
                placeholder="/Users/you/code/my-shop"
                spellCheck={false}
                onChange={(e) => setSrc('location', e.target.value)}
              />
            </label>
          ) : (
            <div className="grid2">
              <label className="field">
                <span>Repository</span>
                <TF
                  disabled={!canEdit}
                  value={src.location}
                  placeholder="owner/name, or a GitHub URL (…/tree/main/apps/web for a subfolder)"
                  spellCheck={false}
                  onChange={(e) => setSrc('location', e.target.value)}
                />
              </label>
              <label className="field">
                <span>Branch (optional)</span>
                <TF
                  disabled={!canEdit}
                  value={src.branch || ''}
                  placeholder="The default branch"
                  spellCheck={false}
                  onChange={(e) => setSrc('branch', e.target.value)}
                />
              </label>
              <label className="field" style={{ gridColumn: '1 / -1' }}>
                <span>GitHub token (for private repos, optional)</span>
                {info?.hasToken ? (
                  <span className="row" style={{ gap: 6 }}>
                    <span className="loz t-pass">Saved</span>
                    {canEdit && (
                      <button className="btn sm subtle" disabled={!!busy} onClick={() => saveToken('')}>
                        Remove
                      </button>
                    )}
                    <span className="muted small">Stored encrypted. Used only to read this repository.</span>
                  </span>
                ) : (
                  <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                    <TF
                      disabled={!canEdit}
                      type="password"
                      value={token}
                      autoComplete="off"
                      placeholder="A read-only token with Contents: read access. Not needed if the gh CLI is signed in."
                      onChange={(e) => setToken(e.target.value)}
                    />
                    <button className="btn sm" disabled={!canEdit || !token || !!busy} onClick={() => saveToken(token)}>
                      Save
                    </button>
                  </div>
                )}
              </label>
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary sm" disabled={!canEdit || !src.location || !!busy} onClick={scan}>
              {busy === 'scan' ? (
                <>
                  <Spinner />
                  Scanning…
                </>
              ) : last ? (
                'Scan again'
              ) : (
                'Scan routes'
              )}
            </button>
            <span className="muted small">
              Reads Next.js, SvelteKit, Nuxt, Remix, Astro, TanStack Router, React Router, Vue Router, Angular, Laravel, Django and Rails
              routes. API routes are left out.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** What a scan found compared with the pages: add new routes, flag or remove pages that left the code. */
function RoutesModal({ scan }: { scan: Any }) {
  const a = appSetup(P());
  const d = diffRoutes(a, scan);
  const [add, setAdd] = useState<Record<string, boolean>>(() => Object.fromEntries(d.added.map((r: Any) => [r.path, true])));
  const [drop, setDrop] = useState<Record<string, boolean>>(() => Object.fromEntries(d.removed.map((p: Any) => [p.id, false])));
  const nAdd = d.added.filter((r: Any) => add[r.path]).length;
  const nDrop = d.removed.filter((p: Any) => drop[p.id]).length;
  const apply = () => {
    const files = new Map(scan.routes.map((r: Any) => [r.path, r.file]));
    edit((x) => {
      // Keep file names current, mark pages whose route left the code, add the chosen new ones, remove the chosen gone ones.
      x.pages = x.pages
        .filter((pg: Any) => !(pg.fromCode && drop[pg.id]))
        .map((pg: Any) =>
          files.has(pg.path) ? { ...pg, file: files.get(pg.path) || pg.file, missing: false } : pg.fromCode ? { ...pg, missing: true } : pg,
        );
      for (const r of d.added)
        if (add[r.path]) x.pages.push({ id: uid(), name: r.name, path: r.path, description: '', fromCode: true, file: r.file });
    });
    closeModal();
    toast(nAdd || nDrop ? `Pages updated: ${nAdd} added${nDrop ? `, ${nDrop} removed` : ''}` : 'Pages are in sync with the code');
  };
  return (
    <Modal
      title="Routes in the code"
      wide
      actions={[{ label: 'Cancel' }, { label: nAdd || nDrop ? `Update pages (${nAdd + nDrop})` : 'Done', kind: 'primary', onClick: apply }]}
    >
      <p style={{ marginTop: 0 }}>
        <b>{scan.label}</b> · {scan.frameworks.length ? scan.frameworks.join(', ') : 'no supported router found'} · {scan.routes.length}{' '}
        route{scan.routes.length === 1 ? '' : 's'} in {scan.files.toLocaleString()} files
        {scan.truncated && <span className="muted"> (the repository is very large, so some files may be missing)</span>}
      </p>
      {!scan.routes.length && (
        <EmptyState compact icon={I.search} tone="neutral" title="No page routes found">
          <p>TicketForge didn’t recognize a router in this code. Check the path or repository, or add pages by hand.</p>
        </EmptyState>
      )}
      {d.added.length > 0 && (
        <>
          <div className="as-group">New routes ({d.added.length})</div>
          <div className="discover-list">
            {d.added.map((r: Any) => (
              <label key={r.path} className="check">
                <input type="checkbox" checked={Boolean(add[r.path])} onChange={(e) => setAdd({ ...add, [r.path]: e.target.checked })} />
                <b>{r.name}</b>
                <code>{r.path}</code>
                <span className="small muted" title={r.file || ''}>
                  {r.framework}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
      {d.removed.length > 0 && (
        <>
          <div className="as-group">No longer in the code ({d.removed.length})</div>
          <p className="small muted" style={{ margin: '0 0 6px' }}>
            These pages came from the code, but their route is gone. Tick to remove them; unticked ones stay, marked as missing.
          </p>
          <div className="discover-list">
            {d.removed.map((pg: Any) => (
              <label key={pg.id} className="check">
                <input type="checkbox" checked={Boolean(drop[pg.id])} onChange={(e) => setDrop({ ...drop, [pg.id]: e.target.checked })} />
                <b>{pg.name}</b>
                <code>{pg.path}</code>
                <span className="small muted">Remove</span>
              </label>
            ))}
          </div>
        </>
      )}
      {d.kept.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="small muted">
            {d.kept.length} route{d.kept.length === 1 ? '' : 's'} already in the pages
          </summary>
          <div className="discover-list">
            {d.kept.map((r: Any) => (
              <div key={r.path} className="check">
                <b>{r.name}</b>
                <code>{r.path}</code>
              </div>
            ))}
          </div>
        </details>
      )}
    </Modal>
  );
}

/** Opens the app in the test browser and finds its login form (nothing is typed or submitted). */
function LoginFinder({ base, canEdit, current }: { base: string; canEdit: boolean; current: string }) {
  const p = P();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Any>(null);
  const run = async () => {
    setBusy(true);
    setRes(null);
    try {
      await saveNow();
      setRes({ ok: true, ...(await api(`/api/projects/${p.id}/login-detect`, { method: 'POST' })) });
    } catch (e: Any) {
      setRes({ ok: false, error: e.message });
    } finally {
      setBusy(false);
    }
  };
  const use = () => {
    edit((x) => {
      x.login = { ...(x.login || {}), path: res.path };
    });
    toast(`Login page set to ${res.path}`);
  };
  const f = res?.fields || {};
  const row = (label: string, v: Any) =>
    v && (
      <li>
        <span className="muted">{label}</span> <b>{v.label || '—'}</b> <code>{v.selector}</code>
      </li>
    );
  return (
    <div className="login-find">
      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn sm"
          disabled={busy || !base || !can('test.run')}
          onClick={run}
          title={!base ? 'Set the application URL first' : 'Opens the app and looks for its login form. Nothing is typed or submitted.'}
        >
          {busy ? (
            <>
              <Spinner />
              Looking for the login form…
            </>
          ) : (
            <>
              <Ico svg={I.search} />
              Find login form
            </>
          )}
        </button>
        <span className="muted small">
          {base ? (
            <>
              Looks on <b>{base}</b> for a page with a password field: the login-looking pages above first, then /login, /sign-in,
              /sign-in/manual and other usual addresses.
            </>
          ) : (
            'Set the application URL first.'
          )}
        </span>
      </div>
      {res &&
        (res.ok ? (
          <div className="login-find-res ok">
            {res.screenshot && (
              <a href={res.screenshot} target="_blank" rel="noopener noreferrer">
                <img src={`${res.screenshot}?t=${Date.now()}`} alt="The login form" />
              </a>
            )}
            <div>
              <p style={{ margin: '0 0 6px' }}>
                <Ico svg={I.check} /> Found the login form at <b>{res.path}</b>
                {res.tried?.length > 1 ? <span className="muted small"> (after trying {res.tried.slice(0, -1).join(', ')})</span> : null}
              </p>
              <ul className="small">
                {row('Username field', f.user)}
                {row('Password field', f.pass)}
                {row('Sign-in button', f.submit)}
              </ul>
              {canEdit &&
                (current === res.path ? (
                  <span className="muted small">This is the login page in use.</span>
                ) : (
                  <button className="btn sm primary" onClick={use}>
                    Use {res.path} as the login page
                  </button>
                ))}
              <p className="muted small" style={{ margin: '6px 0 0' }}>
                The fields and button are found the same way when signing in, so you don’t need to fill them in below.
              </p>
            </div>
          </div>
        ) : (
          <div className="login-find-res err">
            <Ico svg={I.warn} />
            <span>{res.error}</span>
          </div>
        ))}
    </div>
  );
}

/** How a role signs in: login form, single sign-on, or a saved session; plus its authenticator (MFA) secret. */
function SignInRow({ r, i, canEdit, cred }: { r: Any; i: number; canEdit: boolean; cred: Any }) {
  const p = P();
  const method = r.signIn || 'form';
  const [totp, setTotp] = useState('');
  const [editTotp, setEditTotp] = useState(false);
  const [busy, setBusy] = useState('');
  const put = async (bodyIn: Any, done: string) => {
    try {
      const st = await api(`/api/projects/${p.id}/credentials`, { method: 'PUT', body: { roleId: r.id, ...bodyIn } });
      S.creds = { pid: p.id, roles: st };
      emit();
      toast(done);
      return true;
    } catch (e: Any) {
      toast(e.message, 'err');
      return false;
    }
  };
  const saveTotp = async () => {
    setBusy('totp');
    if (await put({ totp }, `Authenticator secret saved for ${r.name || 'the role'}`)) {
      setTotp('');
      setEditTotp(false);
    }
    setBusy('');
  };
  const captureSession = async () => {
    if (!r.name) {
      toast('Name the role first.', 'err');
      return;
    }
    setBusy('session');
    const ctrl = new AbortController();
    const task = startTask(`Saving a session for ${r.name}`, {
      detail: 'Opening a browser window…',
      kind: 'test',
      cancel: () => ctrl.abort(),
    });
    try {
      await saveNow();
      const res = await api(`/api/projects/${p.id}/credentials/session`, {
        method: 'POST',
        raw: true,
        signal: ctrl.signal,
        body: { roleId: r.id },
      });
      let out: Any = null;
      await readNdjson(res, (ev) => {
        if (ev.type === 'progress') task.update({ detail: ev.message });
        else if (ev.type === 'done') out = ev;
        else if (ev.type === 'error') throw new Error(ev.error);
      });
      if (!out) throw new Error('No session came back.');
      S.creds = { pid: p.id, roles: out.status };
      emit();
      task.finish(`Signed in, landed on ${out.landing}`);
      toast(
        `Tests that sign in as ${r.name} now start signed in${out.expires ? `, until about ${new Date(out.expires).toLocaleDateString()}` : ''}.`,
        'ok',
        { title: 'Session saved' },
      );
    } catch (e: Any) {
      if (e.name === 'AbortError') {
        task.fail('');
        toast('No session was saved.', 'info', { title: 'Stopped' });
      } else task.fail(`Couldn’t save a session for ${r.name}: ${e.message}`);
    } finally {
      setBusy('');
    }
  };
  const expired = cred?.sessionExpires && new Date(cred.sessionExpires).getTime() < Date.now();
  return (
    <div className="signin-row">
      <span className="signin-label">Sign-in</span>
      <SF
        disabled={!canEdit}
        value={method}
        onChange={(e) =>
          edit((x) => {
            x.roles[i] = { ...x.roles[i], signIn: e.target.value };
          })
        }
        sx={{ minWidth: 170 }}
      >
        <MenuItem value="form">Login form</MenuItem>
        <MenuItem value="sso">Single sign-on (SSO)</MenuItem>
        <MenuItem value="session">Saved session</MenuItem>
      </SF>
      {method === 'sso' && (
        <TF
          disabled={!canEdit}
          value={r.ssoButton || ''}
          placeholder="SSO button text, e.g. Sign in with Google (found automatically)"
          sx={{ minWidth: 300 }}
          onChange={(e) =>
            edit((x) => {
              x.roles[i] = { ...x.roles[i], ssoButton: e.target.value };
            }, `rl${r.id}sso`)
          }
        />
      )}
      {method === 'session' && (
        <span className="row" style={{ gap: 6 }}>
          {cred?.hasSession ? (
            <>
              <span className={`loz ${expired ? 't-fail' : 't-pass'}`}>{expired ? 'Expired' : 'Saved'}</span>
              <span className="muted small">
                {ago(cred.sessionAt)}
                {cred.sessionBy ? ` by ${cred.sessionBy}` : ''}
                {cred.sessionExpires && !expired ? ` · until ${new Date(cred.sessionExpires).toLocaleDateString()}` : ''}
              </span>
            </>
          ) : (
            <span className="loz">None yet</span>
          )}
          {canEdit && (
            <button
              className="btn sm"
              disabled={!!busy}
              onClick={captureSession}
              title="Opens a browser window on this computer. Sign in there any way the app allows; the session is saved for this role."
            >
              {busy === 'session' ? (
                <>
                  <Spinner />
                  Waiting for you to sign in…
                </>
              ) : cred?.hasSession ? (
                'Sign in again'
              ) : (
                'Sign in in a browser'
              )}
            </button>
          )}
          {canEdit && cred?.hasSession && (
            <button className="btn sm subtle" onClick={() => put({ session: '' }, 'Saved session removed')}>
              Forget
            </button>
          )}
        </span>
      )}
      {method !== 'session' && (
        <span className="row" style={{ gap: 6 }}>
          <span className="muted small">MFA</span>
          {cred?.hasTotp && !editTotp ? (
            <>
              <span className="loz t-pass">Authenticator saved</span>
              {canEdit && (
                <>
                  <button className="btn sm subtle" onClick={() => setEditTotp(true)}>
                    Change
                  </button>
                  <button className="btn sm subtle" onClick={() => put({ totp: '' }, 'Authenticator secret removed')}>
                    Clear
                  </button>
                </>
              )}
            </>
          ) : canEdit && (editTotp || !cred?.hasTotp) ? (
            <>
              <TF
                type="password"
                value={totp}
                autoComplete="off"
                placeholder="Authenticator secret or otpauth:// link (optional)"
                sx={{ minWidth: 280 }}
                onChange={(e) => setTotp(e.target.value)}
                onKeyDown={(e: Any) => {
                  if (e.key === 'Enter' && totp) saveTotp();
                }}
              />
              <button className="btn sm" disabled={!totp || !!busy} onClick={saveTotp}>
                {busy === 'totp' ? <Spinner /> : 'Save'}
              </button>
              {editTotp && (
                <button
                  className="btn sm subtle"
                  onClick={() => {
                    setEditTotp(false);
                    setTotp('');
                  }}
                >
                  Cancel
                </button>
              )}
            </>
          ) : (
            <span className="muted small">None</span>
          )}
        </span>
      )}
      <span className="muted small signin-help">
        {method === 'form'
          ? 'Fills the app’s login form, then the authentication code if one is asked for.'
          : method === 'sso'
            ? 'Clicks the SSO button and fills the identity provider’s pages (Microsoft, Google, Okta, Auth0, Keycloak…) with this username and password. If the provider blocks automated browsers, use a saved session.'
            : 'Sign in once by hand in a real browser window (works with Google, passkeys and push approvals). Tests reuse that session until it expires.'}
      </span>
    </div>
  );
}
