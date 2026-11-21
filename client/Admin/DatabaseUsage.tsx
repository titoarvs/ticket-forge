'use client';
// Administration → Email & database → Database: which database is in use and, on Supabase, how much
// of the free plan's 500 MB it fills. Near the limit it shows how to switch to PostgreSQL on this
// computer (`npm run db:switch -- local`); on the local database, how to move back. Owner only:
// for anyone else the server refuses and nothing is shown.
import { useEffect, useState } from 'react';
import { api, type Any } from '../core';

const mb = (b: number | null) =>
  b == null ? '—' : `${(b / 1024 / 1024).toFixed(b < 1e7 ? 1 : 0)} MB`;

function Bar({ percent }: { percent: number }) {
  const color = percent >= 95 ? 'var(--danger)' : percent >= 80 ? 'var(--warning)' : 'var(--brand)';
  return (
    <div
      role="meter"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Share of the free plan used"
      style={{ height: 6, borderRadius: 3, background: 'var(--bg-neutral)', margin: '6px 0' }}
    >
      <div
        style={{
          width: `${Math.min(100, percent)}%`,
          height: '100%',
          borderRadius: 3,
          background: color,
        }}
      />
    </div>
  );
}

function Advice({ u }: { u: Any }) {
  if (u.kind === 'local')
    return (
      <p className="muted small">
        Running on PostgreSQL on this computer; the hosted database is frozen.
        {u.hostedSaved ? (
          <>
            {' '}
            Move the data back with <code>npm run db:switch -- hosted</code>, then restart.
          </>
        ) : (
          ' Set HOSTED_DATABASE_URL in .env to move back later.'
        )}
      </p>
    );
  if (u.kind !== 'supabase') return null;
  return (
    <p className={`small ${u.nearLimit ? '' : 'muted'}`}>
      {u.nearLimit ? 'Almost full. ' : ''}When the free plan is full, switch to PostgreSQL on this
      computer with <code>npm run db:switch -- local</code> (all data is copied and checked) and
      move back later with <code>npm run db:switch -- hosted</code>.
    </p>
  );
}

export function DatabaseUsage() {
  const [u, setU] = useState<Any>(null);
  useEffect(() => {
    let live = true;
    api('/api/admin/database')
      .then((r) => live && setU(r))
      .catch(() => {
        /* not the owner: nothing to show */
      });
    return () => {
      live = false;
    };
  }, []);
  if (!u) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div className="small">
        <b>{mb(u.sizeBytes)}</b>
        {u.limitBytes ? ` of ${mb(u.limitBytes)} (Supabase free plan) · ${u.percent}%` : ' used'}
      </div>
      {u.percent != null && <Bar percent={u.percent} />}
      <Advice u={u} />
    </div>
  );
}
