'use client';
import { useState, useEffect } from 'react';
import { type Any, api, P, openModal, toast } from '../core';
import { Ico, I, Spinner } from '../ui';
import { RB, TF } from '../fields';
import { appSetup, edit } from './AppSetup';
import { RoutesModal } from './RoutesModal';

// ---------------------------------------------------------------- source code → routes
export const ago = (t: string) => {
  const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
  return m < 1
    ? 'just now'
    : m < 60
      ? `${m} min ago`
      : m < 1440
        ? `${Math.round(m / 60)} h ago`
        : `${Math.round(m / 1440)} d ago`;
};
const checked: Record<string, number> = {};
// project id → last automatic check (per browser session)

/** Compares a scan with the pages: new routes, pages whose route is gone, and the rest. */
export function diffRoutes(a: Any, scan: Any) {
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
export function SourceSection({
  canEdit,
  open,
  toggle,
}: {
  canEdit: boolean;
  open: boolean;
  toggle: () => void;
}) {
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
    if (!canEdit || !src.location || (checked[p.id] && Date.now() - checked[p.id] < 10 * 60000))
      return;
    checked[p.id] = Date.now();
    runScan(p, src)
      .then((scan) => {
        const d = diffRoutes(appSetup(P()), scan);
        setChanges(d.added.length || d.removed.length ? { scan, ...d } : null);
        edit((x) => {
          x.source = {
            ...(x.source || src),
            lastScan: {
              at: scan.at,
              count: scan.routes.length,
              frameworks: scan.frameworks,
              label: scan.label,
            },
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
          lastScan: {
            at: res.at,
            count: res.routes.length,
            frameworks: res.frameworks,
            label: res.label,
          },
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
          {last.label || src.location} · {last.frameworks?.join(', ') || 'no routes found'} ·{' '}
          {last.count} route
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
                {changes.removed.length} page{changes.removed.length === 1 ? '' : 's'} no longer in
                the code
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
            <RB
              disabled={!canEdit}
              checked={src.kind !== 'folder'}
              onChange={() => setSrc('kind', 'github')}
              label="GitHub repository"
            />
            <RB
              disabled={!canEdit || !info?.canReadFolders}
              checked={src.kind === 'folder'}
              onChange={() => setSrc('kind', 'folder')}
              label={
                info && !info.canReadFolders
                  ? 'Folder on this computer (open TicketForge at localhost)'
                  : 'Folder on this computer'
              }
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
                      <button
                        className="btn sm subtle"
                        disabled={!!busy}
                        onClick={() => saveToken('')}
                      >
                        Remove
                      </button>
                    )}
                    <span className="muted small">
                      Stored encrypted. Used only to read this repository.
                    </span>
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
                    <button
                      className="btn sm"
                      disabled={!canEdit || !token || !!busy}
                      onClick={() => saveToken(token)}
                    >
                      Save
                    </button>
                  </div>
                )}
              </label>
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn primary sm"
              disabled={!canEdit || !src.location || !!busy}
              onClick={scan}
            >
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
              Reads Next.js, SvelteKit, Nuxt, Remix, Astro, TanStack Router, React Router, Vue
              Router, Angular, Laravel, Django and Rails routes. API routes are left out.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
