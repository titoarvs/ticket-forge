'use client';
// Issue versions: the whole issue is saved as a version on every status change (and every restore). Everyone with
// access sees the list, can view a version and compare two of them; admins and managers (issue.restore) can restore.
import { useCallback, useEffect, useState } from 'react';
import { S, P, ago, toast, openModal, closeModal, pullRemote, type Any } from './core';
import { listVersions, restoreVersion } from './api/versions';
import { type Version, labelOf, same, fullTime, fieldKeys, show, matchesIssue } from './logic/versions';
import { Ico, I, Avatar, StatusLoz, Modal, Confirm, EmptyState, ErrorState, Loading, Sk } from './ui';
import { CB } from './fields';

/** The Versions tab of an issue's Activity section. */
export function VersionHistory({ t }: { t: Any }) {
  const pid = P()?.id;
  const [state, setState] = useState<{ loading: boolean; error: Any; versions: Version[]; canRestore: boolean }>({ loading: true, error: null, versions: [], canRestore: false });
  const [picked, setPicked] = useState<number[]>([]);
  // Reload whenever this issue is saved (a status change may have added a version).
  const rev = S.revs?.issues?.[t.id] ?? 0;

  const load = useCallback(async () => {
    try {
      const d = await listVersions(pid, t.id);
      setState({ loading: false, error: null, versions: d.versions || [], canRestore: Boolean(d.canRestore) });
      setPicked((p) => p.filter((n) => (d.versions || []).some((v: Version) => v.number === n)));
    } catch (e: Any) { setState((s) => ({ ...s, loading: false, error: e })); }
  }, [pid, t.id]);
  useEffect(() => { load(); }, [load, rev]);

  const restore = (v: Version) => openModal(<Confirm title={`Restore version ${v.number}?`} label="Restore"
    text={<>The fields of {t.key} are set back to version {v.number} (status <b>{v.status || 'None'}</b>). Comments and history are kept,
      and the restore is saved as a new version.</>}
    onYes={async () => {
      try {
        const r = await restoreVersion(pid, t.id, v.number);
        toast(`${t.key} restored to version ${v.number}. Saved as version ${r.number}.`);
        await pullRemote({ quiet: true });
        await load();
      } catch (e: Any) { toast(`Not restored: ${e.message}`, 'err'); }
    }} />);
  const view = (v: Version) => openModal(<VersionModal t={t} v={v} latest={v.number === state.versions[0]?.number}
    onRestore={state.canRestore && !matchesIssue(t, v) ? () => restore(v) : undefined} />);
  const toggle = (n: number, on: boolean) => setPicked((p) => (on ? [...p.filter((x) => x !== n), n].slice(-2) : p.filter((x) => x !== n)));
  const compare = () => {
    const [a, b] = [...picked].sort((x, y) => x - y).map((n) => state.versions.find((v) => v.number === n)!);
    if (a && b) openModal(<DiffModal t={t} a={a} b={b} />);
  };

  if (state.loading) return (
    <Loading label="Loading versions…"><div className="ver-list">{[0, 1, 2].map((i) => (
      <div key={i} className="ver-row"><Sk w={18} h={18} r={4} /><Sk w={24} h={24} r={12} /><div style={{ flex: 1 }}><Sk w="40%" /><Sk w="25%" h={10} style={{ marginTop: 6 }} /></div><Sk w={70} h={18} r={5} /></div>))}</div></Loading>);
  if (state.error) return <ErrorState compact title="Couldn’t load the versions" error={state.error} onRetry={load} />;
  if (!state.versions.length) return (
    <EmptyState compact icon={I.history} tone="neutral" title="No versions yet">
      <p>A version of the whole issue is saved each time its status changes.</p></EmptyState>);

  const n = state.versions.length;
  return <div className="ver">
    <div className="ver-bar">
      <span className="muted small" aria-live="polite">{picked.length === 2 ? `Comparing version ${Math.min(...picked)} with ${Math.max(...picked)}`
        : n < 2 ? 'Compare becomes available once there are two versions.' : `Select two versions to compare (${picked.length} of 2 selected).`}</span>
      <button className="btn sm" disabled={picked.length !== 2} onClick={compare}><Ico svg={I.history} />Compare</button>
    </div>
    <ol className="ver-list" aria-label={`Versions of ${t.key}, newest first`}>
      {state.versions.map((v, i) => {
        const on = picked.includes(v.number);
        const canRestore = state.canRestore && !matchesIssue(t, v);
        return (
          <li key={v.number} className={`ver-row ${on ? 'on' : ''}`}>
            {n > 1 && <CB size="small" checked={on} onChange={(ev: Any) => toggle(v.number, ev.target.checked)} aria-label={`Select version ${v.number} to compare`} />}
            <Avatar name={v.author} size={24} />
            <div className="ver-main">
              <div className="ver-title"><b>Version {v.number}</b>
                {i === 0 && <span className="label-chip">Latest</span>}
                {v.restoredFrom ? <span className="label-chip">Restored from version {v.restoredFrom}</span> : null}</div>
              <div className="muted small">{v.author || 'Unknown'} · <time dateTime={v.at} title={fullTime(v.at)}>{fullTime(v.at)}</time> <span className="sr-only">({ago(v.at)})</span></div>
            </div>
            <span className="ver-status"><StatusLoz s={v.status || 'None'} /></span>
            <span className="ver-ops">
              <button className="btn sm subtle" onClick={() => view(v)} aria-label={`View version ${v.number}`}>View</button>
              {canRestore && <button className="btn sm" onClick={() => restore(v)} aria-label={`Restore version ${v.number}`}><Ico svg={I.refresh} />Restore</button>}
            </span>
          </li>
        );
      })}
    </ol>
  </div>;
}

