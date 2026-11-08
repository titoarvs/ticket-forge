'use client';
// Test automation → App setup: the app's pages, its user roles with their logins, and how to sign in. Test
// scripts then read like `await app.loginAs('Admin'); await app.goto('Orders')`. Passwords are saved
// encrypted on the server, separately from the project, and are never shown again.
import { useEffect, useState } from 'react';
import { S, emit, P, mutate, api, toast, openModal, closeModal, can, uid, saveNow, type Any } from './core';
import { Ico, I, Modal, Spinner, EmptyState, Confirm } from './ui';
import { TF, TA, SF, RB, MenuItem } from './fields';

const blankApp = () => ({ pages: [] as Any[], roles: [] as Any[], login: {} as Any, notes: '' });
export const appSetup = (p: Any) => ({ ...blankApp(), ...(p?.automation?.app || {}) });
/** Edits the App setup; `tag` merges quick typing into one undo step. */
const edit = (fn: (a: Any) => void, tag?: string) => mutate((pp: Any) => {
  pp.automation.app = { ...blankApp(), ...(pp.automation.app || {}) };
  fn(pp.automation.app);
}, tag ? { tag } : undefined);

async function loadCreds() {
  const p = P();
  if (!p) return;
  try { S.creds = { pid: p.id, roles: await api(`/api/projects/${p.id}/credentials`) }; emit(); } catch { /* no access */ }
}
const credOf = (roleId: string) => (S.creds?.pid === P()?.id ? S.creds.roles?.[roleId] : null);

