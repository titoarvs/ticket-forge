'use client';
// Coding specs: one AI coding prompt per ticket of an epic, with its acceptance criteria and the files or modules it is
// expected to touch. Specs that touch the same file or module are flagged, and the project's setting blocks or warns when
// they are marked ready. AI-produced changes linked to a spec are accepted only after a required reviewer approves them.
import { useCallback, useEffect, useState } from 'react';
import { S, P, ago, can, toast, openModal, mutate, type Any } from './core';
import { listSpecs, generateSpecs, markSpecsReady, linkSpecChange, approveSpecChange, acceptSpecChange, listPeople } from './api/specs';
import { Ico, I, Modal, EmptyState, ErrorState, Loading, Sk, Spinner } from './ui';
import { TF, SF, CB, MenuItem } from './fields';

/** Opens the Coding specs dialog of an epic. */
export const openSpecs = (epic: Any) => openModal(<SpecsModal epic={epic} />);

/** "PR-2 and PR-3 both touch lib/store.js": the tickets and the file or module they share. */
function OverlapLine({ o }: { o: Any }) {
  const keys: string[] = o.specs.map((s: Any) => s.key || s.ticketId);
  const who = keys.length === 2 ? `${keys[0]} and ${keys[1]} both` : `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]} all`;
  return <li>{who} touch <code>{o.target}</code> ({o.kind}{o.crossEpic ? ', in different epics' : ''})</li>;
}

