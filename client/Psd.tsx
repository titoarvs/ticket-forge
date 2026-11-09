'use client';
// Problem Statement documents (PSD), one per epic: written by the AI in the structure of the team's template,
// saved on the epic, readable in the app and downloadable as a .docx built from the template.
import { useEffect, useRef, useState } from 'react';
import { S, P, api, can, mutate, toast, openModal, closeModal, readNdjson, aiBody, ago, me, emit, type Any } from './core';
import { Ico, I, Modal, Spinner, Confirm } from './ui';
import { TA, TF, SF, MenuItem } from './fields';

const STATUSES = ['Draft', 'For Review', 'Approved'];
const busy = new Set<string>();

/** Writes the PSD for an epic and saves it on the epic. Returns true when it worked. */
export async function writePsd(epic: Any, instructions = ''): Promise<boolean> {
  if (busy.has(epic.id)) return false;
  busy.add(epic.id); emit();
  try {
    const res = await api(`/api/projects/${P().id}/psd`, { method: 'POST', raw: true, body: aiBody({ epicId: epic.id, instructions }) });
    let psd: Any = null;
    await readNdjson(res, (ev) => { if (ev.type === 'done') psd = ev.psd; else if (ev.type === 'error') throw new Error(ev.error); });
    if (!psd) throw new Error('The AI didn’t return a Problem Statement.');
    const prev = epic.psd;
    mutate(() => { epic.psd = { ...psd, generatedAt: new Date().toISOString(), generatedBy: me(), version: prev?.version || 'v1.0', status: prev?.status || 'Draft' }; });
    return true;
  } catch (e: Any) { toast(`${epic.title}: ${e.message}`, 'err'); return false; }
  finally { busy.delete(epic.id); emit(); }
}

