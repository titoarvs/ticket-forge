'use client';
// Administration → Features (owner only): lock or unlock any feature for everyone. A locked feature
// disappears from the app and its API routes refuse requests until it's unlocked. Each change
// applies right away.
import { useEffect, useState } from 'react';
import { S, api, toast, ago, emit, type Any } from './core';
import { Ico, I, Spinner, ErrorState, EmptyState } from './ui';
import { TF } from './fields';

export function FeaturesTab() {
  const [data, setData] = useState<Any>(S.flags || null);
  const [err, setErr] = useState<Any>(null);
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const load = () =>
    api('/api/features')
      .then((d) => {
        setData(d);
        S.flags = d;
        emit();
      })
      .catch(setErr);
  useEffect(() => {
    load();
  }, []);
  if (!S.user?.isOwner)
    return (
      <div className="card">
        <EmptyState
          compact
          icon={I.settings}
          tone="neutral"
          title="Only the owner can change features"
        >
          <p>Ask the owner of this TicketForge to lock or unlock features.</p>
        </EmptyState>
      </div>
    );
  if (err)
    return (
      <div className="card">
        <ErrorState
          compact
          title="Couldn’t load the features"
          error={err}
          onRetry={() => {
            setErr(null);
            load();
          }}
        />
      </div>
    );
  if (!data)
    return (
      <div className="card">
        <Spinner /> Loading…
      </div>
    );

  const set = async (changes: Any, label: string) => {
    setBusy(Object.keys(changes).join(','));
    try {
      const d = await api('/api/features', { method: 'PUT', body: { changes } });
      setData(d);
      S.flags = d;
      emit();
      toast(label);
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const toggle = (f: Any) =>
    set(
      { [f.id]: { locked: !f.locked, note: notes[f.id] ?? f.lock?.note ?? '' } },
      f.locked ? `${f.label} unlocked for everyone` : `${f.label} locked for everyone`,
    );
  const ql = q.trim().toLowerCase();
  const list: Any[] = data.features.filter(
    (f: Any) => !ql || `${f.label} ${f.desc} ${f.group}`.toLowerCase().includes(ql),
  );
  const groups = [...new Set(list.map((f) => f.group))] as string[];
  const lockedN = data.features.filter((f: Any) => f.locked).length;

  return (
    <div className="cards">
      <div className="card wide">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3>Features</h3>
            <p className="sub" style={{ marginBottom: 10 }}>
              Lock a feature to turn it off for everyone. It disappears from the app, and its server
              routes refuse requests, until you unlock it. Projects and their data are never
              deleted: unlocking brings everything back as it was.
            </p>
          </div>
        </div>
        <div className="row ff-tools">
          <TF
            filter
            value={q}
            placeholder="Search features"
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search features"
          />
          <span className="spacer" />
          <span className="muted small">
            {lockedN ? `${lockedN} locked` : 'Everything is on'}
            {data.updatedAt
              ? ` · changed ${ago(data.updatedAt)}${data.updatedBy ? ` by ${data.updatedBy}` : ''}`
              : ''}
          </span>
          {lockedN > 0 && (
            <button
              className="btn sm subtle"
              disabled={!!busy}
              onClick={() =>
                set(
                  Object.fromEntries(
                    data.features
                      .filter((f: Any) => f.locked)
                      .map((f: Any) => [f.id, { locked: false }]),
                  ),
                  'Every feature unlocked',
                )
              }
            >
              Unlock all
            </button>
          )}
        </div>
      </div>
      {groups.map((g) => (
        <div key={g} className="card wide ff-group">
          <h3>{g}</h3>
          <div className="ff-list">
            {list
              .filter((f) => f.group === g)
              .map((f) => (
                <div key={f.id} className={`ff-row ${f.locked ? 'locked' : ''}`}>
                  <div className="ff-main">
                    <div className="ff-title">
                      <b>{f.label}</b>
                      {f.locked ? (
                        <span className="loz t-fail">
                          <Ico svg={I.close} /> Locked
                        </span>
                      ) : (
                        <span className="loz t-pass">On</span>
                      )}
                    </div>
                    <div className="muted small">{f.desc}</div>
                    {f.locked && f.lock && (
                      <div className="small ff-lock">
                        Locked {f.lock.at ? ago(f.lock.at) : ''}
                        {f.lock.by ? ` by ${f.lock.by}` : ''}
                        {f.lock.note ? <> · “{f.lock.note}”</> : ''}
                      </div>
                    )}
                    {!f.locked && (
                      <TF
                        bare
                        className="ff-note"
                        value={notes[f.id] || ''}
                        placeholder="Reason, shown when it’s locked (optional)"
                        onChange={(e) => setNotes({ ...notes, [f.id]: e.target.value })}
                        aria-label={`Reason for locking ${f.label}`}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!f.locked}
                    aria-label={`${f.label}: ${f.locked ? 'locked' : 'on'}`}
                    className={`ff-switch ${f.locked ? '' : 'on'}`}
                    disabled={!!busy}
                    onClick={() => toggle(f)}
                  >
                    {busy === f.id ? <Spinner /> : <span className="ff-knob" />}
                  </button>
                </div>
              ))}
          </div>
        </div>
      ))}
      {!list.length && <p className="muted small">No feature matches.</p>}
    </div>
  );
}
