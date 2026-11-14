'use client';
// Brain: the project's knowledge vault (lib/brain.js). Linked Markdown notes about everything TicketForge knows (the
// project, epics, issues, decisions, open questions, releases, documents, the app context and the repository profile),
// kept up to date from the project, plus the team's own notes. AI actions and code agents read the notes linked to
// their task first. Opens in Obsidian (download the vault), imports Obsidian notes, and on this computer syncs with a
// folder. A list with search and filters, the note (Markdown with [[wikilinks]], backlinks), and a graph of the links.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { P, S, api, toast, ago, openModal, closeModal, setMenu, downloadFrom, useStore, epic as epicOf, ticket as ticketOf, type Any } from './core';
import { Ico, I, Modal, Confirm, Menu, Spinner, EmptyState, ErrorState } from './ui';
import { TF, TA, SF, MenuItem } from './fields';
import { MarkdownDoc } from './markdown';
import { Header } from './views';
import { openDrawer } from './actions';
import { FolderPicker } from './DevCode';

const TYPE_LABEL: Record<string, string> = { index: 'Index', project: 'Project', context: 'App context', repo: 'Repository', epic: 'Epic', issue: 'Issue', release: 'Release', source: 'Source', doc: 'Document', decision: 'Decision', question: 'Question', note: 'Note' };
const TYPE_ORDER = ['note', 'epic', 'issue', 'decision', 'question', 'doc', 'release', 'source', 'project', 'context', 'repo', 'index'];
const USER_TYPES = ['note', 'decision', 'question', 'doc'];
const base = (id: string) => String(id).split('/').pop() || id;
const lc = (s: string) => String(s || '').trim().toLowerCase();

type Note = { id: string; kind: 'auto' | 'user'; type: string; key: string; ref: string; title: string; status: string; tags: string[]; updatedAt: string; updatedBy?: string | null; out: string[]; excerpt: string };
type List = { rev: number; builtAt: string | null; notes: Note[]; sync: Any; useInAi: boolean; local: boolean; can: { write: boolean; export: boolean; settings: boolean } };

/** Resolves [[targets]] like the server (and Obsidian): path, file name, title, key. */
function makeResolver(notes: Note[]) {
  const by = new Map<string, string>();
  const put = (k: string, id: string) => { const x = lc(k); if (x && !by.has(x)) by.set(x, id); };
  for (const n of notes) put(n.id, n.id);
  for (const n of notes) put(base(n.id), n.id);
  for (const n of notes) { put(n.title, n.id); put(n.key, n.id); }
  return (t: string) => by.get(lc(t).replace(/\.md$/, '')) || by.get(lc(t).split('/').pop() || '') || null;
}
const readUrlNote = () => { try { return new URLSearchParams(window.location.search).get('note') || ''; } catch { return ''; } };
const writeUrlNote = (id: string) => { try { const u = new URL(window.location.href); if (id) u.searchParams.set('note', id); else u.searchParams.delete('note'); window.history.replaceState(window.history.state, '', u.toString()); } catch { /* ignore */ } };