/** Downloads the epic's PSD as .docx (the team's template when uploaded). */
export async function downloadPsd(epic: Any) {
  try {
    const res = await api(`/api/projects/${P().id}/psd/docx`, { method: 'POST', raw: true, body: { epicId: epic.id } });
    const blob = await res.blob();
    const name = decodeURIComponent((res.headers.get('content-disposition') || '').match(/filename\*=UTF-8''([^;]+)/)?.[1] || `Problem Statement - ${epic.title}.docx`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e: Any) { toast(e.message, 'err'); }
}

function WriteModal({ epic }: { epic: Any }) {
  const [text, setText] = useState('');
  return (
    <Modal title={`${epic.psd ? 'Rewrite' : 'Write'} the Problem Statement`} actions={[{ label: 'Cancel' }, { label: epic.psd ? 'Rewrite' : 'Write it', kind: 'ai', onClick: () => { closeModal(); writePsd(epic, text).then((ok) => ok && toast(`Problem Statement ready: ${epic.title}`)); } }]}>
      <p className="muted small" style={{ marginTop: 0 }}>The AI writes it from <b>{epic.title}</b>, its {P().tickets.filter((t: Any) => t.epicId === epic.id).length} issues, the project description and the source documents, in the sections of your template: At a Glance, Background, Problem Statement, Who Is Affected, business and user impact, Cost of Inaction and Evidence Needed.{epic.psd ? ' The current one is replaced (you can undo).' : ''}</p>
      <label className="field"><span>Extra instructions (optional)</span>
        <TA value={text} rows={3} placeholder="e.g. Focus on the payroll officers. Mention the BIR deadline. Keep it to one page per section." onChange={(e) => setText(e.target.value)} /></label>
    </Modal>
  );
}
export const openWritePsd = (epic: Any) => openModal(<WriteModal epic={epic} />);

const Table = ({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) => (
  <div className="psd-tbl-wrap"><table className="psd-tbl"><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
);

/** The whole PSD, readable in the app. */
export function PsdDocument({ psd }: { psd: Any }) {
  const g = psd.atAGlance || {};
  return (
    <article className="psd-doc">
      <header className="psd-cover"><h1>{psd.title}</h1><span>PROBLEM STATEMENT</span></header>
      <h2>1. At a Glance</h2>
      <ul>{[['The problem:', g.problem], ['Why it matters:', g.whyItMatters], ['Who is affected:', g.whoIsAffected], ['What is proposed:', g.whatIsProposed]].filter(([, x]) => x).map(([l, x]) => <li key={l}><b>{l}</b> {x}</li>)}</ul>
      {psd.definition && <p className="psd-callout"><b>{psd.definition.term}</b> {psd.definition.text}</p>}
      <h2>2. Background and Current Situation</h2>
      <p>{psd.background?.context}</p>
      {psd.background?.today?.length > 0 && <><p className="psd-label">What happens today</p><ul>{psd.background.today.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></>}
      <h2>3. Problem Statement</h2>
      <p>{psd.problemStatement}</p>
      {psd.gaps?.length > 0 && <><p className="psd-label">{psd.gapsTitle}</p>
        <Table head={['Gap', 'What it means']} rows={psd.gaps.map((x: Any) => [<b key="g">{x.gap}</b>, <><div>{x.meaning}</div>{x.examples?.length > 0 && <ul>{x.examples.map((e: Any, i: number) => <li key={i}>{e.area && <b>{e.area}: </b>}{e.text}</li>)}</ul>}</>])} /></>}
      <h2>4. Who Is Affected</h2>
      <Table head={['Who', psd.relationshipHeader, 'How they are affected']} rows={(psd.affected || []).map((x: Any) => [<b key="w">{x.who}</b>, x.relationship, x.how])} />
      <h2>5. Impact on {psd.product || 'the Business'} as a Business</h2>
      <Table head={['Pain point', 'What happens today', `Consequence for ${psd.product || 'the business'}`]} rows={(psd.business || []).map((x: Any) => [<b key="p">{x.pain}</b>, x.today, x.consequence])} />
      <h2>6. Impact on Users</h2>
      {(psd.users || []).map((u: Any) => <section key={u.role}><h3>{u.role}</h3>
        <Table head={['When this happens…', 'What they cannot do today', 'Consequence for them']} rows={u.rows.map((r: Any) => [r.when, r.cannot, r.consequence])} /></section>)}
      <h2>7. Cost of Inaction</h2>
      <ul>{(psd.costOfInaction || []).map((c: Any, i: number) => <li key={i}>{c.lead && <b>{c.lead} </b>}{c.text}</li>)}</ul>
      <h2>8. Evidence Needed for the Problem Gate</h2>
      <Table head={['Evidence', 'What it proves', 'Suggested source', 'Status']} rows={(psd.evidence || []).map((x: Any) => [x.evidence, x.proves, x.source, <span key="s" className={`psd-status ${/^collected/i.test(x.status) ? 'ok' : ''}`}>{x.status}</span>])} />
    </article>
  );
}

function ViewModal({ epic }: { epic: Any }) {
  return (
    <Modal title={`Problem Statement · ${epic.title}`} wide actions={[{ label: 'Close' }, { label: 'Download .docx', kind: 'primary', onClick: () => downloadPsd(epic), hidden: !can('export') }]}>
      <PsdDocument psd={epic.psd} />
    </Modal>
  );
}
export const openPsd = (epic: Any) => openModal(<ViewModal epic={epic} />);

/** The "Problem Statement" section of the epic panel. */
export function PsdSection({ epic }: { epic: Any }) {
  const psd = epic.psd;
  const canWrite = can('ai.use') && can('epic.manage');
  const running = busy.has(epic.id);
  const set = (k: string, v: string) => mutate(() => { epic.psd = { ...epic.psd, [k]: v }; }, { tag: `psd.${k}${epic.id}` });
  return (
    <div className="sec psd-sec"><div className="sec-title"><h3>Problem Statement</h3>
      {psd && <span className="muted small" style={{ marginLeft: 'auto' }}>Written {ago(psd.generatedAt)}{psd.generatedBy ? ` by ${psd.generatedBy}` : ''}</span>}</div>
      {running ? <div className="psd-running"><Spinner /> Writing the Problem Statement from the epic, its issues and the source documents… This takes a minute or two.</div>
        : !psd ? <div className="psd-empty">
          <p className="muted small" style={{ margin: '0 0 8px' }}>A PSD for this feature in your template’s structure: what’s wrong today, who it hurts, what it costs and what evidence is needed.</p>
          {canWrite ? <button className="btn ai" onClick={() => openWritePsd(epic)}><Ico svg={I.sparkle} />Write Problem Statement with AI</button>
            : <span className="muted small">Ask someone who can use the AI and manage epics to write it.</span>}
        </div>
        : <>
          <div className="psd-glance">
            {psd.atAGlance?.problem && <p><b>The problem:</b> {psd.atAGlance.problem}</p>}
            {psd.atAGlance?.whyItMatters && <p><b>Why it matters:</b> {psd.atAGlance.whyItMatters}</p>}
            <p className="muted small">{(psd.affected || []).length} groups affected · {(psd.users || []).length} user roles · {(psd.evidence || []).length} evidence items</p>
          </div>
          <div className="row psd-actions">
            <button className="btn sm" onClick={() => openPsd(epic)}><Ico svg={I.doc} />View</button>
            {can('export') && <button className="btn sm primary" onClick={() => downloadPsd(epic)}><Ico svg={I.download} />Download .docx</button>}
            {canWrite && <button className="btn sm ai" onClick={() => openWritePsd(epic)}><Ico svg={I.sparkle} />Rewrite</button>}
            <span className="spacer" />
            <label className="psd-meta"><span className="muted small">Version</span><TF disabled={!can('epic.manage')} value={psd.version || 'v1.0'} onChange={(e) => set('version', e.target.value)} sx={{ width: 76 }} /></label>
            <label className="psd-meta"><span className="muted small">Status</span><SF disabled={!can('epic.manage')} value={psd.status || 'Draft'} onChange={(e) => set('status', e.target.value)}>{STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}</SF></label>
            {can('epic.manage') && <button className="icon-btn" title="Remove the Problem Statement" aria-label="Remove the Problem Statement" onClick={() => openModal(<Confirm title="Remove this Problem Statement?" label="Remove" text="You can undo with ⌘Z, or write it again." onYes={() => mutate(() => { delete epic.psd; })} />)}><Ico svg={I.trash} /></button>}
          </div>
        </>}
    </div>
  );
}

/** Epics page: write the PSDs that are missing, one after another. */
export async function writeMissingPsds() {
  const epics = P().epics.filter((e: Any) => !e.psd);
  if (!epics.length) { toast('Every epic already has a Problem Statement.'); return; }
  let ok = 0;
  for (const [i, e] of epics.entries()) {
    toast(`Writing Problem Statement ${i + 1} of ${epics.length}: ${e.title}…`);
    if (await writePsd(e)) ok++;
  }
  toast(`${ok} of ${epics.length} Problem Statements written`, ok === epics.length ? undefined : 'err');
}
export const psdBusy = (id: string) => busy.has(id);

/** Administration → Generation: the .docx template every PSD is built from. */
export function PsdTemplateCard() {
  const [t, setT] = useState<Any>(undefined);
  const [busyUp, setBusyUp] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const load = () => api('/api/admin/psd-template').then((d) => setT(d.template)).catch(() => setT(null));
  useEffect(() => { load(); }, []);
  const upload = async (file?: File) => {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) { toast('Upload a Word document (.docx).', 'err'); return; }
    setBusyUp('upload');
    try {
      // Drop embedded bold font files the template doesn't use as such, so it fits serverless upload limits.
      const [{ default: JSZip }, { trimEmbeddedFonts }] = await Promise.all([import('jszip'), import('../lib/docx-fonts.js')]);
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      await trimEmbeddedFonts(zip);
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const fd = new FormData(); fd.append('file', new File([blob], file.name));
      const d = await api('/api/admin/psd-template', { method: 'PUT', body: fd });
      setT(d.template); toast('Template saved. New Problem Statements use it.');
    } catch (e: Any) { toast(e.message, 'err'); } finally { setBusyUp(''); }
  };
  const info = t?.info || {};
  return (
    <div className="card wide"><h3>Problem Statement template</h3>
      <p className="sub">The Word document each epic’s Problem Statement (PSD) is built from: its cover, logo, styles, fonts, header and footer are kept, and the AI’s content fills its sections and tables. Without one, PSDs use a plain layout with the same sections.</p>
      {t === undefined ? <span className="muted small"><Spinner /> Loading…</span> : t ? <div className="psd-tpl">
        <Ico svg={I.doc} /><div style={{ minWidth: 0 }}><b>{t.name}</b>
          <div className="muted small">{(t.bytes / 1048576).toFixed(1)} MB · uploaded {ago(t.updatedAt)}{t.updatedBy ? ` by ${t.updatedBy}` : ''}</div>
          <div className="muted small">Found: cover “{info.coverTitle || '—'}”, {info.sections?.length || 0} sections, {info.tables || 0} tables{info.backMatter ? ', Document Control and Sign-off' : ''}. The product name, feature name, version and status are replaced in each PSD; sign-off names and signatures are left empty.</div>
        </div>
        <span className="spacer" />
        <a className="btn sm" href="/api/admin/psd-template?download=1"><Ico svg={I.download} />Download</a>
        <button className="btn sm" disabled={!!busyUp} onClick={() => fileRef.current?.click()}>{busyUp ? <><Spinner />Uploading…</> : 'Replace'}</button>
        <button className="icon-btn" title="Remove" aria-label="Remove template" onClick={() => openModal(<Confirm title="Remove the template?" label="Remove" text="New PSDs use the plain layout until you upload another." onYes={async () => { await api('/api/admin/psd-template', { method: 'DELETE' }); setT(null); }} />)}><Ico svg={I.trash} /></button>
      </div> : <button className="btn primary" disabled={!!busyUp} onClick={() => fileRef.current?.click()}>{busyUp ? <><Spinner />Uploading…</> : <><Ico svg={I.upload} />Upload template (.docx)</>}</button>}
      <input ref={fileRef} type="file" hidden accept=".docx" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
void S;