function SpecsModal({ epic }: { epic: Any }) {
  const pid = P()?.id;
  const [state, setState] = useState<{ loading: boolean; error: Any; data: Any }>({ loading: true, error: null, data: null });
  const [busy, setBusy] = useState('');
  const [people, setPeople] = useState<Any[]>([]);
  const [cfg, setCfg] = useState<Any>({ overlapMode: 'block', reviewers: [] });
  const tickets = P().tickets.filter((t: Any) => t.epicId === epic.id && !t.parentId);

  const load = useCallback(async () => {
    try {
      const d = await listSpecs(pid, epic.id);
      setState({ loading: false, error: null, data: d });
      setCfg(d.config);
    } catch (e: Any) { setState((s) => ({ ...s, loading: false, error: e })); }
  }, [pid, epic.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { listPeople(pid).then(setPeople).catch(() => setPeople([])); }, [pid]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); } catch (e: Any) { toast(e.message, 'err'); await load(); }
    finally { setBusy(''); }
  };
  const generate = () => run('generate', async () => {
    const d = await generateSpecs(pid, epic.id);
    setState({ loading: false, error: null, data: d });
    toast(`${d.specs.length} coding spec${d.specs.length === 1 ? '' : 's'} generated for ${epic.title}.`);
  });
  const ready = (ids: string[]) => run('ready', async () => {
    const r = await markSpecsReady(pid, ids);
    if (r.warnings?.length) toast(`Marked ready with ${r.warnings.length} overlap${r.warnings.length === 1 ? '' : 's'}: ${r.warnings.map((o: Any) => `${o.specs.map((s: Any) => s.key).join(' + ')} on ${o.target}`).join('; ')}`, 'warn');
    else toast(ids.length === 1 ? 'Spec marked ready for coding.' : `${ids.length} specs marked ready for coding.`);
    await load();
  });
  // Settings are a project section saved like the other project settings (Project settings permission).
  const saveCfg = (next: Any) => { setCfg(next); mutate((pp: Any) => { pp.specConfig = next; }, { tag: 'specConfig' }); };

  const d = state.data;
  const specs: Any[] = d?.specs || [];
  const drafts = specs.filter((s) => s.status !== 'ready');
  const canEdit = Boolean(d?.canEdit);
  const body = state.loading ? (
    <Loading label="Loading coding specs…"><Sk w="60%" /><Sk w="40%" h={10} style={{ marginTop: 8 }} /></Loading>
  ) : state.error ? <ErrorState compact title="Couldn’t load the coding specs" error={state.error} onRetry={load} />
    : <>
      {d.overlaps.length > 0 && (
        <div className="warn-banner danger" role="alert"><Ico svg={I.warn} /><div>
          <b>{d.overlaps.length} overlap{d.overlaps.length === 1 ? '' : 's'} between specs</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{d.overlaps.map((o: Any) => <OverlapLine key={`${o.kind}:${o.target}`} o={o} />)}</ul>
          <div className="small" style={{ marginTop: 4 }}>{cfg.overlapMode === 'block' ? 'Specs with an overlap can’t be marked ready until it is resolved.' : 'You can still mark these specs ready: you will be warned.'}</div>
        </div></div>
      )}
      {!specs.length ? (
        <EmptyState compact icon={I.doc} tone="neutral" title="No coding specs yet">
          <p>{tickets.length ? `Generate one coding prompt for each of the ${tickets.length} issue${tickets.length === 1 ? '' : 's'} in ${epic.title}.` : `${epic.title} has no issues yet.`}</p></EmptyState>
      ) : <>
        <div className="row" style={{ justifyContent: 'space-between', margin: '8px 0' }}>
          <span className="muted small">{specs.length} spec{specs.length === 1 ? '' : 's'} · {specs.length - drafts.length} ready</span>
          {canEdit && <button className="btn sm" disabled={!drafts.length || !!busy} onClick={() => ready(drafts.map((s) => s.ticketId))}>{busy === 'ready' && <Spinner />}Mark all ready</button>}
        </div>
        <ol className="ver-list" aria-label={`Coding specs of ${epic.title}`}>
          {specs.map((s) => <SpecRow key={s.ticketId} s={s} canEdit={canEdit} isReviewer={Boolean(S.user?.id && cfg.reviewers.includes(S.user.id))} busy={!!busy} onReady={() => ready([s.ticketId])} reload={load} />)}
        </ol>
      </>}
      {can('project.settings') && (
        <details style={{ marginTop: 12 }}>
          <summary className="small">Settings: overlaps and required reviewers</summary>
          <label className="field"><span>When specs overlap</span>
            <SF value={cfg.overlapMode} onChange={(e: Any) => saveCfg({ ...cfg, overlapMode: e.target.value })}>
              <MenuItem value="block">Block: don’t allow marking them ready</MenuItem>
              <MenuItem value="warn">Warn: mark them ready and show the overlap</MenuItem>
            </SF></label>
          <div className="field"><span>Required reviewers (one must approve before AI-produced changes are accepted)</span>
            {people.map((u) => <CB key={u.id} size="small" label={`${u.name} (${u.role})`} checked={cfg.reviewers.includes(u.id)}
              onChange={(ev: Any) => saveCfg({ ...cfg, reviewers: ev.target.checked ? [...cfg.reviewers, u.id] : cfg.reviewers.filter((x: string) => x !== u.id) })} />)}
            {!people.length && <span className="muted small">No people found.</span>}</div>
        </details>
      )}
    </>;
  return <Modal wide title={`Coding specs · ${epic.title}`} actions={[
    { label: 'Close' },
    { label: specs.length ? 'Generate again' : 'Generate coding specs', kind: 'primary', hidden: !d?.canGenerate, busy: busy === 'generate', disabled: !!busy || !tickets.length, onClick: generate },
  ]}>{body}</Modal>;
}