export function AppSetup() {
  const p = P();
  const a = appSetup(p);
  const canEdit = can('project.settings');
  const [open, setOpen] = useState<Record<string, boolean>>({ pages: true, roles: true });
  useEffect(() => { loadCreds(); }, [p.id]);
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const base = String(p.automation.baseUrl || '').replace(/\/+$/, '');
  const loginSet = Object.values(a.login || {}).some(Boolean);

  return (
    <div className="card app-setup" style={{ marginBottom: 16 }}>
      <h3>App setup</h3>
      <p className="sub">Tell TicketForge about the app under test. Scripts use <code>app.goto('Page')</code> and <code>app.loginAs('Role')</code>, so
        they’re easy to read and keep working when an address or password changes. Passwords are stored encrypted and never shown again.</p>

      <SourceSection canEdit={canEdit} open={Boolean(open.source)} toggle={() => toggle('source')} />

      {/* ---------------------------------------------------------------- pages */}
      <div className="as-sec">
        <button type="button" className={`as-h ${open.pages ? '' : 'closed'}`} onClick={() => toggle('pages')}>
          <Ico svg={I.chevron} /><b>Pages</b><span className="count">{a.pages.length}</span>
          <span className="muted small">Where things are, by name</span></button>
        {open.pages && <>
          {a.pages.length ? <table className="tbl as-tbl"><thead><tr><th style={{ width: '22%' }}>Name</th><th style={{ width: '24%' }}>Path</th><th>What’s on it</th><th style={{ width: 72 }} /></tr></thead><tbody>
            {a.pages.map((pg: Any, i: number) => (
              <tr key={pg.id}>
                <td><TF disabled={!canEdit} value={pg.name} placeholder="e.g. Orders" onChange={(e) => edit((x) => { x.pages[i] = { ...x.pages[i], name: e.target.value }; }, `pg${pg.id}n`)} />
                  {pg.fromCode && <div className="muted small as-file" title={pg.file || ''}><Ico svg={I.doc} /> {pg.missing ? <b style={{ color: 'var(--warning)' }}>No longer in the code</b> : (pg.file || 'From code')}</div>}</td>
                <td><TF mono disabled={!canEdit} value={pg.path} placeholder="/orders" spellCheck={false} onChange={(e) => edit((x) => { x.pages[i] = { ...x.pages[i], path: e.target.value.trim() }; }, `pg${pg.id}p`)} /></td>
                <td><TF disabled={!canEdit} value={pg.description || ''} placeholder="e.g. Order list with search and filters" onChange={(e) => edit((x) => { x.pages[i] = { ...x.pages[i], description: e.target.value }; }, `pg${pg.id}d`)} /></td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {base && !String(pg.path || '').includes(':') && <a className="icon-btn" href={`${base}${String(pg.path || '/').startsWith('/') || String(pg.path).startsWith('#') ? '' : '/'}${pg.path || ''}`} target="_blank" rel="noopener noreferrer" title="Open in a new tab"><Ico svg={I.external} /></a>}
                  {canEdit && <button className="icon-btn" aria-label={`Remove ${pg.name || 'page'}`} title="Remove" onClick={() => edit((x) => { x.pages.splice(i, 1); })}><Ico svg={I.trash} /></button>}
                </td>
              </tr>
            ))}
          </tbody></table> : <p className="muted small" style={{ margin: '4px 0 8px 28px' }}>No pages yet. Add the main ones (or discover them), so scripts can open them by name.</p>}
          {canEdit && <div className="row as-actions">
            <button className="btn sm" onClick={() => edit((x) => { x.pages.push({ id: uid(), name: '', path: '/', description: '' }); })}><Ico svg={I.plus} />Add page</button>
            <button className="btn sm" disabled={!base} title={base ? 'Follow the app’s links to find its pages' : 'Set the application URL first'} onClick={() => openModal(<DiscoverModal />)}><Ico svg={I.search} />Discover pages</button>
          </div>}
        </>}
      </div>

      {/* ---------------------------------------------------------------- roles */}
      <div className="as-sec">
        <button type="button" className={`as-h ${open.roles ? '' : 'closed'}`} onClick={() => toggle('roles')}>
          <Ico svg={I.chevron} /><b>Roles &amp; logins</b><span className="count">{a.roles.length}</span>
          <span className="muted small">Who signs in, and with which account</span></button>
        {open.roles && <>
          {a.roles.length ? <table className="tbl as-tbl"><thead><tr><th style={{ width: '16%' }}>Role</th><th>What they can do</th><th style={{ width: '22%' }}>Username</th><th style={{ width: '22%' }}>Password</th><th style={{ width: 120 }} /></tr></thead><tbody>
            {a.roles.map((r: Any, i: number) => <RoleRow key={r.id} r={r} i={i} canEdit={canEdit} />)}
          </tbody></table> : <p className="muted small" style={{ margin: '4px 0 8px 28px' }}>No roles yet. Add one per kind of user (e.g. Admin, Cashier) with a test account, so scripts can sign in.</p>}
          {canEdit && <div className="row as-actions">
            <button className="btn sm" onClick={() => edit((x) => { x.roles.push({ id: uid(), name: '', description: '', username: '' }); })}><Ico svg={I.plus} />Add role</button>
          </div>}
        </>}
      </div>

      {/* ---------------------------------------------------------------- login form */}
      <div className="as-sec">
        <button type="button" className={`as-h ${open.login ? '' : 'closed'}`} onClick={() => toggle('login')}>
          <Ico svg={I.chevron} /><b>Login form</b>
          <span className="muted small">{loginSet ? 'Custom settings' : 'Found automatically. Change it only if signing in fails'}</span></button>
        {open.login && <div className="as-body">
          <div className="grid2">
            {([['path', 'Login page', '/login'], ['success', 'Signed in when… (a path like /dashboard, or text on the page)', 'Leaves the login page'],
              ['usernameField', 'Username field (label or CSS selector)', 'Found automatically'], ['passwordField', 'Password field (label or CSS selector)', 'The password input'],
              ['submitButton', 'Sign-in button (text or CSS selector)', 'Sign in / Log in button']] as [string, string, string][]).map(([k, label, ph]) => (
              <label key={k} className="field"><span>{label}</span>
                <TF disabled={!canEdit} value={a.login?.[k] || ''} placeholder={ph} spellCheck={false} onChange={(e) => edit((x) => { x.login = { ...(x.login || {}), [k]: e.target.value }; }, `login${k}`)} /></label>
            ))}
          </div>
        </div>}
      </div>

      {/* ---------------------------------------------------------------- notes */}
      <div className="as-sec">
        <button type="button" className={`as-h ${open.notes ? '' : 'closed'}`} onClick={() => toggle('notes')}>
          <Ico svg={I.chevron} /><b>Notes for the AI</b><span className="muted small">{a.notes ? 'Added' : 'Test data, conventions, things to avoid'}</span></button>
        {open.notes && <div className="as-body">
          <TA disabled={!canEdit} value={a.notes || ''} placeholder={'e.g. Use the product "Test Mug" for orders. Never press "Delete all". Dates are DD/MM/YYYY.'}
            onChange={(e) => edit((x) => { x.notes = e.target.value; }, 'appnotes')} />
        </div>}
      </div>
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
      S.creds = { pid: p.id, roles: st }; emit();
      setPw(''); setChanging(false);
      toast(value ? `Password saved for ${r.name || 'the role'}` : 'Password removed');
    } catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const testLogin = async () => {
    setBusy('test'); setResult(null);
    try {
      await saveNow(); // the test uses the saved setup
      setResult(await api(`/api/projects/${p.id}/login-test`, { method: 'POST', body: { roleId: r.id } }));
    } catch (e: Any) { setResult({ ok: false, error: e.message }); } finally { setBusy(''); }
  };
  const remove = () => openModal(<Confirm title={`Remove ${r.name || 'this role'}?`} label="Remove" text="The role and its saved password are removed. Scripts that sign in as this role will fail."
    onYes={async () => { edit((x) => { x.roles.splice(i, 1); }); if (cred?.hasPassword) await api(`/api/projects/${p.id}/credentials`, { method: 'PUT', body: { roleId: r.id, password: '' } }).then((st) => { S.creds = { pid: p.id, roles: st }; emit(); }).catch(() => {}); }} />);
  const editingPw = canEdit && (!cred?.hasPassword || changing);
  return <>
    <tr>
      <td><TF disabled={!canEdit} value={r.name} placeholder="e.g. Admin" onChange={(e) => edit((x) => { x.roles[i] = { ...x.roles[i], name: e.target.value }; }, `rl${r.id}n`)} /></td>
      <td><TF disabled={!canEdit} value={r.description || ''} placeholder="e.g. Manages products and refunds" onChange={(e) => edit((x) => { x.roles[i] = { ...x.roles[i], description: e.target.value }; }, `rl${r.id}d`)} /></td>
      <td><TF disabled={!canEdit} value={r.username || ''} placeholder="Email or username" autoComplete="off" spellCheck={false} onChange={(e) => edit((x) => { x.roles[i] = { ...x.roles[i], username: e.target.value.trim() }; }, `rl${r.id}u`)} /></td>
      <td>{editingPw
        ? <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
            <TF type="password" value={pw} placeholder={cred?.hasPassword ? 'New password' : 'Password'} autoComplete="new-password" onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e: Any) => { if (e.key === 'Enter' && pw) savePw(pw); }} />
            <button className="btn sm primary" disabled={!pw || !!busy} onClick={() => savePw(pw)}>{busy === 'pw' ? <Spinner /> : 'Save'}</button>
            {changing && <button className="btn sm subtle" onClick={() => { setChanging(false); setPw(''); }}>Cancel</button>}
          </div>
        : cred?.hasPassword
          ? <span className="row" style={{ gap: 6 }}><span className="loz t-pass">Saved</span>{canEdit && <>
              <button className="btn sm subtle" onClick={() => setChanging(true)}>Change</button>
              <button className="btn sm subtle" disabled={!!busy} onClick={() => savePw('')}>Clear</button></>}</span>
          : <span className="loz">Not set</span>}</td>
      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
        {can('test.run') && <button className="btn sm subtle" disabled={!!busy || !r.username || !cred?.hasPassword} title={!r.username || !cred?.hasPassword ? 'Add a username and password first' : 'Sign in as this role on the application URL'}
          onClick={testLogin}>{busy === 'test' ? <><Spinner />Signing in…</> : 'Test login'}</button>}
        {canEdit && <button className="icon-btn" aria-label={`Remove ${r.name || 'role'}`} title="Remove" onClick={remove}><Ico svg={I.trash} /></button>}
      </td>
    </tr>
    {result && <tr className="as-result"><td colSpan={5}>
      {result.ok
        ? <div className="ok-banner"><Ico svg={I.check} /><span>Signed in as <b>{r.name}</b>. Landed on <code>{new URL(result.url).pathname}</code>{result.title ? ` (“${result.title}”)` : ''}.</span>
            {result.screenshot && <a href={`${result.screenshot}?t=${Date.now()}`} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto' }}><Ico svg={I.external} /> Screenshot</a>}</div>
        : <div className="warn-banner danger"><Ico svg={I.warn} /><span>{result.error}{result.url ? <> (on <code>{(() => { try { return new URL(result.url).pathname; } catch { return result.url; } })()}</code>)</> : ''}. Check the username and password, or the <b>Login form</b> settings.</span>
            {result.screenshot && <a href={`${result.screenshot}?t=${Date.now()}`} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}><Ico svg={I.external} /> Screenshot</a>}</div>}
    </td></tr>}
  </>;
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
    setBusy(true); setErr(''); setFound(null);
    try {
      await saveNow();
      const r = await api(`/api/projects/${p.id}/discover`, { method: 'POST', body: { role: role || undefined } });
      setFound(r.pages);
      setPick(Object.fromEntries(r.pages.map((x: Any) => [x.path, !have.has(x.path)])));
    } catch (e: Any) { setErr(e.message); } finally { setBusy(false); }
  };
  const chosen = (found || []).filter((x) => pick[x.path]);
  const add = () => {
    edit((x) => { for (const f of chosen) if (!x.pages.some((y: Any) => y.path === f.path)) x.pages.push({ id: uid(), name: f.name, path: f.path, description: f.title && f.title !== f.name ? f.title : '' }); });
    closeModal();
    toast(`Added ${chosen.length} page${chosen.length === 1 ? '' : 's'}`);
  };
  return (
    <Modal title="Discover pages" wide actions={[{ label: 'Cancel' }, ...(found ? [{ label: `Add ${chosen.length} page${chosen.length === 1 ? '' : 's'}`, kind: 'primary' as const, disabled: !chosen.length, onClick: add }] : [])]}>
      <p style={{ marginTop: 0 }}>TicketForge opens <b>{p.automation.baseUrl}</b> and follows its links (up to 30 pages). It only follows links: it doesn’t click buttons or submit forms, and it skips links that look like logging out or deleting.</p>
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}>
        <label className="field" style={{ margin: 0, flex: 1 }}><span>Explore as</span>
          <SF value={role} onChange={(e) => setRole(e.target.value)} displayEmpty>
            <MenuItem value="">Not signed in</MenuItem>
            {roles.map((r: Any) => <MenuItem key={r.id} value={r.name}>{r.name}</MenuItem>)}
          </SF></label>
        <button className="btn primary" disabled={busy} onClick={start}>{busy ? <><Spinner />Exploring…</> : found ? 'Explore again' : 'Start'}</button>
      </div>
      {!roles.length && a.roles.length > 0 && <p className="muted small">Save a username and password for a role to explore the pages behind the login.</p>}
      {err && <div className="warn-banner danger" style={{ marginTop: 12 }}><Ico svg={I.warn} /><span>{err}</span></div>}
      {found && (found.length
        ? <div className="discover-list">{found.map((f) => (
            <label key={f.path} className={`check ${have.has(f.path) ? 'muted' : ''}`}>
              <input type="checkbox" checked={Boolean(pick[f.path])} onChange={(e) => setPick({ ...pick, [f.path]: e.target.checked })} />
              <b>{f.name}</b><code>{f.path}</code>{have.has(f.path) && <span className="small">already added</span>}
            </label>))}</div>
        : <EmptyState compact icon={I.search} tone="neutral" title="No pages found"><p>The start page has no links TicketForge could follow. Add pages by hand instead.</p></EmptyState>)}
    </Modal>
  );
}

