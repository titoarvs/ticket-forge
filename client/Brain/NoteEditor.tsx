'use client';
import { useState, useRef, useEffect } from 'react';
import { type Any, api, P, toast, closeModal } from '../core';
import { Spinner, Modal } from '../ui';
import { TF, SF, MenuItem, TA } from '../fields';
import { type Note, lc, base, USER_TYPES, TYPE_LABEL } from './make-resolver';

/** Create or edit one of the team's own notes. Typing [[ suggests notes to link. */
export function NoteEditor({
  draft,
  notes,
  onCancel,
  onSaved,
}: {
  draft: Any;
  notes: Note[];
  onCancel: () => void;
  onSaved: (n: Any) => void;
}) {
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
  // Best first: key or file name starting with what's typed, then title, then anywhere; issues and
  // epics before the rest.
  const matches = !sug
    ? []
    : notes
        .map((n) => {
          const x = lc(sug.q),
            key = lc(n.key),
            name = lc(base(n.id)),
            title = lc(n.title);
          const r = !x
            ? 3
            : key === x || name === x
              ? 0
              : key.startsWith(x) || name.startsWith(x)
                ? 1
                : title.startsWith(x)
                  ? 2
                  : `${key} ${title} ${name}`.includes(x)
                    ? 3
                    : 9;
          return {
            n,
            r:
              r * 20 +
              Math.max(
                0,
                ['issue', 'epic', 'note', 'decision', 'question'].indexOf(n.type) + 1 || 10,
              ),
          };
        })
        .filter((x) => x.r < 180)
        .sort((a, b) => a.r - b.r || a.n.id.localeCompare(b.n.id, undefined, { numeric: true }))
        .slice(0, 8)
        .map((x) => x.n);
  const insert = (n: Note) => {
    if (!sug) return;
    const name = base(n.id);
    const end = d.body.slice(sug.at).match(/^[^\]\n]*\]\]/)?.[0].length || sug.q.length;
    const body = `${d.body.slice(0, sug.at)}${name}]]${d.body.slice(sug.at + end)}`;
    set('body', body);
    setSug(null);
    setTimeout(() => {
      const el = ref.current;
      if (el) {
        const at = sug.at + name.length + 2;
        el.focus();
        el.setSelectionRange(at, at);
      }
    }, 0);
  };
  const save = async () => {
    setBusy(true);
    try {
      onSaved(
        await api(`/api/projects/${P().id}/brain`, {
          method: 'POST',
          body: {
            action: 'save',
            note: {
              ...d,
              tags: String(d.tags || '')
                .split(/[,\s]+/)
                .filter(Boolean),
            },
          },
        }),
      );
      toast(d.id ? 'Note saved' : 'Note added to Obsidian');
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="brain-note brain-editor">
      <h2 className="brain-note-title" style={{ marginTop: 0 }}>
        {d.id ? 'Edit note' : 'New note'}
      </h2>
      <div className="brain-edit-grid">
        <label className="brain-field">
          <span className="small muted">Title</span>
          <TF
            size="small"
            value={d.title}
            onChange={(e: Any) => set('title', e.target.value)}
            placeholder="For example: Payment retries"
            autoFocus={!d.id}
          />
        </label>
        <label className="brain-field">
          <span className="small muted">Type</span>
          <SF
            size="small"
            value={USER_TYPES.includes(d.type) ? d.type : 'note'}
            onChange={(e: Any) => set('type', e.target.value)}
          >
            {USER_TYPES.map((t) => (
              <MenuItem key={t} value={t}>
                {TYPE_LABEL[t]}
              </MenuItem>
            ))}
          </SF>
        </label>
        <label className="brain-field">
          <span className="small muted">Tags</span>
          <TF
            size="small"
            value={d.tags}
            onChange={(e: Any) => set('tags', e.target.value)}
            placeholder="payments, risk"
          />
        </label>
        <label className="brain-field">
          <span className="small muted">Status</span>
          <TF
            size="small"
            value={d.status}
            onChange={(e: Any) => set('status', e.target.value)}
            placeholder="Optional, e.g. Accepted"
          />
        </label>
      </div>
      <div className="brain-body-wrap">
        <TA
          mono
          rows={14}
          maxRows={40}
          value={d.body}
          inputRef={ref}
          onChange={onBody}
          onKeyDown={(e: Any) => {
            if (e.key === 'Escape') setSug(null);
            if (sug && matches.length && (e.key === 'Enter' || e.key === 'Tab')) {
              e.preventDefault();
              insert(matches[0]);
            }
          }}
          placeholder={'Markdown. Link to other notes with [[PRJ-12]] or [[Project Overview]].'}
          aria-label="Note text"
        />
        {sug && matches.length > 0 && (
          <div className="brain-suggest" role="listbox" aria-label="Link to a note">
            {matches.map((n, i) => (
              <button
                key={n.id}
                role="option"
                aria-selected={i === 0}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insert(n);
                }}
              >
                <span className={`bn-dot t-${n.type}`} />
                {n.key && <b>{n.key}</b>}
                <span>{n.title}</span>
                <span className="muted small">{TYPE_LABEL[n.type]}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="muted small">
        Type <code>[[</code> to link a note. AI actions about the notes you link read this note too.
      </p>
      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn primary"
          disabled={busy || !String(d.title || '').trim()}
          onClick={save}
        >
          {busy ? <Spinner /> : null}
          {d.id ? 'Save' : 'Add note'}
        </button>
        <button className="btn subtle" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
/** The PROJECT BRAIN block AI actions and code agents get for an issue or epic. */
export function AiPreview({
  issueId,
  epicId,
  title,
  onOpen,
}: {
  issueId?: string;
  epicId?: string;
  title: string;
  onOpen: (id: string) => void;
}) {
  const [r, setR] = useState<Any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api(
      `/api/projects/${P().id}/brain?context=1${issueId ? `&issue=${encodeURIComponent(issueId)}` : ''}${epicId ? `&epic=${encodeURIComponent(epicId)}` : ''}`,
    )
      .then(setR)
      .catch((e) => setErr(e.message));
  }, [issueId, epicId]);
  return (
    <Modal
      title={`What the AI reads for ${title}`}
      wide
      actions={[{ label: 'Close', kind: 'primary' }]}
    >
      {err ? (
        <p className="danger-text">{err}</p>
      ) : !r ? (
        <p className="muted">
          <Spinner /> Choosing the notes…
        </p>
      ) : !r.block ? (
        <p className="muted">No linked notes yet.</p>
      ) : (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>
            Added to the prompt of AI actions and code agents about this{' '}
            {issueId ? 'issue' : 'epic'}: the note itself, notes it links to and that link to it
            (one and two links away), and the notes whose words match best.{' '}
            {r.block.length.toLocaleString()} characters.
          </p>
          <div className="brain-links-list" style={{ marginBottom: 12 }}>
            {r.notes.map((n: Any) => (
              <button
                key={n.id}
                className="brain-link-item"
                onClick={() => {
                  closeModal();
                  onOpen(n.id);
                }}
              >
                <span className={`bn-dot t-${n.type}`} />
                <span className="brain-link-text">{n.title}</span>
                <span className="muted small">{n.why}</span>
              </button>
            ))}
          </div>
          <pre className="brain-pre">{r.block}</pre>
        </>
      )}
    </Modal>
  );
}