/** One ticket's spec: acceptance criteria, files and modules, the prompt, and the AI-produced changes linked to it. */
function SpecRow({ s, canEdit, isReviewer, busy, onReady, reload }: { s: Any; canEdit: boolean; isReviewer: boolean; busy: boolean; onReady: () => void; reload: () => Promise<void> }) {
  const pid = P()?.id;
  const [ref, setRef] = useState('');
  const [summary, setSummary] = useState('');
  const act = async (fn: () => Promise<Any>, okMsg: string) => {
    try { await fn(); toast(okMsg); } catch (e: Any) { toast(e.message, 'err'); }
    await reload();
  };
  return (
    <li className="ver-row" style={{ display: 'block' }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <div><span className="key">{s.key}</span> <b style={{ fontWeight: 500 }}>{s.title}</b>{' '}
          <span className="label-chip">{s.status === 'ready' ? 'Ready for coding' : 'Draft'}</span>
          {s.overlaps.length > 0 && <span className="label-chip" style={{ color: 'var(--danger)' }}>{s.overlaps.length} overlap{s.overlaps.length === 1 ? '' : 's'}</span>}</div>
        {canEdit && s.status !== 'ready' && <button className="btn sm" disabled={busy} onClick={onReady}>Mark ready</button>}
      </div>
      {s.status === 'ready' && s.readyAt && <div className="muted small">Marked ready by {s.readyBy || 'Unknown'} {ago(s.readyAt)}</div>}
      <details>
        <summary className="small">Open the spec</summary>
        <h4>Acceptance criteria</h4>
        {s.criteria.length ? <ol>{s.criteria.map((c: string, i: number) => <li key={i}>{c}</li>)}</ol> : <p className="muted small">None written yet.</p>}
        <h4>Files and modules it is expected to touch</h4>
        {s.files.length || s.modules.length ? <ul>
          {s.files.map((f: Any) => <li key={f.path}><code>{f.path}</code> <span className="muted small">({f.action === 'create' ? 'new' : 'change'}){f.why ? ` · ${f.why}` : ''}</span></li>)}
          {s.modules.map((m: string) => <li key={`m:${m}`}>Module <code>{m}</code></li>)}
        </ul> : <p className="muted small">No files were predicted.</p>}
        {s.overlaps.length > 0 && <div className="warn-banner danger"><Ico svg={I.warn} /><ul style={{ margin: 0, paddingLeft: 18 }}>{s.overlaps.map((o: Any) => <OverlapLine key={`${o.kind}:${o.target}`} o={o} />)}</ul></div>}
        <h4>Coding prompt</h4>
        <pre className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }}>{s.prompt}</pre>
        <button className="btn sm subtle" onClick={() => navigator.clipboard?.writeText(s.prompt).then(() => toast('Prompt copied.'), () => toast('Couldn’t copy the prompt.', 'err'))}>Copy prompt</button>
        <h4>AI-produced changes</h4>
        {s.changes.map((c: Any) => {
          const approved = c.approvals.length > 0;
          return <div key={c.id} className="row" style={{ gap: 8 }}>
            <code>{c.ref}</code>{c.summary && <span className="muted small">{c.summary}</span>}
            <span className="label-chip">{c.status === 'accepted' ? 'Accepted' : approved ? `Approved by ${c.approvals.map((a: Any) => a.name).join(', ')}` : 'Waiting for a required reviewer'}</span>
            {c.status !== 'accepted' && isReviewer && <button className="btn sm subtle" onClick={() => act(() => approveSpecChange(pid, c.id), 'Approved.')}>Approve as reviewer</button>}
            {c.status !== 'accepted' && canEdit && <button className="btn sm" onClick={() => act(() => acceptSpecChange(pid, c.id), 'Changes accepted.')}>Accept changes</button>}
          </div>;
        })}
        {!s.changes.length && <p className="muted small">None linked yet.</p>}
        {canEdit && s.status === 'ready' && <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <TF size="small" label="Branch, pull request or commit" value={ref} onChange={(e: Any) => setRef(e.target.value)} />
          <TF size="small" label="Summary (optional)" value={summary} onChange={(e: Any) => setSummary(e.target.value)} />
          <button className="btn sm" disabled={!ref.trim()} onClick={() => act(async () => { await linkSpecChange(pid, s.ticketId, ref, summary); setRef(''); setSummary(''); }, 'Changes linked.')}>Link changes</button>
        </div>}
      </details>
    </li>
  );
}
