'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useStore, P, type Any, api, toast, downloadFrom, openModal, setMenu, ago } from '../core';
import { Confirm, ErrorState, Ico, I, Spinner, Menu } from '../ui';
import { Header } from '../views';
import {
  type List,
  readUrlNote,
  writeUrlNote,
  makeResolver,
  TYPE_LABEL,
  lc,
  TYPE_ORDER,
} from './make-resolver';
import { BrainSettings } from './BrainSettings';
import { BrainGraph } from './BrainGraph';
import { Filters, BrainHome } from './BrainHome';
import { NoteEditor } from './NoteEditor';
import { NoteView } from './NoteView';

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
  const setSel = (id: string) => {
    setSelRaw(id);
    writeUrlNote(id);
    if (id) setMode((m) => (m === 'graph' && window.innerWidth < 760 ? 'notes' : m));
  };

  const load = async () => {
    try {
      const l = await api(`/api/projects/${p.id}/brain`);
      setList(l);
      setErr(null);
      return l;
    } catch (e: Any) {
      setErr(e);
      return null;
    }
  };
  // The brain follows the project: reload (the server refreshes the generated notes) when the
  // project changes.
  useEffect(() => {
    const t = setTimeout(load, list ? 800 : 0);
    return () => clearTimeout(t);
  }, [p.id, p.version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sel) {
      setNote(null);
      return;
    }
    let live = true;
    setNoteErr('');
    api(`/api/projects/${p.id}/brain?note=${encodeURIComponent(sel)}`)
      .then((n) => {
        if (!live) return;
        if (n) setNote(n);
        else {
          setNote(null);
          setNoteErr('That note couldn’t be opened.');
        }
      })
      .catch((e) => {
        if (live) {
          setNote(null);
          setNoteErr(e.message);
        }
      });
    return () => {
      live = false;
    };
  }, [sel, list?.rev, p.id]);
  // Full-text search on the server (bodies aren't in the list); titles, keys and tags match at once
  // here.
  useEffect(() => {
    if (q.trim().length < 3) {
      setFound(null);
      return;
    }
    const t = setTimeout(() => {
      api(`/api/projects/${p.id}/brain?search=${encodeURIComponent(q.trim())}`)
        .then((r) => setFound(r.ids))
        .catch(() => setFound(null));
    }, 250);
    return () => clearTimeout(t);
  }, [q, p.id, list?.rev]);

  const notes = useMemo(() => list?.notes || [], [list]);
  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const resolve = useMemo(() => makeResolver(notes), [notes]);
  const back = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const n of notes) for (const id of n.out) m.set(id, [...(m.get(id) || []), n.id]);
    return m;
  }, [notes]);
  const tags = useMemo(
    () => [...new Set(notes.flatMap((n) => n.tags))].filter((t) => !TYPE_LABEL[t]).sort(),
    [notes],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of notes) c[n.type] = (c[n.type] || 0) + 1;
    return c;
  }, [notes]);
  const shown = useMemo(() => {
    const words = lc(q).split(/\s+/).filter(Boolean);
    const hit = new Set(found || []);
    const rank = new Map((found || []).map((id, i) => [id, i]));
    const out = notes.filter(
      (n) =>
        (!type || n.type === type) &&
        (!tag || n.tags.includes(tag)) &&
        (!words.length ||
          hit.has(n.id) ||
          words.every((w) =>
            lc(`${n.key} ${n.title} ${n.tags.join(' ')} ${n.excerpt}`).includes(w),
          )),
    );
    return out.sort(
      (a, b) =>
        (words.length ? (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999) : 0) ||
        TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
        a.id.localeCompare(b.id, undefined, { numeric: true }),
    );
  }, [notes, q, type, tag, found]);
  const can = list?.can || { write: false, export: false, settings: false };

  const refresh = async () => {
    setBusy('refresh');
    try {
      const r = await api(`/api/projects/${p.id}/brain`, {
        method: 'POST',
        body: { action: 'refresh' },
      });
      setList((l) => ({ ...(l as List), ...r }));
      toast(
        r.written || r.removed
          ? `${r.written} note${r.written === 1 ? '' : 's'} updated${r.removed ? `, ${r.removed} removed` : ''}. ${r.total} notes from the project.`
          : `Up to date: ${r.total} notes from the project.`,
        'ok',
        { title: 'Obsidian notes refreshed' },
      );
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const download = async () => {
    try {
      await downloadFrom(`/api/projects/${p.id}/brain?export=zip`, {
        method: 'GET',
        fallbackName: `${p.name} brain.zip`,
      });
      toast('Unzip it, then in Obsidian choose Open folder as vault.', 'ok', {
        title: 'Vault downloaded',
      });
    } catch (e: Any) {
      toast(e.message, 'err');
    }
  };
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append('file', f, f.name);
    setBusy('import');
    try {
      const r = await api(`/api/projects/${p.id}/brain`, { method: 'POST', body: fd });
      await load();
      toast(
        `${r.added} added, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped (notes TicketForge writes itself, or duplicates)` : ''}.`,
        'ok',
        { title: 'Notes imported' },
      );
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const startNew = (title = '', body = '') => {
    setEdit({ title, body, type: 'note', tags: '', status: '' });
    setMode('notes');
  };
  const saved = async (n: Any) => {
    setEdit(null);
    await load();
    setSel(n.id);
    setNote(n);
  };
  const del = (n: Any) =>
    openModal(
      <Confirm
        title={`Delete “${n.title}”?`}
        label="Delete"
        text="It’s removed from Obsidian for everyone. Links to it stay as plain text."
        onYes={async () => {
          try {
            await api(`/api/projects/${p.id}/brain`, {
              method: 'POST',
              body: { action: 'delete', id: n.id },
            });
            setSel('');
            await load();
            toast('Note deleted');
          } catch (e: Any) {
            toast(e.message, 'err');
          }
        }}
      />,
    );

  if (err && !list)
    return (
      <>
        <Header title="Obsidian" />
        <ErrorState error={err} onRetry={load} />
      </>
    );
  const right = (
    <>
      <div className="seg brain-seg" role="tablist" aria-label="View">
        <button
          role="tab"
          aria-selected={mode === 'notes'}
          className={mode === 'notes' ? 'on' : ''}
          onClick={() => setMode('notes')}
        >
          Notes
        </button>
        <button
          role="tab"
          aria-selected={mode === 'graph'}
          className={mode === 'graph' ? 'on' : ''}
          onClick={() => setMode('graph')}
        >
          Graph
        </button>
      </div>
      {can.write && (
        <button className="btn" onClick={() => startNew()}>
          <Ico svg={I.plus} />
          New note
        </button>
      )}
      <button
        className="btn"
        disabled={busy === 'refresh'}
        onClick={refresh}
        title="Rebuild the notes TicketForge writes from the project (your own notes stay as they are)"
      >
        {busy === 'refresh' ? <Spinner /> : <Ico svg={I.refresh} />}Refresh notes
      </button>
      <Menu
        id="brain-more"
        button={
          <button
            className="icon-btn"
            aria-label="More Obsidian actions"
            title="More"
            onClick={() => setMenu('brain-more')}
          >
            <Ico svg={I.more} />
          </button>
        }
      >
        {can.export && (
          <button onClick={download}>
            <Ico svg={I.download} />
            Download for Obsidian (.zip)
          </button>
        )}
        {can.write && (
          <button onClick={() => fileRef.current?.click()}>
            <Ico svg={I.upload} />
            Import Obsidian notes…
          </button>
        )}
        <button onClick={() => openModal(<BrainSettings list={list} reload={load} />)}>
          <Ico svg={I.settings} />
          Obsidian settings{list?.local ? ' and folder sync' : ''}
        </button>
      </Menu>
      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        accept=".md,.markdown,.zip,text/markdown,application/zip"
        onChange={(e) => importFiles(e.target.files)}
      />
    </>
  );
  const sub = list ? (
    <span className="muted small brain-sub">
      {notes.length} notes · {notes.filter((n) => n.kind === 'user').length} by the team
      {list.builtAt ? ` · refreshed ${ago(list.builtAt)}` : ''}
      {list.useInAi ? '' : ' · not used by AI'}
    </span>
  ) : null;

  return (
    <>
      <Header title="Obsidian" sub={sub} right={<div className="brain-actions">{right}</div>} />
      {!list ? (
        <div className="brain">
          <div className="brain-list">
            <div className="muted small" style={{ padding: 14 }}>
              <Spinner /> Building the notes…
            </div>
          </div>
          <div className="brain-main" />
        </div>
      ) : mode === 'graph' ? (
        <BrainGraph
          notes={shown}
          all={notes}
          selected={sel}
          onSelect={(id) => {
            setSel(id);
            setMode('notes');
          }}
          filters={<Filters {...{ q, setQ, type, setType, tag, setTag, tags, counts }} />}
        />
      ) : (
        <div className={`brain ${sel || edit ? 'has-note' : ''}`}>
          <aside className="brain-list" aria-label="Notes">
            <Filters {...{ q, setQ, type, setType, tag, setTag, tags, counts }} />
            <div className="brain-count muted small">
              {shown.length === notes.length
                ? `${notes.length} notes`
                : `${shown.length} of ${notes.length} notes`}
            </div>
            <div className="brain-items" role="list">
              {shown.slice(0, 600).map((n) => (
                <button
                  key={n.id}
                  role="listitem"
                  className={`brain-item ${sel === n.id ? 'active' : ''}`}
                  onClick={() => {
                    setEdit(null);
                    setSel(n.id);
                  }}
                  aria-current={sel === n.id ? 'true' : undefined}
                >
                  <span className={`bn-dot t-${n.type}`} aria-hidden="true" />
                  <span className="brain-item-main">
                    <span className="brain-item-title">
                      {n.key && (n.type === 'issue' || n.type === 'epic') ? <b>{n.key} </b> : null}
                      {n.title}
                    </span>
                    <span className="brain-item-meta">
                      {TYPE_LABEL[n.type] || n.type}
                      {n.status ? ` · ${n.status}` : ''}
                      {n.kind === 'user' ? ' · team' : ''}
                    </span>
                  </span>
                </button>
              ))}
              {shown.length > 600 && (
                <p className="muted small" style={{ padding: '8px 12px' }}>
                  Showing 600 of {shown.length}. Search or filter to narrow the list.
                </p>
              )}
              {!shown.length && (
                <p className="muted small" style={{ padding: '8px 12px' }}>
                  No notes match.
                </p>
              )}
            </div>
          </aside>
          <section className="brain-main" aria-label="Note">
            {edit ? (
              <NoteEditor
                draft={edit}
                notes={notes}
                onCancel={() => setEdit(null)}
                onSaved={saved}
              />
            ) : sel && note ? (
              <NoteView
                note={note}
                list={list}
                resolve={resolve}
                byId={byId}
                back={back}
                onOpen={setSel}
                onBack={() => setSel('')}
                onEdit={() =>
                  setEdit({
                    id: note.id,
                    title: note.title,
                    body: note.body,
                    type: note.type,
                    tags: (note.tags || []).filter((t: string) => t !== note.type).join(', '),
                    status: note.status,
                    baseUpdatedAt: note.updatedAt,
                  })
                }
                onDelete={() => del(note)}
                onCreate={startNew}
              />
            ) : sel && noteErr ? (
              <div className="brain-note">
                <button className="btn sm subtle brain-back" onClick={() => setSel('')}>
                  <Ico svg={I.chevron} />
                  Notes
                </button>
                <ErrorState title="Couldn’t open this note" error={noteErr} compact />
              </div>
            ) : sel ? (
              <div className="brain-note muted">
                <Spinner /> Opening…
              </div>
            ) : (
              <BrainHome list={list} onOpen={setSel} onNew={can.write ? () => startNew() : null} />
            )}
          </section>
        </div>
      )}
    </>
  );
}
