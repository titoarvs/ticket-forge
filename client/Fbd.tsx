'use client';
// Feature Brief documents (FBD), one per epic: the AI fills the team's Markdown template. Saved on the epic as
// Markdown, viewable and editable in the app, downloadable as .md or .docx.
import { useEffect, useRef, useState } from 'react';
import { P, api, downloadFrom, saveBlob, can, mutate, toast, openModal, closeModal, readNdjson, aiBody, ago, me, emit, type Any } from './core';
import { Ico, I, Modal, Spinner, Confirm } from './ui';
import { TA, TF, SF, MenuItem } from './fields';
import { Markdown } from './GuideCard';

const STATUSES = ['Draft', 'For Review', 'Approved'];
const busy = new Set<string>();
export const fbdBusy = (id: string) => busy.has(id);
const fileName = (epic: Any, ext: string) => `Feature Brief - ${epic.title} - ${epic.fbd?.version || 'v1.0'}.${ext}`.replace(/[\\/:*?"<>|]+/g, ' ');

/** Updates the version and status in the brief's Document Control table, so the document and the panel agree. */
function syncDocControl(md: string, version: string, status: string) {
  return md.replace(/(\|\s*Feature Brief for[^|]*\|\s*)([^|]*)(\|\s*[^|]*\|\s*)([^|]*)(\|)/i, (_m, a, _v, c, _s, e) => `${a}${version} ${c}${status} ${e}`);
}

export async function writeFbd(epic: Any, instructions = ''): Promise<boolean> {
  if (busy.has(epic.id)) return false;
  busy.add(epic.id); emit();
  try {
    const res = await api(`/api/projects/${P().id}/fbd`, { method: 'POST', raw: true, body: aiBody({ epicId: epic.id, instructions }) });
    let out: Any = null;
    await readNdjson(res, (ev) => { if (ev.type === 'done') out = ev; else if (ev.type === 'error') throw new Error(ev.error); });
    if (!out?.markdown) throw new Error('The AI didn’t return a Feature Brief.');
    const prev = epic.fbd;
    mutate(() => { epic.fbd = { markdown: out.markdown, generatedAt: new Date().toISOString(), generatedBy: me(), version: prev?.version || 'v1.0', status: prev?.status || 'Draft' }; });
    if (out.missing?.length) toast(`Feature Brief written, but these template sections are missing: ${out.missing.join(', ')}. Edit or rewrite it.`, 'err');
    return true;
  } catch (e: Any) { toast(`${epic.title}: ${e.message}`, 'err'); return false; }
  finally { busy.delete(epic.id); emit(); }
}

const download = (blob: Blob, name: string) => saveBlob(blob, name);
export const downloadFbdMd = (epic: Any) => download(new Blob([epic.fbd.markdown], { type: 'text/markdown' }), fileName(epic, 'md'));
export async function downloadFbdDocx(epic: Any) {
  try {
    const name = await downloadFrom(`/api/projects/${P().id}/fbd/docx`, { body: { epicId: epic.id }, fallbackName: fileName(epic, 'docx') });
    toast(`Downloaded ${name}`);
  } catch (e: Any) { toast(`Couldn’t download the Feature Brief: ${e.message}`, 'err'); }
}

function WriteModal({ epic }: { epic: Any }) {
  const [text, setText] = useState('');
  return (
    <Modal title={`${epic.fbd ? 'Rewrite' : 'Write'} the Feature Brief`} actions={[{ label: 'Cancel' }, { label: epic.fbd ? 'Rewrite' : 'Write it', kind: 'ai', onClick: () => { closeModal(); writeFbd(epic, text).then((ok) => ok && toast(`Feature Brief ready: ${epic.title}`)); } }]}>
      <p className="muted small" style={{ marginTop: 0 }}>The AI fills your Feature Brief template for <b>{epic.title}</b>: requirements (FR-01…) from its {P().tickets.filter((t: Any) => t.epicId === epic.id).length} issues, Given/When/Then acceptance criteria from theirs, {epic.psd ? 'the problem and evidence from its Problem Statement, ' : ''}and the source documents. What it can’t know becomes <i>[To confirm: …]</i>.{epic.fbd ? ' Your edits to the current one are replaced (you can undo).' : ''}</p>
      <label className="field"><span>Extra instructions (optional)</span>
        <TA value={text} rows={3} placeholder="e.g. Owner is Jezrah (Product). Target release: v2.3. First release to 3 pilot firms." onChange={(e) => setText(e.target.value)} /></label>
    </Modal>
  );
}
export const openWriteFbd = (epic: Any) => openModal(<WriteModal epic={epic} />);

function ViewModal({ epic }: { epic: Any }) {
  return (
    <Modal title={`Feature Brief · ${epic.title}`} wide actions={[{ label: 'Close' }, { label: 'Download .md', onClick: () => downloadFbdMd(epic) }, { label: 'Download .docx', kind: 'primary', onClick: () => downloadFbdDocx(epic), hidden: !can('export') }]}>
      <div className="fbd-doc"><Markdown text={epic.fbd.markdown} /></div>
    </Modal>
  );
}
export const openFbd = (epic: Any) => openModal(<ViewModal epic={epic} />);

function EditModal({ epic }: { epic: Any }) {
  const [md, setMd] = useState(epic.fbd.markdown);
  const save = () => { mutate(() => { epic.fbd = { ...epic.fbd, markdown: md, editedAt: new Date().toISOString(), editedBy: me() }; }); closeModal(); toast('Feature Brief saved'); };
  return (
    <Modal title={`Edit the Feature Brief · ${epic.title}`} wide persistent actions={[{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: save, disabled: md === epic.fbd.markdown }]}>
      <div className="fbd-edit">
        <TA value={md} rows={24} spellCheck onChange={(e) => setMd(e.target.value)} aria-label="Feature Brief (Markdown)" />
        <div className="fbd-doc fbd-preview"><Markdown text={md} /></div>
      </div>
    </Modal>
  );
}

/** The "Feature Brief" section of the epic panel. */
export function FbdSection({ epic }: { epic: Any }) {
  const f = epic.fbd;
  const canWrite = can('ai.use') && can('epic.manage');
  const ed = can('epic.manage');
  const set = (k: string, v: string) => mutate(() => {
    const next = { ...epic.fbd, [k]: v };
    epic.fbd = { ...next, markdown: syncDocControl(next.markdown, next.version || 'v1.0', next.status || 'Draft') };
  }, { tag: `fbd.${k}${epic.id}` });
  const glance = f ? (f.markdown.split(/^##\s+/m)[1] || '').split('\n').slice(1).find((l: string) => l.trim() && !l.startsWith('-')) : '';
  return (
    <div className="sec psd-sec"><div className="sec-title"><h3>Feature Brief</h3>
      {f && <span className="muted small" style={{ marginLeft: 'auto' }}>Written {ago(f.generatedAt)}{f.generatedBy ? ` by ${f.generatedBy}` : ''}{f.editedAt ? ` · edited ${ago(f.editedAt)}` : ''}</span>}</div>
      {busy.has(epic.id) ? <div className="psd-running"><Spinner /> Filling the Feature Brief template from the epic, its issues{epic.psd ? ', its Problem Statement' : ''} and the source documents…</div>
        : !f ? <div className="psd-empty">
          <p className="muted small" style={{ margin: '0 0 8px' }}>Your Feature Brief template filled in for this feature: the experience, requirements, acceptance criteria, success measures, risks and rollout.{epic.psd ? ' It builds on this epic’s Problem Statement.' : ' Tip: write the Problem Statement first; the brief builds on it.'}</p>
          {canWrite ? <button className="btn ai" onClick={() => openWriteFbd(epic)}><Ico svg={I.sparkle} />Write Feature Brief with AI</button>
            : <span className="muted small">Ask someone who can use the AI and manage epics to write it.</span>}
        </div>
        : <>
          {glance && <div className="psd-glance"><p>{glance.replace(/\*\*/g, '')}</p><p className="muted small">{(f.markdown.match(/^\|\s*FR-\d+/gm) || []).length ? `${new Set(f.markdown.match(/FR-\d+/g)).size} requirements` : ''}{(f.markdown.match(/\[To confirm:/g) || []).length ? ` · ${(f.markdown.match(/\[To confirm:/g) || []).length} points to confirm` : ''}</p></div>}
          <div className="row psd-actions">
            <button className="btn sm" onClick={() => openFbd(epic)}><Ico svg={I.doc} />View</button>
            {ed && <button className="btn sm" onClick={() => openModal(<EditModal epic={epic} />)}><Ico svg={I.pencil} />Edit</button>}
            {can('export') && <button className="btn sm primary" onClick={() => downloadFbdDocx(epic)}><Ico svg={I.download} />.docx</button>}
            <button className="btn sm" onClick={() => downloadFbdMd(epic)}><Ico svg={I.download} />.md</button>
            {canWrite && <button className="btn sm ai" onClick={() => openWriteFbd(epic)}><Ico svg={I.sparkle} />Rewrite</button>}
            <span className="spacer" />
            <label className="psd-meta"><span className="muted small">Version</span><TF disabled={!ed} value={f.version || 'v1.0'} onChange={(e) => set('version', e.target.value)} sx={{ width: 76 }} /></label>
            <label className="psd-meta"><span className="muted small">Status</span><SF disabled={!ed} value={f.status || 'Draft'} onChange={(e) => set('status', e.target.value)}>{STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}</SF></label>
            {ed && <button className="icon-btn" title="Remove the Feature Brief" aria-label="Remove the Feature Brief" onClick={() => openModal(<Confirm title="Remove this Feature Brief?" label="Remove" text="You can undo with ⌘Z, or write it again." onYes={() => mutate(() => { delete epic.fbd; })} />)}><Ico svg={I.trash} /></button>}
          </div>
        </>}
    </div>
  );
}

export async function writeMissingFbds() {
  const epics = P().epics.filter((e: Any) => !e.fbd);
  if (!epics.length) { toast('Every epic already has a Feature Brief.'); return; }
  let ok = 0;
  for (const [i, e] of epics.entries()) { toast(`Writing Feature Brief ${i + 1} of ${epics.length}: ${e.title}…`); if (await writeFbd(e)) ok++; }
  toast(`${ok} of ${epics.length} Feature Briefs written`, ok === epics.length ? undefined : 'err');
}

/** Administration → Generation: the Markdown template Feature Briefs follow. */
export function FbdTemplateCard() {
  const [t, setT] = useState<Any>(undefined);
  const [show, setShow] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { api('/api/admin/fbd-template').then((d) => setT(d.template)).catch(() => setT(null)); }, []);
  const upload = async (file?: File) => {
    if (!file) return;
    if (!/\.(md|markdown|txt)$/i.test(file.name)) { toast('Upload a Markdown file (.md).', 'err'); return; }
    try { const d = await api('/api/admin/fbd-template', { method: 'PUT', body: { text: await file.text(), name: file.name } }); setT(d.template); toast('Template saved. New Feature Briefs follow it.'); }
    catch (e: Any) { toast(e.message, 'err'); }
  };
  return (
    <div className="card wide"><h3>Feature Brief template</h3>
      <p className="sub">The Markdown template each epic’s Feature Brief (FBD) fills in: the AI keeps its headings and tables and replaces the [bracketed prompts]. Your team’s template is the default; upload another to change it.</p>
      {t === undefined ? <span className="muted small"><Spinner /> Loading…</span> : t && <div className="psd-tpl">
        <Ico svg={I.doc} /><div style={{ minWidth: 0 }}><b>{t.name}</b>{!t.custom && <span className="label-chip" style={{ marginLeft: 6 }}>Default</span>}
          <div className="muted small">{t.sections.length} sections: {t.sections.join(' · ')}</div>
          {t.custom && <div className="muted small">Uploaded {ago(t.updatedAt)}{t.updatedBy ? ` by ${t.updatedBy}` : ''}</div>}</div>
        <span className="spacer" />
        <button className="btn sm" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Preview'}</button>
        <button className="btn sm" onClick={() => download(new Blob([t.text], { type: 'text/markdown' }), t.name)}><Ico svg={I.download} />Download</button>
        <button className="btn sm" onClick={() => fileRef.current?.click()}><Ico svg={I.upload} />{t.custom ? 'Replace' : 'Upload your own'}</button>
        {t.custom && <button className="btn sm subtle" onClick={() => openModal(<Confirm title="Go back to the default template?" label="Use the default" text="New Feature Briefs follow the default template. Briefs already written don’t change." onYes={async () => { const d = await api('/api/admin/fbd-template', { method: 'DELETE' }); setT(d.template); }} />)}>Use default</button>}
      </div>}
      {show && t && <div className="guide-preview" style={{ marginTop: 10 }}><Markdown text={t.text.replace(/<!--[\s\S]*?-->/g, '')} /></div>}
      <input ref={fileRef} type="file" hidden accept=".md,.markdown,.txt" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
