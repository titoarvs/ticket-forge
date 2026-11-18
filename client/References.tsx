'use client';
// UI references on a ticket: screenshots, HTML, PDF and other documents the AI reads when it writes the ticket.
// The server keeps the file and reads its text, form fields and components; they are stored on the ticket
// (`references`), shown here, and passed to AI generation.
import { useRef, useState } from 'react';
import { P, api, mutate, toast, openModal, can, logEvent, type Any } from './core';
import { Ico, I, Spinner, Confirm } from './ui';

const fmtBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isImage = (m: string) => /^image\/(png|jpeg|gif|webp)$/.test(m);
const fileUrl = (r: Any) => `/api/files/${r.id}`;
const NOTE_TONE: Any = { 'no-text': 'muted', failed: 'ref-err' };

function Chips({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="ref-group">
      <h4 className="ref-h">
        {label} <span className="count">{items.length}</span>
      </h4>
      {items.length ? (
        <ul className="ref-chips">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      ) : (
        <p className="muted small">None found.</p>
      )}
    </div>
  );
}

function Reference({ t, r, edit }: { t: Any; r: Any; edit: boolean }) {
  const [open, setOpen] = useState(false);
  const remove = () =>
    openModal(
      <Confirm
        title="Remove this reference?"
        label="Remove"
        onYes={async () => {
          try {
            await api(`/api/files/${r.id}`, { method: 'DELETE' });
          } catch (e: any) {
            toast(e.message || 'Could not remove the file.', 'err');
            return;
          }
          mutate(() => {
            t.references = (t.references || []).filter((x: Any) => x.id !== r.id);
            logEvent(t, `removed the reference ${r.name}`);
          });
          toast('Reference removed');
        }}
        text={<>“{r.name}”, its preview and the text, fields and components read from it will be deleted from this ticket.</>}
      />,
    );
  return (
    <li className="ref">
      <div className="ref-head">
        {isImage(r.mime) ? (
          <a href={fileUrl(r)} target="_blank" rel="noopener noreferrer" className="ref-thumb" title={`Open ${r.name}`}>
            <img src={fileUrl(r)} alt={`Preview of ${r.name}`} loading="lazy" />
          </a>
        ) : (
          <div className="ref-thumb ref-doc" role="img" aria-label={`Preview of ${r.name}`}>
            {r.preview ? <p>{r.preview}</p> : <Ico svg={I.doc} />}
          </div>
        )}
        <div className="ref-meta">
          <a href={`${fileUrl(r)}?download=1`} className="ref-name" title="Download">
            {r.name}
          </a>
          <span className="muted small">
            {fmtBytes(r.bytes)}
            {r.status === 'done' && ` · ${r.fields?.length || 0} fields · ${r.components?.length || 0} components`}
          </span>
          <button type="button" className="btn subtle ref-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide extracted data' : 'Show extracted data'}
          </button>
        </div>
        {edit && (
          <button type="button" className="icon-btn" title="Remove reference" aria-label={`Remove ${r.name}`} onClick={remove}>
            <Ico svg={I.trash} />
          </button>
        )}
      </div>
      {r.note && (
        <p className={`small ${NOTE_TONE[r.status] || 'muted'}`} role={r.status === 'failed' ? 'alert' : undefined}>
          {r.note}
        </p>
      )}
      {open && (
        <div className="ref-data">
          <div className="ref-group">
            <h4 className="ref-h">Text</h4>
            {r.text ? (
              <pre className="ref-text" tabIndex={0} aria-label={`Extracted text of ${r.name}`}>
                {r.text}
              </pre>
            ) : (
              <p className="muted small">No text extracted.</p>
            )}
          </div>
          <Chips label="Fields" items={r.fields || []} />
          <Chips label="Components" items={r.components || []} />
        </div>
      )}
    </li>
  );
}

export function ReferencesSection({ t }: { t: Any }) {
  const edit = can('issue.edit');
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [limits, setLimits] = useState<Any>(null);
  const refs: Any[] = t.references || [];

  const loadLimits = async () => {
    if (!limits) {
      try {
        setLimits(await api(`/api/projects/${encodeURIComponent(P().id)}/references`));
      } catch {
        /* the server checks anyway */
      }
    }
  };
  const pick = async (files: FileList | null) => {
    const file = files?.[0];
    if (input.current) input.current.value = '';
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api(`/api/projects/${encodeURIComponent(P().id)}/references`, { method: 'POST', body: fd });
      mutate(() => {
        t.references = [...(t.references || []), r];
        logEvent(t, `attached the reference ${r.name}`);
      });
      toast('Reference attached');
    } catch (e: any) {
      setError(e.message || 'The file could not be attached.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sec" data-sec="references">
      <div className="sec-title">
        <Ico svg={I.upload} />
        <h3>UI references</h3>
        <span className="count">{refs.length}</span>
        {edit && (
          <span style={{ marginLeft: 'auto' }}>
            <input
              ref={input}
              type="file"
              hidden
              id={`ref-file-${t.id}`}
              aria-label="Attach a UI reference"
              accept={limits?.types?.join(',')}
              onChange={(e) => pick(e.target.files)}
            />
            <button
              type="button"
              className="btn"
              disabled={busy}
              onFocus={loadLimits}
              onMouseEnter={loadLimits}
              onClick={() => input.current?.click()}
            >
              {busy ? (
                <>
                  <Spinner /> Reading file…
                </>
              ) : (
                <>
                  <Ico svg={I.upload} />
                  Attach file
                </>
              )}
            </button>
          </span>
        )}
      </div>
      {error && (
        <p className="small ref-err" role="alert">
          {error}
        </p>
      )}
      {refs.length ? (
        <ul className="ref-list">
          {refs.map((r) => (
            <Reference key={r.id} t={t} r={r} edit={edit} />
          ))}
        </ul>
      ) : (
        <p className="muted small">
          {edit
            ? 'Attach a screenshot, HTML page, PDF or document. The AI uses what is read from it when it writes this ticket.'
            : 'No references attached.'}
        </p>
      )}
      {limits && edit && (
        <p className="muted small">
          Allowed: {limits.types.join(', ')} · up to {limits.maxLabel}
        </p>
      )}
    </div>
  );
}
