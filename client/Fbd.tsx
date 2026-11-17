'use client';
// Markdown documents written per epic from a template: the Feature Brief (FBD, epic.fbd) and the Architecture Record
// Design (ARD, epic.ard). The AI fills the project's template (or the team's). Saved on the epic as Markdown,
// viewable and editable in the app, downloadable as .md or .docx.
import { useEffect, useRef, useState } from 'react';
import { P, api, downloadFrom, saveBlob, can, mutate, toast, openModal, closeModal, readNdjson, aiBody, ago, me, emit, startTask, type Any, type TaskHandle } from './core';
import { Ico, I, Modal, Spinner, Confirm, Elapsed } from './ui';
import { TA, TF, SF, MenuItem } from './fields';
import { Markdown } from './GuideCard';
import { askFirst } from './Clarify';
import { approvalStamp } from '../lib/approval';

type Kind = 'fbd' | 'ard';
type Doc = { key: Kind; name: string; short: string; heading: string; running: (e: Any) => string; about: (e: Any) => string; write: (e: Any) => string; placeholder: string; stat: (md: string) => string };
const issuesOf = (e: Any) => P().tickets.filter((t: Any) => t.epicId === e.id).length;
const confirmCount = (md: string) => (md.match(/\[To confirm:/g) || []).length;
const DOCS: Record<Kind, Doc> = {
  fbd: {
    key: 'fbd', name: 'Feature Brief', short: 'FBD', heading: 'Feature Brief for',
    running: (e) => `Filling the Feature Brief template from the epic, its issues${e.psd ? ', its Problem Statement' : ''} and the source documents…`,
    about: (e) => `Your Feature Brief template filled in for this feature: the solution, journeys, acceptance scenarios, personas, KPIs, scope, risks and milestones.${e.psd ? ' It builds on this epic’s Problem Statement.' : ' Tip: write the Problem Statement first; the brief builds on it.'}`,
    write: (e) => `The AI fills your Feature Brief template for ${e.title}: acceptance scenarios (AS-01…) from its ${issuesOf(e)} issues and their acceptance criteria, ${e.psd ? 'the problem and evidence from its Problem Statement, ' : ''}and the source documents.`,
    placeholder: 'e.g. Owner is Jezrah (Product). Target release: v2.3. First release to 3 pilot firms.',
    stat: (md) => [new Set(md.match(/AS-\d+/g) || []).size && `${new Set(md.match(/AS-\d+/g)).size} acceptance scenarios`, confirmCount(md) && `${confirmCount(md)} points to confirm`].filter(Boolean).join(' · '),
  },
  ard: {
    key: 'ard', name: 'Architecture Record Design', short: 'ARD', heading: 'Architecture Record Design for',
    running: (e) => `Filling the Architecture Record Design template from the epic${e.fbd ? ', its Feature Brief' : ''} and its issues…`,
    about: (e) => `Your Architecture Record Design template filled in for this feature: design drivers, components, decisions (AD-01…), detailed design, security, rollout, rollback and the verification of each acceptance scenario.${e.fbd ? ' It builds on this epic’s Feature Brief.' : ' Tip: write the Feature Brief first; the ARD reuses its acceptance scenarios and open decisions.'}`,
    write: (e) => `The AI fills your Architecture Record Design template for ${e.title} from its ${issuesOf(e)} issues${e.fbd ? ', its Feature Brief (drivers, AS-xx scenarios, open decisions)' : ''}${e.psd ? ', its Problem Statement' : ''}, the source documents and the project’s repository notes.`,
    placeholder: 'e.g. Use the existing Postgres queue table, not a new broker. Rollout behind the PAYROLL_AUDIT flag.',
    stat: (md) => [new Set(md.match(/AD-\d+/g) || []).size && `${new Set(md.match(/AD-\d+/g)).size} decisions`, confirmCount(md) && `${confirmCount(md)} points to confirm`].filter(Boolean).join(' · '),
  },
};
const STATUSES = ['Draft', 'For Review', 'Approved'];
/** Sets a document's status (Problem Statement, Feature Brief or Architecture Record) and records who approved which version. */
export function setDocStatus(epic: Any, k: 'psd' | 'fbd' | 'ard', status: string) {
  mutate(() => {
    let next = { ...epic[k], status };
    if (k !== 'psd') next = { ...next, markdown: syncDocControl(k, next.markdown, next.version || 'v1.0', status) };
    epic[k] = { ...next, ...approvalStamp(next, me()) };
  }, { tag: `${k}.status${epic.id}` });
}
const busy = new Map<string, number>(); // running key → started at
const bk = (k: Kind, id: string) => `${k}:${id}`;
const fileName = (k: Kind, epic: Any, ext: string) => `${DOCS[k].name} - ${epic.title} - ${epic[k]?.version || 'v1.0'}.${ext}`.replace(/[\\/:*?"<>|]+/g, ' ');

/** Updates the version and status in the document's Document Control table, so the document and the panel agree. */
export function syncDocControl(k: Kind, md: string, version: string, status: string) {
  const re = new RegExp(`(\\|\\s*${DOCS[k].heading}[^|]*\\|\\s*)([^|]*)(\\|\\s*[^|]*\\|\\s*)([^|]*)(\\|)`, 'i');
  return md.replace(re, (_m, a, _v, c, _s, e) => `${a}${version} ${c}${status} ${e}`);
}

/**
 * Writes one document and saves it on the epic. Shown in the "Working on…" tray (with Cancel) unless `task` is given:
 * then the caller's task (e.g. "Write missing ARDs") shows the progress. Returns true when it worked.
 */
export async function writeDoc(k: Kind, epic: Any, instructions = '', { task, notify = true }: { task?: TaskHandle; notify?: boolean } = {}): Promise<boolean> {
  const d = DOCS[k];
  if (busy.has(bk(k, epic.id))) { toast(`The ${d.name} for “${epic.title}” is already being written.`, 'info'); return false; }
  const ctrl = new AbortController();
  const own = task ? null : startTask(`Writing the ${d.name}`, { detail: epic.title, kind: 'doc', cancel: () => ctrl.abort() });
  const t = task || own!;
  busy.set(bk(k, epic.id), Date.now()); emit();
  try {
    const res = await api(`/api/projects/${P().id}/${k}`, { method: 'POST', raw: true, signal: ctrl.signal, body: aiBody({ epicId: epic.id, instructions }) });
    let out: Any = null;
    await readNdjson(res, (ev) => {
      if (ev.type === 'done') out = ev; else if (ev.type === 'error') throw new Error(ev.error);
      else if (ev.type === 'progress' && ev.message && own) own.update({ detail: `${epic.title} · ${ev.message.replace(/…$/, '')}` });
    });
    if (!out?.markdown) throw new Error(`The AI didn’t return a ${d.name}.`);
    const prev = epic[k];
    mutate(() => { epic[k] = { markdown: out.markdown, generatedAt: new Date().toISOString(), generatedBy: me(), version: prev?.version || 'v1.0', status: prev?.status || 'Draft' }; });
    own?.finish(`Saved on “${epic.title}”`);
    if (out.missing?.length) toast(`These template sections are missing: ${out.missing.join(', ')}. Edit it or write it again.`, 'warn', { title: `${d.name} written with gaps`, action: { label: 'Open', onClick: () => openDoc(k, epic) } });
    else if (notify) toast(`“${epic.title}” · ${out.markdown.length.toLocaleString()} characters`, 'ok', { title: `${d.name} ready`, action: { label: 'View', onClick: () => openDoc(k, epic) } });
    return true;
  } catch (e: Any) {
    if (e.name === 'AbortError') { own?.fail(''); toast(`Nothing was saved for “${epic.title}”.`, 'info', { title: `Stopped writing the ${d.name}` }); return false; }
    if (own) own.fail(`Couldn’t write the ${d.name} for “${epic.title}”: ${e.message}`); else toast(`Couldn’t write the ${d.name} for “${epic.title}”: ${e.message}`, 'err');
    return false;
  } finally { busy.delete(bk(k, epic.id)); emit(); }
}

export const downloadDocMd = (k: Kind, epic: Any) => saveBlob(new Blob([epic[k].markdown], { type: 'text/markdown' }), fileName(k, epic, 'md'));
export async function downloadDocDocx(k: Kind, epic: Any) {
  try {
    const name = await downloadFrom(`/api/projects/${P().id}/${k}/docx`, { body: { epicId: epic.id }, fallbackName: fileName(k, epic, 'docx') });
    toast(`Downloaded ${name}`);
  } catch (e: Any) { toast(`Couldn’t download the ${DOCS[k].name}: ${e.message}`, 'err'); }
}

function WriteModal({ k, epic }: { k: Kind; epic: Any }) {
  const d = DOCS[k];
  const [text, setText] = useState('');
  const go = async () => {
    closeModal();
    const answers = await askFirst({ kind: k, epicId: epic.id, subject: `the ${d.name} for “${epic.title}”`, instructions: text });
    if (answers === null) return;
    await writeDoc(k, epic, [text, answers].filter(Boolean).join('\n\n'));
  };
  return (
    <Modal title={`${epic[k] ? 'Rewrite' : 'Write'} the ${d.name}`} actions={[{ label: 'Cancel' }, { label: epic[k] ? 'Rewrite' : 'Write it', kind: 'ai', onClick: go }]}>
      <p className="muted small" style={{ marginTop: 0 }}>{d.write(epic)} What it can’t know becomes <i>[To confirm: …]</i>. First it asks you a few questions; answer what you can or skip them.{epic[k] ? ' Your edits to the current one are replaced (you can undo).' : ''}</p>
      <label className="field"><span>Extra instructions (optional)</span>
        <TA value={text} rows={3} placeholder={d.placeholder} onChange={(e) => setText(e.target.value)} /></label>
    </Modal>
  );
}
export const openWriteDoc = (k: Kind, epic: Any) => openModal(<WriteModal k={k} epic={epic} />);

function ViewModal({ k, epic }: { k: Kind; epic: Any }) {
  return (
    <Modal title={`${DOCS[k].name} · ${epic.title}`} wide actions={[{ label: 'Close' }, { label: 'Download .md', onClick: () => downloadDocMd(k, epic) }, { label: 'Download .docx', kind: 'primary', onClick: () => downloadDocDocx(k, epic), hidden: !can('export') }]}>
      <div className="fbd-doc"><Markdown text={epic[k].markdown} /></div>
    </Modal>
  );
}
export const openDoc = (k: Kind, epic: Any) => openModal(<ViewModal k={k} epic={epic} />);

function EditModal({ k, epic }: { k: Kind; epic: Any }) {
  const [md, setMd] = useState(epic[k].markdown);
  const save = () => { mutate(() => { epic[k] = { ...epic[k], markdown: md, editedAt: new Date().toISOString(), editedBy: me() }; }); closeModal(); toast(`${DOCS[k].name} saved`); };
  return (
    <Modal title={`Edit the ${DOCS[k].name} · ${epic.title}`} wide persistent actions={[{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: save, disabled: md === epic[k].markdown }]}>
      <div className="fbd-edit">
        <TA value={md} rows={24} spellCheck onChange={(e) => setMd(e.target.value)} aria-label={`${DOCS[k].name} (Markdown)`} />
        <div className="fbd-doc fbd-preview"><Markdown text={md} /></div>
      </div>
    </Modal>
  );
}

/** A document's section in the epic panel. */
export function DocSection({ k, epic }: { k: Kind; epic: Any }) {
  const d = DOCS[k];
  const f = epic[k];
  const canWrite = can('ai.use') && can('epic.manage');
  const ed = can('epic.manage');
  const set = (key: string, v: string) => {
    if (key === 'status') return setDocStatus(epic, k, v);
    mutate(() => {
      const next = { ...epic[k], [key]: v };
      epic[k] = { ...next, markdown: syncDocControl(k, next.markdown, next.version || 'v1.0', next.status || 'Draft') };
    }, { tag: `${k}.${key}${epic.id}` });
  };
  const glance = f ? (f.markdown.split(/^##\s+/m)[1] || '').split('\n').slice(1).find((l: string) => l.trim() && !l.startsWith('|') && !l.startsWith('<!--')) : '';
  return (
    <div className="sec psd-sec"><div className="sec-title"><h3>{d.name}</h3>
      {f && <span className="muted small" style={{ marginLeft: 'auto' }}>Written {ago(f.generatedAt)}{f.generatedBy ? ` by ${f.generatedBy}` : ''}{f.editedAt ? ` · edited ${ago(f.editedAt)}` : ''}</span>}</div>
      {busy.has(bk(k, epic.id)) ? <Running text={d.running(epic)} since={busy.get(bk(k, epic.id))!} />
        : !f ? <div className="psd-empty">
          <p className="muted small" style={{ margin: '0 0 8px' }}>{d.about(epic)}</p>
          {canWrite ? <button className="btn ai" onClick={() => openWriteDoc(k, epic)}><Ico svg={I.sparkle} />Write {d.name} with AI</button>
            : <span className="muted small">Ask someone who can use the AI and manage epics to write it.</span>}
        </div>
        : <>
          {glance && <div className="psd-glance"><p>{glance.replace(/\*\*/g, '').replace(/^[-\d.]+\s*/, '')}</p><p className="muted small">{d.stat(f.markdown)}</p></div>}
          <div className="row psd-actions">
            <button className="btn sm" onClick={() => openDoc(k, epic)}><Ico svg={I.doc} />View</button>
            {ed && <button className="btn sm" onClick={() => openModal(<EditModal k={k} epic={epic} />)}><Ico svg={I.pencil} />Edit</button>}
            {can('export') && <button className="btn sm primary" onClick={() => downloadDocDocx(k, epic)}><Ico svg={I.download} />.docx</button>}
            <button className="btn sm" onClick={() => downloadDocMd(k, epic)}><Ico svg={I.download} />.md</button>
            {canWrite && <button className="btn sm ai" onClick={() => openWriteDoc(k, epic)}><Ico svg={I.sparkle} />Rewrite</button>}
            <span className="spacer" />
            <label className="psd-meta"><span className="muted small">Version</span><TF disabled={!ed} value={f.version || 'v1.0'} onChange={(e) => set('version', e.target.value)} sx={{ width: 76 }} /></label>
            <label className="psd-meta"><span className="muted small">Status</span><SF disabled={!ed} value={f.status || 'Draft'} onChange={(e) => set('status', e.target.value)}>{STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}</SF></label>
            {ed && <button className="icon-btn" title={`Remove the ${d.name}`} aria-label={`Remove the ${d.name}`} onClick={() => openModal(<Confirm title={`Remove this ${d.name}?`} label="Remove" text="You can undo with ⌘Z, or write it again." onYes={() => mutate(() => { delete epic[k]; })} />)}><Ico svg={I.trash} /></button>}
          </div>
        </>}
    </div>
  );
}

export async function writeMissingDocs(k: Kind) {
  const d = DOCS[k];
  const epics = P().epics.filter((e: Any) => !e[k] && !busy.has(bk(k, e.id)));
  if (!epics.length) { toast(`Every epic already has a ${d.name}.`, 'info'); return; }
  let stop = false;
  const task = startTask(`Writing missing ${d.name}s`, { total: epics.length, kind: 'doc', cancel: () => { stop = true; task.update({ detail: 'Stopping after the current one…' }); } });
  let ok = 0, i = 0;
  for (const e of epics) {
    if (stop) break;
    task.update({ detail: e.title, done: i });
    if (await writeDoc(k, e, '', { task, notify: false })) ok++;
    i++;
  }
  const skipped = epics.length - i;
  if (ok === epics.length) { task.finish(`${ok} written`); toast(`${ok} ${d.name}${ok > 1 ? 's' : ''} written and saved on their epics.`, 'ok', { title: 'All done' }); }
  else { task.finish(`${ok} of ${epics.length} written`); toast(`${ok} of ${epics.length} written${skipped ? `, ${skipped} not started (stopped)` : ''}. ${ok < i ? 'The errors are shown above.' : ''}`, ok ? 'warn' : 'err', { title: `Missing ${d.name}s` }); }
}

/** The in-place "writing…" state on the epic panel: what is happening, how long it has run, and that you can keep working. */
export function Running({ text, since }: { text: string; since: number }) {
  return (
    <div className="psd-running" role="status">
      <div className="run-line"><Spinner /><span>{text}</span><Elapsed since={since} /></div>
      <div className="run-bar"><span /></div>
      <span className="run-hint">Usually 1–3 minutes. You can keep working; it’s also in the tray at the bottom right.</span>
    </div>
  );
}
export const docBusy = (k: Kind, id: string) => busy.has(bk(k, id));

// Feature Brief / ARD names used elsewhere in the app.
export const writeFbd = (epic: Any, instructions = '') => writeDoc('fbd', epic, instructions);
export const downloadFbdMd = (epic: Any) => downloadDocMd('fbd', epic);
export const downloadFbdDocx = (epic: Any) => downloadDocDocx('fbd', epic);
export const openWriteFbd = (epic: Any) => openWriteDoc('fbd', epic);
export const openFbd = (epic: Any) => openDoc('fbd', epic);
export const FbdSection = ({ epic }: { epic: Any }) => <DocSection k="fbd" epic={epic} />;
export const ArdSection = ({ epic }: { epic: Any }) => <DocSection k="ard" epic={epic} />;
export const writeMissingFbds = () => writeMissingDocs('fbd');
export const fbdBusy = (id: string) => docBusy('fbd', id);
const download = (blob: Blob, name: string) => saveBlob(blob, name);

/**
 * A Markdown template a document follows (Feature Brief, Architecture Record Design). In Administration it is the team's
 * template; in Project settings (`project`) it is the project's own, falling back to the team's.
 */
export function MdTemplateCard({ endpoint, title, doc, intro, project = false, ed = true }: { endpoint: string; title: string; doc: string; intro: string; project?: boolean; ed?: boolean }) {
  const [t, setT] = useState<Any>(undefined);
  const [show, setShow] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { api(endpoint).then((d) => setT(d.template)).catch(() => setT(null)); }, [endpoint]);
  const upload = async (file?: File) => {
    if (!file) return;
    if (!/\.(md|markdown|txt)$/i.test(file.name)) { toast('Upload a Markdown file (.md).', 'err'); return; }
    try { const d = await api(endpoint, { method: 'PUT', body: { text: await file.text(), name: file.name } }); setT(d.template); toast(`Template saved. New ${doc}s${project ? ' in this project' : ''} follow it.`); }
    catch (e: Any) { toast(e.message, 'err'); }
  };
  const fallback = project ? 'the team’s template' : 'the default template';
  const chip = !t ? '' : t.scope === 'project' ? 'This project' : t.scope === 'team' ? (project ? 'Team template' : '') : 'Default';
  return (
    <div className="card wide"><h3>{title}</h3>
      <p className="sub">{intro}</p>
      {t === undefined ? <span className="muted small"><Spinner /> Loading…</span> : t === null ? <span className="muted small">Couldn’t load the template.</span> : <div className="psd-tpl">
        <Ico svg={I.doc} /><div style={{ minWidth: 0 }}><b>{t.name}</b>{chip && <span className="label-chip" style={{ marginLeft: 6 }}>{chip}</span>}
          <div className="muted small">{t.sections.length} sections: {t.sections.join(' · ')}</div>
          {t.updatedAt && <div className="muted small">Uploaded {ago(t.updatedAt)}{t.updatedBy ? ` by ${t.updatedBy}` : ''}{project && t.scope === 'team' ? ' in Administration' : ''}</div>}</div>
        <span className="spacer" />
        <button className="btn sm" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Preview'}</button>
        <button className="btn sm" onClick={() => download(new Blob([t.text], { type: 'text/markdown' }), t.name)}><Ico svg={I.download} />Download</button>
        {ed && <button className="btn sm" onClick={() => fileRef.current?.click()}><Ico svg={I.upload} />{t.custom ? 'Replace' : project ? 'Upload for this project' : 'Upload your own'}</button>}
        {ed && t.custom && <button className="btn sm subtle" onClick={() => openModal(<Confirm title={`Go back to ${fallback}?`} label="Switch back" text={`New ${doc}s${project ? ' in this project' : ''} follow ${fallback}. Documents already written don’t change.`} onYes={async () => { const d = await api(endpoint, { method: 'DELETE' }); setT(d.template); }} />)}>{project ? 'Use team template' : 'Use default'}</button>}
      </div>}
      {show && t && <div className="guide-preview" style={{ marginTop: 10 }}><Markdown text={t.text.replace(/<!--[\s\S]*?-->/g, '')} /></div>}
      <input ref={fileRef} type="file" hidden accept=".md,.markdown,.txt" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
const FBD_INTRO = 'The Markdown template each epic’s Feature Brief (FBD) fills in: the AI keeps its headings and tables and replaces the [bracketed prompts].';
const ARD_INTRO = 'The Markdown template each epic’s Architecture Record Design (ARD) fills in, also used by the Architecture Record agent: the AI keeps its headings, tables and IDs (AD-xx, AS-xx, Qxx) and replaces the [bracketed prompts].';
export const FbdTemplateCard = () => <MdTemplateCard endpoint="/api/admin/fbd-template" title="Feature Brief template" doc="Feature Brief"
  intro={`${FBD_INTRO} Your team’s template is the default; upload another to change it for every project.`} />;
export const ArdTemplateCard = () => <MdTemplateCard endpoint="/api/admin/ard-template" title="Architecture Record Design template" doc="Architecture Record Design"
  intro={`${ARD_INTRO} Your team’s template is the default; upload another to change it for every project.`} />;
export const ProjectFbdTemplateCard = ({ ed }: { ed: boolean }) => <MdTemplateCard project ed={ed} endpoint={`/api/projects/${P().id}/templates/fbd`} title="Feature Brief template" doc="Feature Brief"
  intro={`${FBD_INTRO} This project uses the team’s template unless you upload its own.`} />;
export const ProjectArdTemplateCard = ({ ed }: { ed: boolean }) => <MdTemplateCard project ed={ed} endpoint={`/api/projects/${P().id}/templates/ard`} title="Architecture Record Design template" doc="Architecture Record Design"
  intro={`${ARD_INTRO} This project uses the team’s template unless you upload its own.`} />;
