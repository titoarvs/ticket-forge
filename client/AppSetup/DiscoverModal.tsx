'use client';
import { useState } from 'react';
import { P, type Any, saveNow, api, uid, closeModal, toast } from '../core';
import { Modal, Spinner, Ico, I, EmptyState } from '../ui';
import { SF, MenuItem } from '../fields';
import { appSetup, credOf, edit } from './AppSetup';

/** Follows the app's links (optionally signed in) and lets you pick which pages to add. */
export function DiscoverModal() {
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
      const r = await api(`/api/projects/${p.id}/discover`, {
        method: 'POST',
        body: { role: role || undefined },
      });
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
          x.pages.push({
            id: uid(),
            name: f.name,
            path: f.path,
            description: f.title && f.title !== f.name ? f.title : '',
          });
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
        TicketForge opens <b>{p.automation.baseUrl}</b> and follows its links (up to 30 pages). It
        only follows links: it doesn’t click buttons or submit forms, and it skips links that look
        like logging out or deleting.
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
        <p className="muted small">
          Save a username and password for a role to explore the pages behind the login.
        </p>
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
                <input
                  type="checkbox"
                  checked={Boolean(pick[f.path])}
                  onChange={(e) => setPick({ ...pick, [f.path]: e.target.checked })}
                />
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