/** Every field of one version. */
function VersionModal({ t, v, latest, onRestore }: { t: Any; v: Version; latest: boolean; onRestore?: () => void }) {
  const keys = fieldKeys(v.data);
  return <Modal wide title={`${t.key} · version ${v.number}`} actions={[
    { label: 'Close' },
    { label: 'Restore this version', kind: 'primary', hidden: !onRestore, onClick: () => { closeModal(); onRestore?.(); } },
  ]}>
    <p className="muted small" style={{ marginTop: 0 }}>
      Saved by {v.author || 'Unknown'} on <time dateTime={v.at}>{fullTime(v.at)}</time>{latest ? ' · latest version' : ''}
      {v.restoredFrom ? ` · restored from version ${v.restoredFrom}` : ''}{matchesIssue(t, v) ? ' · the issue matches this version' : ''}
    </p>
    <dl className="ver-fields">
      {keys.map((k) => <div key={k}><dt>{labelOf(k)}</dt><dd>{k === 'status' ? <StatusLoz s={v.data.status || 'None'} /> : show(k, v.data[k])}</dd></div>)}
    </dl>
  </Modal>;
}

/** The fields that differ between two versions, older on the left. */
function DiffModal({ t, a, b }: { t: Any; a: Version; b: Version }) {
  const changed = fieldKeys(a.data, b.data).filter((k) => !same(a.data[k], b.data[k]));
  return <Modal wide title={`${t.key} · version ${a.number} → version ${b.number}`} actions={[{ label: 'Close' }]}>
    {!changed.length ? <EmptyState compact icon={I.check} tone="neutral" title="No differences"><p>Versions {a.number} and {b.number} have the same fields.</p></EmptyState>
      : <>
        <p className="muted small" style={{ marginTop: 0 }}>{changed.length} field{changed.length === 1 ? '' : 's'} changed between these versions.</p>
        <div className="ver-diff-wrap">
          <table className="tbl ver-diff">
            <caption className="sr-only">Fields that differ between version {a.number} and version {b.number}</caption>
            <thead><tr>
              <th scope="col">Field</th>
              <th scope="col">Version {a.number}<span className="muted small"> · {ago(a.at)}</span></th>
              <th scope="col">Version {b.number}<span className="muted small"> · {ago(b.at)}</span></th>
            </tr></thead>
            <tbody>{changed.map((k) => (
              <tr key={k}>
                <th scope="row">{labelOf(k)}</th>
                <td className="ver-old"><span className="sr-only">Old value: </span>{k === 'status' ? <StatusLoz s={a.data.status || 'None'} /> : show(k, a.data[k])}</td>
                <td className="ver-new"><span className="sr-only">New value: </span>{k === 'status' ? <StatusLoz s={b.data.status || 'None'} /> : show(k, b.data[k])}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </>}
  </Modal>;
}