export function Brain() {
  useStore();
  const p = P();
  const [list, setList] = useState<List | null>(null);
  const [err, setErr] = useState<Any>(null);
  const [sel, setSelRaw] = useState<string>(() => readUrlNote());
  const [note, setNote] = useState<Any>(null);
  const [noteErr, setNoteErr] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [tag, setTag] = useState('');
  const [found, setFound] = useState<string[] | null>(null);
  const [mode, setMode] = useState<'notes' | 'graph'>('notes');
  const [edit, setEdit] = useState<Any>(null);
  const [busy, setBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const setSel = (id: string) => { setSelRaw(id); writeUrlNote(id); if (id) setMode((m) => (m === 'graph' && window.innerWidth < 760 ? 'notes' : m)); };

  const load = async () => {
    try { const l = await api(`/api/projects/${p.id}/brain`); setList(l); setErr(null); return l; } catch (e: Any) { setErr(e); return null; }
  };
  // The brain follows the project: reload (the server refreshes the generated notes) when the project changes.
  useEffect(() => { const t = setTimeout(load, list ? 800 : 0); return () => clearTimeout(t); }, [p.id, p.version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sel) { setNote(null); return; }
    let live = true;
    setNoteErr('');
    api(`/api/projects/${p.id}/brain?note=${encodeURIComponent(sel)}`).then((n) => { if (live) setNote(n); }).catch((e) => { if (live) { setNote(null); setNoteErr(e.message); } });
    return () => { live = false; };
  }, [sel, list?.rev, p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Full-text search on the server (bodies aren't in the list); titles, keys and tags match at once here.
  useEffect(() => {
    if (q.trim().length < 3) { setFound(null); return; }
    const t = setTimeout(() => { api(`/api/projects/${p.id}/brain?search=${encodeURIComponent(q.trim())}`).then((r) => setFound(r.ids)).catch(() => setFound(null)); }, 250);
    return () => clearTimeout(t);
  }, [q, p.id, list?.rev]);

  const notes = list?.notes || [];
  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const resolve = useMemo(() => makeResolver(notes), [notes]);
  const back = useMemo(() => { const m = new Map<string, string[]>(); for (const n of notes) for (const id of n.out) m.set(id, [...(m.get(id) || []), n.id]); return m; }, [notes]);
  const tags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags))].filter((t) => !TYPE_LABEL[t]).sort(), [notes]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const n of notes) c[n.type] = (c[n.type] || 0) + 1; return c; }, [notes]);
  const shown = useMemo(() => {
    const words = lc(q).split(/\s+/).filter(Boolean);
    const hit = new Set(found || []);
    const rank = new Map((found || []).map((id, i) => [id, i]));
    const out = notes.filter((n) => (!type || n.type === type) && (!tag || n.tags.includes(tag))
      && (!words.length || hit.has(n.id) || words.every((w) => lc(`${n.key} ${n.title} ${n.tags.join(' ')} ${n.excerpt}`).includes(w))));
    return out.sort((a, b) => (words.length ? (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999) : 0)
      || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  }, [notes, q, type, tag, found]);
  const can = list?.can || { write: false, export: false, settings: false };

  const refresh = async () => {
    setBusy('refresh');
    try { const r = await api(`/api/projects/${p.id}/brain`, { method: 'POST', body: { action: 'refresh' } }); setList((l) => ({ ...(l as List), ...r })); toast(r.written || r.removed ? `${r.written} note${r.written === 1 ? '' : 's'} updated${r.removed ? `, ${r.removed} removed` : ''}. ${r.total} notes from the project.` : `Up to date: ${r.total} notes from the project.`, 'ok', { title: 'Brain refreshed' }); }
    catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const download = async () => { try { await downloadFrom(`/api/projects/${p.id}/brain?export=zip`, { method: 'GET', fallbackName: `${p.name} brain.zip` }); toast('Unzip it, then in Obsidian choose Open folder as vault.', 'ok', { title: 'Vault downloaded' }); } catch (e: Any) { toast(e.message, 'err'); } };
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append('file', f, f.name);
    setBusy('import');
    try { const r = await api(`/api/projects/${p.id}/brain`, { method: 'POST', body: fd }); await load(); toast(`${r.added} added, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped (notes TicketForge writes itself, or duplicates)` : ''}.`, 'ok', { title: 'Notes imported' }); }
    catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  };
  const startNew = (title = '', body = '') => { setEdit({ title, body, type: 'note', tags: '', status: '' }); setMode('notes'); };
  const saved = async (n: Any) => { setEdit(null); await load(); setSel(n.id); setNote(n); };
  const del = (n: Any) => openModal(<Confirm title={`Delete “${n.title}”?`} label="Delete" text="It’s removed from the brain for everyone. Links to it stay as plain text."
    onYes={async () => { try { await api(`/api/projects/${p.id}/brain`, { method: 'POST', body: { action: 'delete', id: n.id } }); setSel(''); await load(); toast('Note deleted'); } catch (e: Any) { toast(e.message, 'err'); } }} />);

  if (err && !list) return <><Header title="Brain" /><ErrorState error={err} onRetry={load} /></>;
  const right = <>
    <div className="seg brain-seg" role="tablist" aria-label="View">
      <button role="tab" aria-selected={mode === 'notes'} className={mode === 'notes' ? 'on' : ''} onClick={() => setMode('notes')}>Notes</button>
      <button role="tab" aria-selected={mode === 'graph'} className={mode === 'graph' ? 'on' : ''} onClick={() => setMode('graph')}>Graph</button>
    </div>
    {can.write && <button className="btn" onClick={() => startNew()}><Ico svg={I.plus} />New note</button>}
    <button className="btn" disabled={busy === 'refresh'} onClick={refresh} title="Rebuild the notes TicketForge writes from the project (your own notes stay as they are)">{busy === 'refresh' ? <Spinner /> : <Ico svg={I.refresh} />}Refresh brain</button>
    <Menu id="brain-more" button={<button className="icon-btn" aria-label="More brain actions" title="More" onClick={() => setMenu('brain-more')}><Ico svg={I.more} /></button>}>
      {can.export && <button onClick={download}><Ico svg={I.download} />Download for Obsidian (.zip)</button>}
      {can.write && <button onClick={() => fileRef.current?.click()}><Ico svg={I.upload} />Import Obsidian notes…</button>}
      <button onClick={() => openModal(<BrainSettings list={list} reload={load} />)}><Ico svg={I.settings} />Brain settings{list?.local ? ' and folder sync' : ''}</button>
    </Menu>
    <input ref={fileRef} type="file" hidden multiple accept=".md,.markdown,.zip,text/markdown,application/zip" onChange={(e) => importFiles(e.target.files)} />
  </>;
  const sub = list ? <span className="muted small brain-sub">{notes.length} notes · {notes.filter((n) => n.kind === 'user').length} by the team{list.builtAt ? ` · refreshed ${ago(list.builtAt)}` : ''}{list.useInAi ? '' : ' · not used by AI'}</span> : null;

  return <>
    <Header title="Brain" sub={sub} right={<div className="brain-actions">{right}</div>} />
    {!list ? <div className="brain"><div className="brain-list"><div className="muted small" style={{ padding: 14 }}><Spinner /> Building the brain…</div></div><div className="brain-main" /></div>
      : mode === 'graph' ? <BrainGraph notes={shown} all={notes} selected={sel} onSelect={(id) => { setSel(id); setMode('notes'); }} filters={<Filters {...{ q, setQ, type, setType, tag, setTag, tags, counts }} />} />
      : <div className={`brain ${sel || edit ? 'has-note' : ''}`}>
        <aside className="brain-list" aria-label="Notes">
          <Filters {...{ q, setQ, type, setType, tag, setTag, tags, counts }} />
          <div className="brain-count muted small">{shown.length === notes.length ? `${notes.length} notes` : `${shown.length} of ${notes.length} notes`}</div>
          <div className="brain-items" role="list">
            {shown.slice(0, 600).map((n) => <button key={n.id} role="listitem" className={`brain-item ${sel === n.id ? 'active' : ''}`} onClick={() => { setEdit(null); setSel(n.id); }} aria-current={sel === n.id ? 'true' : undefined}>
              <span className={`bn-dot t-${n.type}`} aria-hidden="true" />
              <span className="brain-item-main"><span className="brain-item-title">{n.key && (n.type === 'issue' || n.type === 'epic') ? <b>{n.key} </b> : null}{n.title}</span>
                <span className="brain-item-meta">{TYPE_LABEL[n.type] || n.type}{n.status ? ` · ${n.status}` : ''}{n.kind === 'user' ? ' · team' : ''}</span></span>
            </button>)}
            {shown.length > 600 && <p className="muted small" style={{ padding: '8px 12px' }}>Showing 600 of {shown.length}. Search or filter to narrow the list.</p>}
            {!shown.length && <p className="muted small" style={{ padding: '8px 12px' }}>No notes match.</p>}
          </div>
        </aside>
        <section className="brain-main" aria-label="Note">
          {edit ? <NoteEditor draft={edit} notes={notes} onCancel={() => setEdit(null)} onSaved={saved} />
            : sel && note ? <NoteView note={note} list={list} resolve={resolve} byId={byId} back={back} onOpen={setSel} onBack={() => setSel('')} onEdit={() => setEdit({ id: note.id, title: note.title, body: note.body, type: note.type, tags: (note.tags || []).filter((t: string) => t !== note.type).join(', '), status: note.status, baseUpdatedAt: note.updatedAt })} onDelete={() => del(note)} onCreate={startNew} />
            : sel && noteErr ? <div className="brain-note"><button className="btn sm subtle brain-back" onClick={() => setSel('')}><Ico svg={I.chevron} />Notes</button><ErrorState title="Couldn’t open this note" error={noteErr} compact /></div>
            : sel ? <div className="brain-note muted"><Spinner /> Opening…</div>
            : <BrainHome list={list} onOpen={setSel} onNew={can.write ? () => startNew() : null} />}
        </section>
      </div>}
  </>;
}

function Filters({ q, setQ, type, setType, tag, setTag, tags, counts }: Any) {
  return <div className="brain-filters">
    <TF search size="small" placeholder="Search notes" value={q} onChange={(e: Any) => setQ(e.target.value)} aria-label="Search notes" />
    <div className="brain-filter-row">
      <SF filter size="small" value={type} onChange={(e: Any) => setType(e.target.value)} aria-label="Type"><MenuItem value="">All types</MenuItem>
        {TYPE_ORDER.filter((t) => counts[t]).map((t) => <MenuItem key={t} value={t}><span className={`bn-dot t-${t}`} aria-hidden="true" />{TYPE_LABEL[t]} ({counts[t]})</MenuItem>)}</SF>
      {tags.length > 0 && <SF filter size="small" value={tag} onChange={(e: Any) => setTag(e.target.value)} aria-label="Tag"><MenuItem value="">All tags</MenuItem>{tags.map((t: string) => <MenuItem key={t} value={t}>#{t}</MenuItem>)}</SF>}
      {(type || tag || q) && <button className="btn sm subtle" onClick={() => { setQ(''); setType(''); setTag(''); }}>Clear</button>}
    </div>
  </div>;
}

function BrainHome({ list, onOpen, onNew }: { list: List; onOpen: (id: string) => void; onNew: (() => void) | null }) {
  const idx = list.notes.find((n) => n.type === 'index');
  const recent = list.notes.filter((n) => n.kind === 'user').sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 6);
  return <div className="brain-note brain-home">
    <EmptyState icon={I.brain} tone="ai" title="The project’s brain" compact actions={<>
      {idx && <button className="btn primary" onClick={() => onOpen(idx.id)}>Open the index</button>}
      {onNew && <button className="btn" onClick={onNew}><Ico svg={I.plus} />New note</button>}</>}>
      <p>Linked notes about everything in this project: epics, issues with their acceptance criteria and status, decisions, open questions, releases, documents, the app context and the repository profile. TicketForge keeps them up to date as the project changes.</p>
      <p>AI actions and code agents read the notes linked to their task before they start{list.useInAi ? '' : ' (switched off for this project in Brain settings)'}. Add your own notes for what isn’t written anywhere else, link them with <code>[[PRJ-12]]</code>, and TicketForge never overwrites them.</p>
    </EmptyState>
    {recent.length > 0 && <><h3 className="brain-h">The team’s latest notes</h3><div className="brain-links-list">{recent.map((n) => <button key={n.id} className="brain-link-item" onClick={() => onOpen(n.id)}><span className={`bn-dot t-${n.type}`} />{n.title}<span className="muted small"> · {ago(n.updatedAt)}{n.updatedBy ? ` by ${n.updatedBy}` : ''}</span></button>)}</div></>}
  </div>;
}

function LinkList({ title, items, onOpen, empty }: { title: string; items: Any[]; onOpen: (id: string) => void; empty: string }) {
  return <div className="brain-links">
    <h3 className="brain-h">{title} <span className="count">{items.length}</span></h3>
    {items.length ? <div className="brain-links-list">{items.map((x) => <button key={x.id} className="brain-link-item" onClick={() => onOpen(x.id)} title={x.id}>
      <span className={`bn-dot t-${x.type}`} aria-hidden="true" /><span className="brain-link-text">{x.key && (x.type === 'issue' || x.type === 'epic') ? <b>{x.key} </b> : null}{x.title}</span><span className="muted small">{TYPE_LABEL[x.type] || x.type}</span></button>)}</div>
      : <p className="muted small" style={{ margin: 0 }}>{empty}</p>}
  </div>;
}

function NoteView({ note, list, resolve, byId, back: _back, onOpen, onBack, onEdit, onDelete, onCreate }: Any) {
  const mine = note.kind === 'user';
  const issue = note.kind === 'auto' && note.type === 'issue' ? ticketOf(note.ref) : null;
  const ep = note.kind === 'auto' && note.type === 'epic' ? epicOf(note.ref) : null;
  const wikilink = (target: string, label: string, key: string): ReactNode => {
    const id = resolve(target);
    const n = id && byId.get(id);
    if (n) return <button key={key} type="button" className={`wikilink t-${n.type}`} onClick={() => onOpen(id)} title={`${TYPE_LABEL[n.type] || n.type}: ${n.title}`}>{label}</button>;
    return <button key={key} type="button" className="wikilink missing" disabled={!list.can.write} onClick={() => onCreate(target, `# ${target}\n\n`)} title={list.can.write ? `No note called “${target}” yet. Click to create it.` : `No note called “${target}” yet`}>{label}</button>;
  };
  return <article className="brain-note">
    <button className="btn sm subtle brain-back" onClick={onBack}><Ico svg={I.chevron} />Notes</button>
    <div className="brain-note-head">
      <div className="brain-chips">
        <span className={`bn-chip t-${note.type}`}><span className={`bn-dot t-${note.type}`} aria-hidden="true" />{TYPE_LABEL[note.type] || note.type}</span>
        {note.status && <span className="loz">{note.status}</span>}
        {(note.tags || []).filter((t: string) => t !== note.type).slice(0, 8).map((t: string) => <span key={t} className="label-chip">#{t}</span>)}
      </div>
      <div className="brain-note-acts">
        {issue && <button className="btn sm" onClick={() => openDrawer('issue', issue.id)}><Ico svg={I.expand} />Open {issue.key}</button>}
        {ep && <button className="btn sm" onClick={() => openDrawer('epic', ep.id)}><Ico svg={I.expand} />Open epic</button>}
        {(issue || ep) && <button className="btn sm ai" onClick={() => openModal(<AiPreview issueId={issue?.id} epicId={ep?.id} title={note.title} onOpen={onOpen} />)} title="The notes AI actions and code agents get for this"><Ico svg={I.sparkle} />What the AI reads</button>}
        {mine && list.can.write && <><button className="btn sm" onClick={onEdit}><Ico svg={I.pencil} />Edit</button>
          <button className="icon-btn" onClick={onDelete} aria-label="Delete note" title="Delete"><Ico svg={I.trash} /></button></>}
      </div>
    </div>
    <p className="muted small brain-note-meta">{mine ? `Team note${note.updatedBy ? ` by ${note.updatedBy}` : ''}` : 'Written by TicketForge from the project (read-only: refreshes replace it)'} · updated {ago(note.updatedAt)} · <code>{note.id}.md</code></p>
    {!/^#\s/.test(String(note.body).trim()) && <h2 className="brain-note-title">{note.title}</h2>}
    <div className="md-doc brain-md"><MarkdownDoc text={note.body} baseLevel={2} wikilink={wikilink} /></div>
    {!mine && list.can.write && <p className="muted small" style={{ marginTop: 16 }}>Something to add? <button className="link-btn" onClick={() => onCreate(`About ${base(note.id)}`, `Notes on [[${base(note.id)}]]\n\n`)}>Write a note that links here</button>.</p>}
    {note.unresolved?.length > 0 && <p className="muted small">Links without a note yet: {note.unresolved.slice(0, 12).map((t: string) => <code key={t} style={{ marginRight: 6 }}>[[{t}]]</code>)}</p>}
    <div className="brain-link-cols">
      <LinkList title="Links to" items={note.out} onOpen={onOpen} empty="This note doesn’t link to other notes." />
      <LinkList title="Linked from" items={note.back} onOpen={onOpen} empty="No other note links here yet." />
    </div>
  </article>;
}

/** Create or edit one of the team's own notes. Typing [[ suggests notes to link. */
function NoteEditor({ draft, notes, onCancel, onSaved }: { draft: Any; notes: Note[]; onCancel: () => void; onSaved: (n: Any) => void }) {
  const [d, setD] = useState<Any>(draft);
  const [busy, setBusy] = useState(false);
  const [sug, setSug] = useState<{ q: string; at: number } | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const set = (k: string, v: Any) => setD((x: Any) => ({ ...x, [k]: v }));
  const onBody = (e: Any) => {
    set('body', e.target.value);
    const pos = e.target.selectionStart ?? e.target.value.length;
    const before = e.target.value.slice(0, pos);
    const m = before.match(/\[\[([^\]\n|]{0,60})$/);
    setSug(m ? { q: m[1], at: pos - m[1].length } : null);
  };
  // Best first: key or file name starting with what's typed, then title, then anywhere; issues and epics before the rest.
  const matches = !sug ? [] : notes.map((n) => {
    const x = lc(sug.q), key = lc(n.key), name = lc(base(n.id)), title = lc(n.title);
    const r = !x ? 3 : key === x || name === x ? 0 : key.startsWith(x) || name.startsWith(x) ? 1 : title.startsWith(x) ? 2 : `${key} ${title} ${name}`.includes(x) ? 3 : 9;
    return { n, r: r * 20 + Math.max(0, ['issue', 'epic', 'note', 'decision', 'question'].indexOf(n.type) + 1 || 10) };
  }).filter((x) => x.r < 180).sort((a, b) => a.r - b.r || a.n.id.localeCompare(b.n.id, undefined, { numeric: true })).slice(0, 8).map((x) => x.n);
  const insert = (n: Note) => {
    if (!sug) return;
    const name = base(n.id);
    const end = d.body.slice(sug.at).match(/^[^\]\n]*\]\]/)?.[0].length || sug.q.length;
    const body = `${d.body.slice(0, sug.at)}${name}]]${d.body.slice(sug.at + end)}`;
    set('body', body);
    setSug(null);
    setTimeout(() => { const el = ref.current; if (el) { const at = sug.at + name.length + 2; el.focus(); el.setSelectionRange(at, at); } }, 0);
  };
  const save = async () => {
    setBusy(true);
    try { onSaved(await api(`/api/projects/${P().id}/brain`, { method: 'POST', body: { action: 'save', note: { ...d, tags: String(d.tags || '').split(/[,\s]+/).filter(Boolean) } } })); toast(d.id ? 'Note saved' : 'Note added to the brain'); }
    catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return <div className="brain-note brain-editor">
    <h2 className="brain-note-title" style={{ marginTop: 0 }}>{d.id ? 'Edit note' : 'New note'}</h2>
    <div className="brain-edit-grid">
      <label className="brain-field"><span className="small muted">Title</span><TF size="small" value={d.title} onChange={(e: Any) => set('title', e.target.value)} placeholder="For example: Payment retries" autoFocus={!d.id} /></label>
      <label className="brain-field"><span className="small muted">Type</span><SF size="small" value={USER_TYPES.includes(d.type) ? d.type : 'note'} onChange={(e: Any) => set('type', e.target.value)}>{USER_TYPES.map((t) => <MenuItem key={t} value={t}>{TYPE_LABEL[t]}</MenuItem>)}</SF></label>
      <label className="brain-field"><span className="small muted">Tags</span><TF size="small" value={d.tags} onChange={(e: Any) => set('tags', e.target.value)} placeholder="payments, risk" /></label>
      <label className="brain-field"><span className="small muted">Status</span><TF size="small" value={d.status} onChange={(e: Any) => set('status', e.target.value)} placeholder="Optional, e.g. Accepted" /></label>
    </div>
    <div className="brain-body-wrap">
      <TA mono rows={14} maxRows={40} value={d.body} inputRef={ref} onChange={onBody} onKeyDown={(e: Any) => { if (e.key === 'Escape') setSug(null); if (sug && matches.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); insert(matches[0]); } }}
        placeholder={'Markdown. Link to other notes with [[PRJ-12]] or [[Project Overview]].'} aria-label="Note text" />
      {sug && matches.length > 0 && <div className="brain-suggest" role="listbox" aria-label="Link to a note">
        {matches.map((n, i) => <button key={n.id} role="option" aria-selected={i === 0} onMouseDown={(e) => { e.preventDefault(); insert(n); }}><span className={`bn-dot t-${n.type}`} />{n.key && <b>{n.key}</b>}<span>{n.title}</span><span className="muted small">{TYPE_LABEL[n.type]}</span></button>)}
      </div>}
    </div>
    <p className="muted small">Type <code>[[</code> to link a note. AI actions about the notes you link read this note too.</p>
    <div className="row" style={{ gap: 8 }}>
      <button className="btn primary" disabled={busy || !String(d.title || '').trim()} onClick={save}>{busy ? <Spinner /> : null}{d.id ? 'Save' : 'Add note'}</button>
      <button className="btn subtle" onClick={onCancel}>Cancel</button>
    </div>
  </div>;
}

/** The PROJECT BRAIN block AI actions and code agents get for an issue or epic. */
function AiPreview({ issueId, epicId, title, onOpen }: { issueId?: string; epicId?: string; title: string; onOpen: (id: string) => void }) {
  const [r, setR] = useState<Any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api(`/api/projects/${P().id}/brain?context=1${issueId ? `&issue=${encodeURIComponent(issueId)}` : ''}${epicId ? `&epic=${encodeURIComponent(epicId)}` : ''}`).then(setR).catch((e) => setErr(e.message)); }, [issueId, epicId]);
  return <Modal title={`What the AI reads for ${title}`} wide actions={[{ label: 'Close', kind: 'primary' }]}>
    {err ? <p className="danger-text">{err}</p> : !r ? <p className="muted"><Spinner /> Choosing the notes…</p> : !r.block ? <p className="muted">No linked notes yet.</p> : <>
      <p className="muted small" style={{ marginTop: 0 }}>Added to the prompt of AI actions and code agents about this {issueId ? 'issue' : 'epic'}: the note itself, notes it links to and that link to it (one and two links away), and the notes whose words match best. {r.block.length.toLocaleString()} characters.</p>
      <div className="brain-links-list" style={{ marginBottom: 12 }}>{r.notes.map((n: Any) => <button key={n.id} className="brain-link-item" onClick={() => { closeModal(); onOpen(n.id); }}><span className={`bn-dot t-${n.type}`} /><span className="brain-link-text">{n.title}</span><span className="muted small">{n.why}</span></button>)}</div>
      <pre className="brain-pre">{r.block}</pre>
    </>}
  </Modal>;
}

function BrainSettings({ list, reload }: { list: List | null; reload: () => Promise<Any> }) {
  useStore();
  const [useInAi, setUseInAi] = useState(list?.useInAi !== false);
  const [dir, setDir] = useState(list?.sync?.dir || '');
  const [busy, setBusy] = useState('');
  const [last, setLast] = useState<Any>(list?.sync?.last || null);
  const can = list?.can;
  const pid = P().id;
  const saveAi = async (v: boolean) => { setUseInAi(v); try { await api(`/api/projects/${pid}/brain`, { method: 'POST', body: { action: 'settings', useInAi: v } }); await reload(); toast(v ? 'AI actions read the brain again.' : 'AI actions no longer read the brain for this project.'); } catch (e: Any) { setUseInAi(!v); toast(e.message, 'err'); } };
  const sync = async () => {
    setBusy('sync');
    try { const r = await api(`/api/projects/${pid}/brain`, { method: 'POST', body: { action: 'sync', dir } }); setLast(r); await reload(); toast(`${r.wroteAuto} written from the project, ${r.toFolder} of your notes to the folder, ${r.fromFolder + r.newNotes} from the folder${r.conflicts.length ? `; ${r.conflicts.length} changed on both sides (the newer one kept)` : ''}.`, 'ok', { title: 'Synced' }); }
    catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const stop = async () => { try { await api(`/api/projects/${pid}/brain`, { method: 'POST', body: { action: 'syncFolder', dir: '' } }); setDir(''); setLast(null); await reload(); toast('Folder sync turned off. The folder keeps its files.'); } catch (e: Any) { toast(e.message, 'err'); } };
  return <Modal title="Brain settings" actions={[{ label: 'Done', kind: 'primary' }]}>
    <label className="row brain-toggle" style={{ gap: 10, alignItems: 'flex-start' }}>
      <input type="checkbox" checked={useInAi} disabled={!can?.settings} onChange={(e) => saveAi(e.target.checked)} style={{ marginTop: 3 }} />
      <span><b>AI reads the brain</b><br /><span className="muted small">Writing tickets and test cases, documents, splits, plans and code jobs start from the notes linked to their issue or epic (up to about 9,000 characters).{!can?.settings ? ' Changing this needs the Project settings permission.' : ''}</span></span>
    </label>
    <hr className="sep" />
    <h3 className="brain-h" style={{ marginTop: 0 }}>Sync with a folder</h3>
    {!list?.local ? <p className="muted small">When TicketForge runs on your computer (opened at localhost), it can keep a folder, such as one inside your Obsidian vault, in step with the brain. Here, use Download for Obsidian and Import instead.</p> : <>
      <p className="muted small" style={{ marginTop: 0 }}>Writes every note to the folder. Your own notes go both ways: edit them in Obsidian or here, and each sync copies the newer version across. New files in the folder become notes. Notes TicketForge writes are refreshed in the folder each time.</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <TF size="small" sx={{ flex: '1 1 260px' }} value={dir} onChange={(e: Any) => setDir(e.target.value)} placeholder="/Users/you/Obsidian/My vault/Project brain" aria-label="Folder" disabled={!can?.settings} />
        <button className="btn" disabled={!can?.settings} onClick={() => openModal(<FolderPicker start={dir} title="Choose the folder to sync" hint="Open the folder for this project’s notes (it can be inside your Obsidian vault), then choose it." onPick={(x) => { setDir(x); openModal(<BrainSettings list={{ ...(list as List), sync: { ...(list?.sync || {}), dir: x } }} reload={reload} />); }} />)}><Ico svg={I.folder} />Browse…</button>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="btn primary" disabled={!can?.settings || !dir.trim() || busy === 'sync'} onClick={sync}>{busy === 'sync' ? <Spinner /> : <Ico svg={I.refresh} />}Sync now</button>
        {list?.sync?.dir && <button className="btn subtle" disabled={!can?.settings} onClick={stop}>Stop syncing</button>}
      </div>
      {last && <p className="muted small">Last sync{list?.sync?.at ? ` ${ago(list.sync.at)}` : ''}: {last.wroteAuto} generated notes written, {last.toFolder} of yours to the folder, {(last.fromFolder || 0) + (last.newNotes || 0)} from it{last.deletedNotes ? `, ${last.deletedNotes} deleted here` : ''}{last.deletedFiles ? `, ${last.deletedFiles} files deleted` : ''}.</p>}
    </>}
  </Modal>;
}

// ---------------------------------------------------------------- graph
/** Colours per note type, read from the page's CSS variables (so they follow light and dark mode). */
function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  const out: Record<string, string> = {};
  for (const t of TYPE_ORDER) out[t] = v(`--bn-${t}`, '#8590a2');
  return { ...out, edge: v('--bn-edge', 'rgba(130,140,160,.35)'), edgeHi: v('--brand', '#0c66e4'), text: v('--text', '#172b4d'), bg: v('--bg', '#fff'), muted: v('--text-subtlest', '#626f86') };
}
type GNode = { id: string; type: string; title: string; key: string; x: number; y: number; vx: number; vy: number; deg: number; fixed?: boolean };

function BrainGraph({ notes, all, selected, onSelect, filters }: { notes: Note[]; all: Note[]; selected: string; onSelect: (id: string) => void; filters: ReactNode }) {
  const [local, setLocal] = useState(Boolean(selected));
  const [hover, setHover] = useState<GNode | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const sim = useRef<Any>(null);
  // The nodes shown: the filtered notes, or (around a note) it and the notes up to two links away.
  const graph = useMemo(() => {
    // The Index links to everything, so it's left out (it would pull every note into one knot) unless it's open.
    let ids = new Set(notes.filter((n) => n.type !== 'index' || n.id === selected).map((n) => n.id));
    const allById = new Map(all.map((n) => [n.id, n]));
    if (local && selected && allById.has(selected)) {
      const near = new Map<string, Set<string>>();
      for (const n of all) for (const o of n.out) { if (!near.has(n.id)) near.set(n.id, new Set()); if (!near.has(o)) near.set(o, new Set()); near.get(n.id)!.add(o); near.get(o)!.add(n.id); }
      const keep = new Set([selected]);
      let frontier = [selected];
      for (let d = 0; d < 2; d++) { const next: string[] = []; for (const id of frontier) for (const x of near.get(id) || []) if (!keep.has(x) && ids.has(x)) { keep.add(x); next.push(x); } frontier = next; if (keep.size > 250) break; }
      ids = keep;
    }
    const edges: [string, string][] = [];
    const seen = new Set<string>();
    for (const n of all) if (ids.has(n.id)) for (const o of n.out) if (ids.has(o)) { const k = n.id < o ? `${n.id}\u0000${o}` : `${o}\u0000${n.id}`; if (!seen.has(k)) { seen.add(k); edges.push([n.id, o]); } }
    return { nodes: [...ids].map((id) => allById.get(id)!).filter(Boolean), edges };
  }, [notes, all, local, selected]);

  useEffect(() => {
    const cv = canvas.current, box = wrap.current;
    if (!cv || !box) return undefined;
    const prev: Map<string, GNode> = sim.current?.byId || new Map();
    const R = Math.sqrt(graph.nodes.length) * 34 + 60;
    const nodes: GNode[] = graph.nodes.map((n, i) => {
      const o = prev.get(n.id);
      const a = i * 2.399963, r = R * Math.sqrt((i + 0.5) / Math.max(1, graph.nodes.length));
      return { id: n.id, type: n.type, title: n.title, key: n.key, x: o?.x ?? Math.cos(a) * r, y: o?.y ?? Math.sin(a) * r, vx: 0, vy: 0, deg: 0 };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = graph.edges.map(([a, b]) => [byId.get(a)!, byId.get(b)!]).filter(([a, b]) => a && b) as [GNode, GNode][];
    for (const [a, b] of edges) { a.deg++; b.deg++; }
    // Only the selection changed (same notes): keep the layout and view; new notes: lay out again and fit.
    const settled = prev.size > 0 && nodes.every((n) => prev.has(n.id));
    const s: Any = sim.current = { nodes, byId, edges, view: sim.current?.view || { x: 0, y: 0, k: 1 }, alpha: settled ? 0.03 : prev.size ? 0.6 : 1, raf: 0, colors: palette(), drag: null, fitted: settled };
    const radius = (n: GNode) => 3.5 + Math.min(9, Math.sqrt(n.deg) * 1.6) + (n.type === 'index' || n.type === 'project' ? 3 : 0);
    const size = () => { const w = box.clientWidth, h = box.clientHeight, dpr = window.devicePixelRatio || 1; cv.width = w * dpr; cv.height = h * dpr; cv.style.width = `${w}px`; cv.style.height = `${h}px`; s.w = w; s.h = h; s.dpr = dpr; };
    size();
    const fit = () => {
      if (!nodes.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
      const k = Math.min(2.2, Math.max(0.15, Math.min(s.w / (x1 - x0 + 120), s.h / (y1 - y0 + 120))));
      s.view = { k, x: s.w / 2 - ((x0 + x1) / 2) * k, y: s.h / 2 - ((y0 + y1) / 2) * k };
    };
    s.fit = () => { fit(); draw(); };
    if (!settled) s.view = { x: s.w / 2, y: s.h / 2, k: nodes.length > 200 ? 0.5 : 1 };
    const step = () => {
      // Repulsion between nearby nodes (grid buckets: fast for hundreds of notes), springs along links, a pull to the middle.
      const CELL = 150, grid = new Map<string, GNode[]>();
      for (const n of nodes) { const k = `${Math.floor(n.x / CELL)},${Math.floor(n.y / CELL)}`; (grid.get(k) || grid.set(k, []).get(k)!).push(n); }
      for (const n of nodes) {
        const cx = Math.floor(n.x / CELL), cy = Math.floor(n.y / CELL);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const m of grid.get(`${cx + dx},${cy + dy}`) || []) {
          if (m === n) continue;
          let ddx = n.x - m.x, ddy = n.y - m.y; let d2 = ddx * ddx + ddy * ddy;
          if (d2 < 0.01) { ddx = Math.random() - 0.5; ddy = Math.random() - 0.5; d2 = 0.5; }
          if (d2 > CELL * CELL) continue;
          const f = (2600 / d2) * s.alpha; n.vx += ddx * f * 0.06; n.vy += ddy * f * 0.06;
        }
      }
      for (const [a, b] of edges) {
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = ((d - 85) / d) * 0.035 * s.alpha;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      for (const n of nodes) {
        n.vx -= n.x * 0.0015 * s.alpha; n.vy -= n.y * 0.0015 * s.alpha;
        if (n === s.drag?.node) { n.vx = 0; n.vy = 0; continue; }
        n.vx *= 0.82; n.vy *= 0.82;
        n.x += Math.max(-20, Math.min(20, n.vx)); n.y += Math.max(-20, Math.min(20, n.vy));
      }
      s.alpha *= 0.985;
    };
    const draw = () => {
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const c = s.colors, v = s.view;
      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      ctx.clearRect(0, 0, s.w, s.h);
      ctx.translate(v.x, v.y); ctx.scale(v.k, v.k);
      const focus = s.hover || byId.get(selected) || null;
      const near = new Set<GNode>();
      if (focus) { near.add(focus); for (const [a, b] of edges) { if (a === focus) near.add(b); if (b === focus) near.add(a); } }
      ctx.lineWidth = 1 / v.k;
      ctx.strokeStyle = c.edge;
      ctx.beginPath();
      for (const [a, b] of edges) if (!(focus && (a === focus || b === focus))) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
      if (focus) { ctx.strokeStyle = c.edgeHi; ctx.lineWidth = 1.6 / v.k; ctx.beginPath(); for (const [a, b] of edges) if (a === focus || b === focus) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } ctx.stroke(); }
      for (const n of nodes) {
        const r = radius(n);
        ctx.globalAlpha = focus && !near.has(n) ? 0.35 : 1;
        ctx.fillStyle = c[n.type] || c.note;
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
        if (n.id === selected) { ctx.strokeStyle = c.text; ctx.lineWidth = 2 / v.k; ctx.beginPath(); ctx.arc(n.x, n.y, r + 3 / v.k, 0, Math.PI * 2); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
      // Labels: when zoomed in, for big nodes, and for the focused note and its neighbours.
      ctx.font = `${12 / v.k}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const n of nodes) {
        const show = near.has(n) || v.k > 1.3 || (v.k > 0.7 && n.deg > 6) || n.type === 'index' || n.type === 'project';
        if (!show) continue;
        const label = n.key && (n.type === 'issue' || n.type === 'epic') ? (near.has(n) || v.k > 1.8 ? `${n.key} ${n.title}` : n.key) : n.title;
        const t = label.length > 42 ? `${label.slice(0, 40)}…` : label;
        const y = n.y + radius(n) + 3 / v.k;
        ctx.lineWidth = 3 / v.k; ctx.strokeStyle = c.bg; ctx.strokeText(t, n.x, y);
        ctx.fillStyle = near.has(n) ? c.text : c.muted; ctx.fillText(t, n.x, y);
      }
    };
    const loop = () => {
      if (s.alpha > 0.02 || s.drag) { step(); if (!s.fitted && !s.moved && s.alpha < 0.3) { fit(); s.fitted = true; } }
      const more = s.alpha > 0.02 || s.drag;
      if (!more && !s.moved && !s.settledFit && !settled) { fit(); s.settledFit = true; } // once more when the layout has settled
      draw();
      s.raf = more ? requestAnimationFrame(loop) : 0;
    };
    s.kick = (a = 0.4) => { s.alpha = Math.max(s.alpha, a); if (!s.raf) s.raf = requestAnimationFrame(loop); };
    s.draw = draw;
    s.raf = requestAnimationFrame(loop);
    // Pointer: drag a note, drag the background to pan, wheel or the buttons to zoom; click opens a note.
    const toWorld = (e: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left - s.view.x) / s.view.k, y: (e.clientY - r.top - s.view.y) / s.view.k, sx: e.clientX - r.left, sy: e.clientY - r.top }; };
    const hit = (w: { x: number; y: number }) => { let best: GNode | null = null, bd = Infinity; for (const n of nodes) { const d = (n.x - w.x) ** 2 + (n.y - w.y) ** 2, r = radius(n) + 5 / s.view.k; if (d < r * r && d < bd) { bd = d; best = n; } } return best; };
    const down = (e: PointerEvent) => { const w = toWorld(e); const n = hit(w); cv.setPointerCapture(e.pointerId); s.drag = { node: n, sx: w.sx, sy: w.sy, vx: s.view.x, vy: s.view.y, moved: false }; if (n) s.kick(0.3); };
    const move = (e: PointerEvent) => {
      const w = toWorld(e);
      if (s.drag) {
        if (Math.abs(w.sx - s.drag.sx) + Math.abs(w.sy - s.drag.sy) > 4) s.drag.moved = true;
        if (s.drag.node) { s.drag.node.x = w.x; s.drag.node.y = w.y; s.kick(0.15); } else if (s.drag.moved) { s.moved = true; s.view.x = s.drag.vx + (w.sx - s.drag.sx); s.view.y = s.drag.vy + (w.sy - s.drag.sy); draw(); }
        return;
      }
      const n = hit(w);
      if (n !== s.hover) { s.hover = n; setHover(n); cv.style.cursor = n ? 'pointer' : 'grab'; draw(); }
    };
    const up = (e: PointerEvent) => { const d = s.drag; s.drag = null; try { cv.releasePointerCapture(e.pointerId); } catch { /* released */ } if (d && !d.moved && d.node) onSelect(d.node.id); };
    const wheel = (e: WheelEvent) => { e.preventDefault(); s.moved = true; const w = toWorld(e); const k = Math.min(4, Math.max(0.08, s.view.k * Math.exp(-e.deltaY * 0.0015))); s.view = { k, x: w.sx - w.x * k, y: w.sy - w.y * k }; draw(); };
    const leave = () => { if (s.hover) { s.hover = null; setHover(null); draw(); } };
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('wheel', wheel, { passive: false }); cv.addEventListener('pointerleave', leave);
    const ro = new ResizeObserver(() => { size(); draw(); });
    ro.observe(box);
    const mo = new MutationObserver(() => { s.colors = palette(); draw(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onScheme = () => { s.colors = palette(); draw(); };
    mq?.addEventListener?.('change', onScheme);
    return () => {
      cancelAnimationFrame(s.raf); s.raf = 0; ro.disconnect(); mo.disconnect(); mq?.removeEventListener?.('change', onScheme);
      cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); cv.removeEventListener('wheel', wheel); cv.removeEventListener('pointerleave', leave);
    };
  }, [graph, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = (f: number) => { const s = sim.current; if (!s) return; s.moved = true; const k = Math.min(4, Math.max(0.08, s.view.k * f)); const cx = s.w / 2, cy = s.h / 2; s.view = { k, x: cx - ((cx - s.view.x) / s.view.k) * k, y: cy - ((cy - s.view.y) / s.view.k) * k }; s.draw(); };
  const types = TYPE_ORDER.filter((t) => graph.nodes.some((n) => n.type === t));
  return <div className="brain-graph-wrap">
    <div className="brain-graph-bar">{filters}
      <div className="brain-graph-tools">
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={local} disabled={!selected} onChange={(e) => setLocal(e.target.checked)} />Around the open note</label>
        <span className="muted small">{graph.nodes.length} notes · {graph.edges.length} links</span>
      </div>
    </div>
    <div className="brain-graph" ref={wrap}>
      <canvas ref={canvas} role="img" aria-label={`Graph of ${graph.nodes.length} notes and ${graph.edges.length} links. Use the Notes view to browse them as a list.`} />
      {hover && <div className="brain-graph-tip"><b>{hover.key && (hover.type === 'issue' || hover.type === 'epic') ? `${hover.key} ` : ''}{hover.title}</b><span className="muted small">{TYPE_LABEL[hover.type]} · {hover.deg} link{hover.deg === 1 ? '' : 's'}</span></div>}
      <div className="brain-zoom">
        <button className="icon-btn" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1.3)}><Ico svg={I.plus} /></button>
        <button className="icon-btn" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(1 / 1.3)}><span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>−</span></button>
        <button className="icon-btn" aria-label="Fit to screen" title="Fit" onClick={() => sim.current?.fit()}><Ico svg={I.expand} /></button>
      </div>
      {!graph.nodes.length && <div className="brain-graph-empty muted">No notes match the filters.</div>}
    </div>
    <div className="brain-legend" aria-label="Colours">{types.map((t) => <span key={t}><span className={`bn-dot t-${t}`} />{TYPE_LABEL[t]}</span>)}</div>
  </div>;
}
