'use client';
// Source documents: the document the project was created from, plus every document or description added later
// (Add feature with AI, or attached for reference). Read them formatted or as plain text, search inside them,
// and see the epics and issues each one produced.
import { useEffect, useMemo, useRef, useState } from 'react';
import { S, P, api, can, mutate, openModal, closeModal, toast, copyText, ago, epic, ticket, uid, nowIso, me, emit, type Any } from './core';
import { Ico, I, TypeIcon, StatusLoz, EmptyState, Confirm, Modal, Spinner, Swatch } from './ui';
import { TF, TA } from './fields';
import { Markdown } from './GuideCard';
import { openDrawer } from './actions';
import { Header } from './views';
import { FeatureModal } from './FeatureModal';
import { ItemText } from './ListEditor';
import Link from 'next/link';

type Doc = { id: string; name: string; kind: 'original' | 'document' | 'description' | 'reference'; text: string; addedAt?: string; addedBy?: string; summary?: string; assumptions?: string[]; openQuestions?: string[]; issueIds?: string[]; epicIds?: string[]; runs?: Any[] };

const KIND: Record<string, [string, string]> = {
  original: ['Initial feature', 'The document this project was created from'],
  document: ['Added feature', 'Imported with Add feature with AI'],
  description: ['Feature description', 'Described in Add feature with AI'],
  reference: ['Reference', 'Attached for reference'],
};
const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const looksMarkdown = (s: string) => /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|.+\|)/m.test(s);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function allSources(p: Any): Doc[] {
  const out: Doc[] = [];
  if (p.sourceText) out.push({ id: 'original', name: p.sourceName || 'Requirements', kind: 'original', text: p.sourceText, addedAt: p.createdAt,
    summary: p.summary, assumptions: p.assumptions || [], openQuestions: p.openQuestions || [] });
  for (const d of p.sources || []) out.push(d);
  return out;
}