// ---------------------------------------------------------------- source code → routes
const ago = (t: string) => { const m = Math.round((Date.now() - new Date(t).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
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
  return api(`/api/projects/${p.id}/routes`, { method: 'POST', body: { action: 'scan', kind: src.kind, location: src.location, branch: src.branch } });
}

function SourceSection({ canEdit, open, toggle }: { canEdit: boolean; open: boolean; toggle: () => void }) {
  const p = P();
  const a = appSetup(p);
  const src = a.source || { kind: 'github', location: '', branch: '' };
  const [info, setInfo] = useState<Any>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [changes, setChanges] = useState<Any>(null);
  useEffect(() => { api(`/api/projects/${p.id}/routes`).then(setInfo).catch(() => {}); }, [p.id]);
  // Once in a while, check the code quietly and say if routes changed.
  useEffect(() => {
    if (!canEdit || !src.location || (checked[p.id] && Date.now() - checked[p.id] < 10 * 60000)) return;
    checked[p.id] = Date.now();
    runScan(p, src).then((scan) => {
      const d = diffRoutes(appSetup(P()), scan);
      setChanges(d.added.length || d.removed.length ? { scan, ...d } : null);
      edit((x) => { x.source = { ...(x.source || src), lastScan: { at: scan.at, count: scan.routes.length, frameworks: scan.frameworks, label: scan.label } }; }, 'srcscan');
    }).catch(() => {});
  }, [p.id, src.location]); // eslint-disable-line react-hooks/exhaustive-deps
  const setSrc = (k: string, v: string) => edit((x) => { x.source = { ...(x.source || { kind: 'github', location: '', branch: '' }), [k]: v }; }, `src${k}`);
  const scan = async () => {
    setBusy('scan');
    try {
      const res = await runScan(p, src);
      edit((x) => { x.source = { ...(x.source || src), lastScan: { at: res.at, count: res.routes.length, frameworks: res.frameworks, label: res.label } }; });
      setChanges(null);
      openModal(<RoutesModal scan={res} />);
    } catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const saveToken = async (value: string) => {
    setBusy('token');
    try { setInfo({ ...info, ...(await api(`/api/projects/${p.id}/routes`, { method: 'POST', body: value ? { action: 'saveToken', token: value } : { action: 'clearToken' } })) }); setToken(''); toast(value ? 'GitHub token saved' : 'GitHub token removed'); }
    catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const last = src.lastScan;
  const summary = src.location
    ? <>{last ? <>{last.label || src.location} · {last.frameworks?.join(', ') || 'no routes found'} · {last.count} route{last.count === 1 ? '' : 's'} · checked {ago(last.at)}</> : <>{src.location} · not scanned yet</>}</>
    : 'Find pages from the web app’s code, and keep them in sync';
  return (
    <div className="as-sec">
      <button type="button" className={`as-h ${open ? '' : 'closed'}`} onClick={toggle}>
        <Ico svg={I.chevron} /><b>Source code</b><span className="muted small">{summary}</span></button>
      {changes && <div className="warn-banner as-change"><Ico svg={I.doc} />
        <span>The code changed: {changes.added.length > 0 && <b>{changes.added.length} new route{changes.added.length === 1 ? '' : 's'}</b>}{changes.added.length > 0 && changes.removed.length > 0 && ', '}
          {changes.removed.length > 0 && <b>{changes.removed.length} page{changes.removed.length === 1 ? '' : 's'} no longer in the code</b>}.</span>
        <button className="btn sm" onClick={() => { openModal(<RoutesModal scan={changes.scan} />); setChanges(null); }}>Review</button></div>}
      {open && <div className="as-body">
        <div className="row" style={{ gap: 16, marginBottom: 8 }}>
          <RB disabled={!canEdit} checked={src.kind !== 'folder'} onChange={() => setSrc('kind', 'github')} label="GitHub repository" />
          <RB disabled={!canEdit || !info?.canReadFolders} checked={src.kind === 'folder'} onChange={() => setSrc('kind', 'folder')}
            label={info && !info.canReadFolders ? 'Folder on this computer (open TicketForge at localhost)' : 'Folder on this computer'} />
        </div>
        {src.kind === 'folder'
          ? <label className="field"><span>Folder</span><TF disabled={!canEdit} value={src.location} placeholder="/Users/you/code/my-shop" spellCheck={false} onChange={(e) => setSrc('location', e.target.value)} /></label>
          : <div className="grid2">
              <label className="field"><span>Repository</span><TF disabled={!canEdit} value={src.location} placeholder="owner/name, or a GitHub URL (…/tree/main/apps/web for a subfolder)" spellCheck={false} onChange={(e) => setSrc('location', e.target.value)} /></label>
              <label className="field"><span>Branch (optional)</span><TF disabled={!canEdit} value={src.branch || ''} placeholder="The default branch" spellCheck={false} onChange={(e) => setSrc('branch', e.target.value)} /></label>
              <label className="field" style={{ gridColumn: '1 / -1' }}><span>GitHub token (for private repos, optional)</span>
                {info?.hasToken
                  ? <span className="row" style={{ gap: 6 }}><span className="loz t-pass">Saved</span>{canEdit && <button className="btn sm subtle" disabled={!!busy} onClick={() => saveToken('')}>Remove</button>}
                      <span className="muted small">Stored encrypted. Used only to read this repository.</span></span>
                  : <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                      <TF disabled={!canEdit} type="password" value={token} autoComplete="off" placeholder="A read-only token with Contents: read access. Not needed if the gh CLI is signed in." onChange={(e) => setToken(e.target.value)} />
                      <button className="btn sm" disabled={!canEdit || !token || !!busy} onClick={() => saveToken(token)}>Save</button></div>}
              </label>
            </div>}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary sm" disabled={!canEdit || !src.location || !!busy} onClick={scan}>{busy === 'scan' ? <><Spinner />Scanning…</> : last ? 'Scan again' : 'Scan routes'}</button>
          <span className="muted small">Reads Next.js, SvelteKit, Nuxt, Remix, Astro, React Router, Vue Router, Angular, Laravel, Django and Rails routes. API routes are left out.</span>
        </div>
      </div>}
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
      x.pages = x.pages.filter((pg: Any) => !(pg.fromCode && drop[pg.id])).map((pg: Any) => (files.has(pg.path)
        ? { ...pg, file: files.get(pg.path) || pg.file, missing: false }
        : pg.fromCode ? { ...pg, missing: true } : pg));
      for (const r of d.added) if (add[r.path]) x.pages.push({ id: uid(), name: r.name, path: r.path, description: '', fromCode: true, file: r.file });
    });
    closeModal();
    toast(nAdd || nDrop ? `Pages updated: ${nAdd} added${nDrop ? `, ${nDrop} removed` : ''}` : 'Pages are in sync with the code');
  };
  return (
    <Modal title="Routes in the code" wide actions={[{ label: 'Cancel' }, { label: nAdd || nDrop ? `Update pages (${nAdd + nDrop})` : 'Done', kind: 'primary', onClick: apply }]}>
      <p style={{ marginTop: 0 }}><b>{scan.label}</b> · {scan.frameworks.length ? scan.frameworks.join(', ') : 'no supported router found'} · {scan.routes.length} route{scan.routes.length === 1 ? '' : 's'} in {scan.files.toLocaleString()} files
        {scan.truncated && <span className="muted"> (the repository is very large, so some files may be missing)</span>}</p>
      {!scan.routes.length && <EmptyState compact icon={I.search} tone="neutral" title="No page routes found"><p>TicketForge didn’t recognize a router in this code. Check the path or repository, or add pages by hand.</p></EmptyState>}
      {d.added.length > 0 && <><div className="as-group">New routes ({d.added.length})</div>
        <div className="discover-list">{d.added.map((r: Any) => (
          <label key={r.path} className="check"><input type="checkbox" checked={Boolean(add[r.path])} onChange={(e) => setAdd({ ...add, [r.path]: e.target.checked })} />
            <b>{r.name}</b><code>{r.path}</code><span className="small muted" title={r.file || ''}>{r.framework}</span></label>))}</div></>}
      {d.removed.length > 0 && <><div className="as-group">No longer in the code ({d.removed.length})</div>
        <p className="small muted" style={{ margin: '0 0 6px' }}>These pages came from the code, but their route is gone. Tick to remove them; unticked ones stay, marked as missing.</p>
        <div className="discover-list">{d.removed.map((pg: Any) => (
          <label key={pg.id} className="check"><input type="checkbox" checked={Boolean(drop[pg.id])} onChange={(e) => setDrop({ ...drop, [pg.id]: e.target.checked })} />
            <b>{pg.name}</b><code>{pg.path}</code><span className="small muted">Remove</span></label>))}</div></>}
      {d.kept.length > 0 && <details style={{ marginTop: 12 }}><summary className="small muted">{d.kept.length} route{d.kept.length === 1 ? '' : 's'} already in the pages</summary>
        <div className="discover-list">{d.kept.map((r: Any) => <div key={r.path} className="check"><b>{r.name}</b><code>{r.path}</code></div>)}</div></details>}
    </Modal>
  );
}
