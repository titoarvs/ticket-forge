'use client';
import { useState } from 'react';
import { type Any, P, uid, closeModal, toast, saveNow, api, can } from '../core';
import { Modal, EmptyState, I, Spinner, Ico } from '../ui';
import { appSetup, edit } from './AppSetup';
import { diffRoutes } from './SourceSection';

/**
 * What a scan found compared with the pages: add new routes, flag or remove pages that left the
 * code.
 */
export function RoutesModal({ scan }: { scan: Any }) {
  const a = appSetup(P());
  const d = diffRoutes(a, scan);
  const [add, setAdd] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(d.added.map((r: Any) => [r.path, true])),
  );
  const [drop, setDrop] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(d.removed.map((p: Any) => [p.id, false])),
  );
  const nAdd = d.added.filter((r: Any) => add[r.path]).length;
  const nDrop = d.removed.filter((p: Any) => drop[p.id]).length;
  const apply = () => {
    const files = new Map(scan.routes.map((r: Any) => [r.path, r.file]));
    edit((x) => {
      // Keep file names current, mark pages whose route left the code, add the chosen new ones,
      // remove the chosen gone ones.
      x.pages = x.pages
        .filter((pg: Any) => !(pg.fromCode && drop[pg.id]))
        .map((pg: Any) =>
          files.has(pg.path)
            ? { ...pg, file: files.get(pg.path) || pg.file, missing: false }
            : pg.fromCode
              ? { ...pg, missing: true }
              : pg,
        );
      for (const r of d.added)
        if (add[r.path])
          x.pages.push({
            id: uid(),
            name: r.name,
            path: r.path,
            description: '',
            fromCode: true,
            file: r.file,
          });
    });
    closeModal();
    toast(
      nAdd || nDrop
        ? `Pages updated: ${nAdd} added${nDrop ? `, ${nDrop} removed` : ''}`
        : 'Pages are in sync with the code',
    );
  };
  return (
    <Modal
      title="Routes in the code"
      wide
      actions={[
        { label: 'Cancel' },
        {
          label: nAdd || nDrop ? `Update pages (${nAdd + nDrop})` : 'Done',
          kind: 'primary',
          onClick: apply,
        },
      ]}
    >
      <p style={{ marginTop: 0 }}>
        <b>{scan.label}</b> ·{' '}
        {scan.frameworks.length ? scan.frameworks.join(', ') : 'no supported router found'} ·{' '}
        {scan.routes.length} route{scan.routes.length === 1 ? '' : 's'} in{' '}
        {scan.files.toLocaleString()} files
        {scan.truncated && (
          <span className="muted">
            {' '}
            (the repository is very large, so some files may be missing)
          </span>
        )}
      </p>
      {!scan.routes.length && (
        <EmptyState compact icon={I.search} tone="neutral" title="No page routes found">
          <p>
            TicketForge didn’t recognize a router in this code. Check the path or repository, or add
            pages by hand.
          </p>
        </EmptyState>
      )}
      {d.added.length > 0 && (
        <>
          <div className="as-group">New routes ({d.added.length})</div>
          <div className="discover-list">
            {d.added.map((r: Any) => (
              <label key={r.path} className="check">
                <input
                  type="checkbox"
                  checked={Boolean(add[r.path])}
                  onChange={(e) => setAdd({ ...add, [r.path]: e.target.checked })}
                />
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
            These pages came from the code, but their route is gone. Tick to remove them; unticked
            ones stay, marked as missing.
          </p>
          <div className="discover-list">
            {d.removed.map((pg: Any) => (
              <label key={pg.id} className="check">
                <input
                  type="checkbox"
                  checked={Boolean(drop[pg.id])}
                  onChange={(e) => setDrop({ ...drop, [pg.id]: e.target.checked })}
                />
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
export function LoginFinder({
  base,
  canEdit,
  current,
}: {
  base: string;
  canEdit: boolean;
  current: string;
}) {
  const p = P();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Any>(null);
  const run = async () => {
    setBusy(true);
    setRes(null);
    try {
      await saveNow();
      setRes({
        ok: true,
        ...(await api(`/api/projects/${p.id}/login-detect`, { method: 'POST' })),
      });
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
          title={
            !base
              ? 'Set the application URL first'
              : 'Opens the app and looks for its login form. Nothing is typed or submitted.'
          }
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
              Looks on <b>{base}</b> for a page with a password field: the login-looking pages above
              first, then /login, /sign-in, /sign-in/manual and other usual addresses.
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
                {res.tried?.length > 1 ? (
                  <span className="muted small">
                    {' '}
                    (after trying {res.tried.slice(0, -1).join(', ')})
                  </span>
                ) : null}
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
                The fields and button are found the same way when signing in, so you don’t need to
                fill them in below.
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