/** Plain text with search matches highlighted. */
function Highlighted({ text, q, current }: { text: string; q: string; current: number }) {
  if (!q) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRe(q)})`, 'gi'));
  let n = -1;
  return <>{parts.map((part, i) => (i % 2 ? <mark key={i} data-hit={++n} className={n === current ? 'on' : ''}>{part}</mark> : part))}</>;
}

/** Attach a document for reference (no generation): upload a file or paste text. */
function AddDocModal() {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    const fd = new FormData(); fd.append('file', file);
    try { const r = await api('/api/parse', { method: 'POST', body: fd }); setName(r.filename); setText(r.text); }
    catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const save = (thenFeature: boolean) => {
    const doc = { id: uid(), name: name.trim() || 'Untitled document', kind: 'reference', text: text.trim(), addedAt: nowIso(), addedBy: me(), issueIds: [], epicIds: [], runs: [] };
    mutate((pp) => { pp.sources ??= []; pp.sources.push(doc); });
    S.sourceDoc = doc.id; closeModal(); emit();
    toast(`Added “${doc.name}”`);
    if (thenFeature) openModal(<FeatureModal initialDoc={{ filename: doc.name, text: doc.text }} sourceId={doc.id} />);
  };
  const ok = text.trim().length > 0;
  return (
    <Modal title="Add a document" wide actions={[{ label: 'Cancel' },
      { label: 'Add and plan work with AI', kind: 'ai', onClick: () => save(true), disabled: !ok, hidden: !can('ai.use') },
      { label: 'Add document', kind: 'primary', onClick: () => save(false), disabled: !ok }]}>
      <p className="muted small" style={{ marginTop: 0 }}>Keep supporting documents with the project: change requests, specs, meeting notes. You can plan new epics and issues from one now or later.</p>
      <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.md,.markdown,.txt,.html,.htm,.xlsx,.xls,.csv,.json" onChange={(e) => upload(e.target.files?.[0])} />
      <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <><Spinner />Reading…</> : <><Ico svg={I.upload} />Upload a file</>}</button>
      <span className="muted small" style={{ marginLeft: 8 }}>PDF, Word, Markdown, text, HTML, Excel or CSV, or paste below</span>
      <label className="field" style={{ marginTop: 12 }}><span>Name</span><TF value={name} placeholder="e.g. Change request 12 — loyalty points" onChange={(e) => setName(e.target.value)} /></label>
      <label className="field"><span>Text</span><TA value={text} rows={12} placeholder="Paste the document text…" onChange={(e) => setText(e.target.value)} /></label>
      {ok && <p className="muted small" style={{ margin: 0 }}>{words(text).toLocaleString()} words</p>}
    </Modal>
  );
}

export function Sources() {
  const p = P();
  const docs = allSources(p);
  const sel = docs.find((d) => d.id === S.sourceDoc) || docs[0];
  const [q, setQ] = useState('');
  const [hit, setHit] = useState(0);
  const [plain, setPlain] = useState<Record<string, boolean>>({});
  const bodyRef = useRef<HTMLDivElement>(null);
  const canAdd = can('issue.create');
  const canEdit = can('project.settings') || can('issue.create');

  const hits = useMemo(() => (q && sel ? (sel.text.match(new RegExp(escapeRe(q), 'gi')) || []).length : 0), [q, sel]);
  useEffect(() => { setHit(0); }, [q, sel?.id]);
  useEffect(() => { bodyRef.current?.querySelector(`mark[data-hit="${hit}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [hit, q, sel?.id]);

  const select = (id: string) => { S.sourceDoc = id; setQ(''); emit(); };
  const header = <Header title="Source documents" right={<>
    {canAdd && can('ai.use') && <button className="btn ai" onClick={() => openModal(<FeatureModal />)}><Ico svg={I.plus} />Add feature with AI</button>}
    {canAdd && <button className="btn primary" onClick={() => openModal(<AddDocModal />)}><Ico svg={I.upload} />Add document</button>}</>} />;

  if (!sel) return <>{header}
    <EmptyState icon={I.doc} tone="neutral" title="No source documents yet"
      actions={canAdd && <button className="btn primary" onClick={() => openModal(<AddDocModal />)}><Ico svg={I.upload} />Add document</button>}>
      <p>This project was created without a requirements document. Documents you import with <b>Add feature with AI</b> or add here are kept on this page.</p></EmptyState></>;

  const formatted = !plain[sel.id] && !q && looksMarkdown(sel.text);
  const issues = (sel.issueIds || []).map(ticket).filter(Boolean);
  const epics = (sel.epicIds || []).map(epic).filter(Boolean);
  const wc = words(sel.text);
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([sel.text], { type: 'text/markdown' }));
    a.download = `${sel.name.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\- ]+/g, '').trim() || 'document'}.md`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const rename = () => {
    let v = sel.name;
    openModal(<Modal title="Rename document" actions={[{ label: 'Cancel' }, { label: 'Rename', kind: 'primary', onClick: () => { if (v.trim()) mutate((pp) => { const d = pp.sources.find((x: Any) => x.id === sel.id); if (d) d.name = v.trim(); }); closeModal(); } }]}>
      <label className="field"><span>Name</span><TF autoFocus defaultValue={sel.name} onChange={(e) => { v = e.target.value; }} /></label></Modal>);
  };
  const remove = () => openModal(<Confirm title={`Remove “${sel.name}”?`} label="Remove"
    text={`The document is removed from this project.${issues.length ? ` The ${issues.length} issue${issues.length === 1 ? '' : 's'} it produced stay.` : ''} You can undo with ⌘Z.`}
    onYes={() => { mutate((pp) => { pp.sources = (pp.sources || []).filter((x: Any) => x.id !== sel.id); }); S.sourceDoc = null; emit(); }} />);

  return <>
    {header}
    <div className="src-layout">
      <nav className="src-list" aria-label="Documents">
        <div className="muted small src-list-h">{docs.length} document{docs.length === 1 ? '' : 's'}</div>
        {docs.map((d) => <button key={d.id} className={`src-item ${d.id === sel.id ? 'on' : ''}`} aria-current={d.id === sel.id} onClick={() => select(d.id)}>
          <Ico svg={I.doc} /><span className="src-item-t"><b title={d.name}>{d.name}</b>
            <span className="muted small">{KIND[d.kind]?.[0]} · {words(d.text).toLocaleString()} words{(d.issueIds || []).length ? ` · ${(d.issueIds || []).length} issues` : ''}</span>
            {d.addedAt && <span className="muted small">{d.kind === 'original' ? 'Created' : 'Added'} {ago(d.addedAt)}{d.addedBy ? ` by ${d.addedBy}` : ''}</span>}</span>
        </button>)}
      </nav>

      <section className="src-view">
        <div className="src-head">
          <div style={{ minWidth: 0 }}>
            <h2 className="src-title" title={sel.name}>{sel.name}</h2>
            <div className="muted small row" style={{ gap: 8 }}><span className={`src-kind k-${sel.kind}`} title={KIND[sel.kind]?.[1]}>{KIND[sel.kind]?.[0]}</span>
              <span>{wc.toLocaleString()} words · about {Math.max(1, Math.round(wc / 230))} min read</span>
              {sel.addedAt && <span>{sel.kind === 'original' ? 'Created' : 'Added'} {ago(sel.addedAt)}{sel.addedBy ? ` by ${sel.addedBy}` : ''}</span>}</div>
          </div>
          <div className="row src-actions">
            {canAdd && can('ai.use') && <button className="btn ai sm" onClick={() => openModal(<FeatureModal initialDoc={{ filename: sel.name, text: sel.text }} sourceId={sel.id === 'original' ? undefined : sel.id} />)} title="Plan more epics and issues from this document"><Ico svg={I.sparkle} />Plan work from it</button>}
            <button className="btn sm" onClick={() => copyText(sel.text)}><Ico svg={I.copy} />Copy</button>
            <button className="btn sm" onClick={download}><Ico svg={I.download} />Download</button>
            {canEdit && sel.kind !== 'original' && <><button className="icon-btn" title="Rename" aria-label="Rename document" onClick={rename}><Ico svg={I.pencil} /></button>
              <button className="icon-btn" title="Remove" aria-label="Remove document" onClick={remove}><Ico svg={I.trash} /></button></>}
          </div>
        </div>

        {(sel.summary || epics.length > 0 || issues.length > 0 || (sel.openQuestions || []).length > 0 || (sel.assumptions || []).length > 0) && <div className="src-work">
          {sel.summary && <p style={{ margin: '0 0 8px' }}>{sel.summary}</p>}
          {epics.length > 0 && <div className="row" style={{ gap: 6, marginBottom: 6 }}><span className="muted small">Epics</span>{epics.map((e: Any) => <button key={e.id} className="src-chip" onClick={() => openDrawer('epic', e.id)}><Swatch color={e.color} />{e.title}</button>)}</div>}
          {issues.length > 0 && <details className="src-issues" open={issues.length <= 6}><summary className="small"><b>{issues.length} issue{issues.length === 1 ? '' : 's'}</b> created from this document</summary>
            <div className="rows">{issues.map((t: Any) => <div key={t.id} className="irow" onClick={() => openDrawer('issue', t.id)}><TypeIcon type={t.type} /><span className="key">{t.key}</span><span className="sum">{t.title}</span><span className="right"><StatusLoz s={t.status} /></span></div>)}</div></details>}
          {(sel.issueIds || []).length > issues.length && <p className="muted small" style={{ margin: '4px 0 0' }}>{(sel.issueIds || []).length - issues.length} issue(s) from this document were deleted since.</p>}
          {[['Assumptions', sel.assumptions], ['Open questions', sel.openQuestions]].map(([label, l]: Any) => l?.length > 0 && <details key={label} className="src-lists">
            <summary className="small"><b>{l.length} {label.toLowerCase()}</b>{sel.kind === 'original' && can('project.settings') && <> · <Link href={`/p/${p.id}/settings`} onClick={() => { S.setTab = 'details'; }}>Edit</Link></>}</summary>
            <ol className="li-list read">{l.map((x: string, i: number) => <li key={i}><span className="li-n">{i + 1}</span><div className="li-body"><ItemText s={x} /></div></li>)}</ol></details>)}
        </div>}

        <div className="src-tools">
          <div className="search src-search"><Ico svg={I.search} /><input value={q} placeholder="Find in document" aria-label="Find in document" onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && hits) { e.preventDefault(); setHit((h) => (e.shiftKey ? (h - 1 + hits) % hits : (h + 1) % hits)); } if (e.key === 'Escape') setQ(''); }} /></div>
          {q && <span className="muted small" aria-live="polite">{hits ? `${hit + 1} of ${hits}` : 'No matches'}</span>}
          {q && hits > 1 && <><button className="icon-btn" aria-label="Previous match" onClick={() => setHit((h) => (h - 1 + hits) % hits)}><Ico svg={I.up} /></button>
            <button className="icon-btn" aria-label="Next match" onClick={() => setHit((h) => (h + 1) % hits)}><Ico svg={I.down} /></button></>}
          <div className="spacer" />
          {looksMarkdown(sel.text) && !q && <div className="seg" role="radiogroup" aria-label="View">
            <button role="radio" aria-checked={formatted} className={formatted ? 'on' : ''} onClick={() => setPlain({ ...plain, [sel.id]: false })}>Formatted</button>
            <button role="radio" aria-checked={!formatted} className={!formatted ? 'on' : ''} onClick={() => setPlain({ ...plain, [sel.id]: true })}>Plain text</button></div>}
        </div>
        <div className="src-body" ref={bodyRef}>
          {formatted ? <div className="guide-preview src-md"><Markdown text={sel.text} /></div>
            : <div className="source src-plain"><Highlighted text={sel.text} q={q} current={hit} /></div>}
        </div>
      </section>
    </div>
  </>;
}
