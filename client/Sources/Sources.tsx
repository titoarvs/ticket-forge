'use client';
import { useState, useRef, useMemo, useEffect } from 'react';
import {
  P,
  S,
  can,
  emit,
  openModal,
  keepsOriginal,
  toast,
  uploadOriginal,
  mutate,
  type Any,
  api,
  ticket,
  epic,
  closeModal,
  ago,
  copyText,
} from '../core';
import { Ico, I, EmptyState, Modal, Confirm, Swatch, TypeIcon, StatusLoz, Spinner } from '../ui';
import { TF } from '../fields';
import { openDrawer } from '../actions';
import { Header } from '../views';
import { FeatureModal } from '../FeatureModal';
import { ItemText } from '../ListEditor';
import Link from 'next/link';
import {
  allSources,
  escapeRe,
  AddDocModal,
  printPaper,
  words,
  KIND,
  fmtBytes,
  Highlighted,
  TextPage,
} from './all-sources';

export function Sources() {
  const p = P();
  const docs = allSources(p);
  const sel = docs.find((d) => d.id === S.sourceDoc) || docs[0];
  const [q, setQ] = useState('');
  const [hit, setHit] = useState(0);
  const [mode, setMode] = useState<'page' | 'text'>('page');
  const [zoom, setZoom] = useState(1);
  const [attaching, setAttaching] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const canAdd = can('issue.create');
  const canEdit = can('project.settings') || can('issue.create');

  const hits = useMemo(
    () => (q && sel ? (sel.text.match(new RegExp(escapeRe(q), 'gi')) || []).length : 0),
    [q, sel],
  );
  useEffect(() => {
    setHit(0);
  }, [q, sel?.id]);
  useEffect(() => {
    bodyRef.current
      ?.querySelector(`mark[data-hit="${hit}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [hit, q, sel?.id]);

  const select = (id: string) => {
    S.sourceDoc = id;
    setQ('');
    setMode('page');
    emit();
  };
  const header = (
    <Header
      title="Source documents"
      right={
        <>
          {canAdd && can('ai.use') && (
            <button className="btn ai" onClick={() => openModal(<FeatureModal />)}>
              <Ico svg={I.plus} />
              Add feature with AI
            </button>
          )}
          {canAdd && (
            <button className="btn primary" onClick={() => openModal(<AddDocModal />)}>
              <Ico svg={I.upload} />
              Add document
            </button>
          )}
        </>
      }
    />
  );

  if (!sel)
    return (
      <>
        {header}
        <EmptyState
          icon={I.doc}
          tone="neutral"
          title="No source documents yet"
          actions={
            canAdd && (
              <button className="btn primary" onClick={() => openModal(<AddDocModal />)}>
                <Ico svg={I.upload} />
                Add document
              </button>
            )
          }
        >
          <p>
            This project was created without a requirements document. Documents you import with{' '}
            <b>Add feature with AI</b> or add here are kept on this page.
          </p>
        </EmptyState>
      </>
    );

  const isPdf = sel.file?.mime === 'application/pdf';
  const isDocx = Boolean(sel.file && /wordprocessingml/.test(sel.file.mime));
  const print = () => {
    if (isPdf) {
      window.open(
        `/api/files/${sel.file!.id}/${encodeURIComponent(sel.file!.name)}`,
        '_blank',
        'noopener',
      );
      return;
    }
    if (isDocx) {
      try {
        frameRef.current?.contentWindow?.print();
      } catch {
        window.open(`/api/files/${sel.file!.id}?view=html`, '_blank', 'noopener');
      }
      return;
    }
    printPaper(sel.name, paperRef.current?.innerHTML || '');
  };
  const attach = async (file?: File) => {
    if (!file) return;
    if (!keepsOriginal(file)) {
      toast('Attach a PDF or Word (.docx) file.', 'err');
      return;
    }
    setAttaching(true);
    try {
      const meta = await uploadOriginal(p.id, file);
      const old = sel.file?.id;
      mutate((pp) => {
        if (sel.id === 'original') pp.sourceFile = meta;
        else {
          const d = (pp.sources || []).find((x: Any) => x.id === sel.id);
          if (d) d.file = meta;
        }
      });
      if (old) api(`/api/files/${old}`, { method: 'DELETE' }).catch(() => {});
      toast(`Attached “${meta.name}”`);
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setAttaching(false);
    }
  };
  const issues = (sel.issueIds || []).map(ticket).filter(Boolean);
  const epics = (sel.epicIds || []).map(epic).filter(Boolean);
  const wc = words(sel.text);
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([sel.text], { type: 'text/markdown' }));
    a.download = `${
      sel.name
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[^\w\- ]+/g, '')
        .trim() || 'document'
    }.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const rename = () => {
    let v = sel.name;
    openModal(
      <Modal
        title="Rename document"
        actions={[
          { label: 'Cancel' },
          {
            label: 'Rename',
            kind: 'primary',
            onClick: () => {
              if (v.trim())
                mutate((pp) => {
                  const d = pp.sources.find((x: Any) => x.id === sel.id);
                  if (d) d.name = v.trim();
                });
              closeModal();
            },
          },
        ]}
      >
        <label className="field">
          <span>Name</span>
          <TF
            autoFocus
            defaultValue={sel.name}
            onChange={(e) => {
              v = e.target.value;
            }}
          />
        </label>
      </Modal>,
    );
  };
  const remove = () =>
    openModal(
      <Confirm
        title={`Remove “${sel.name}”?`}
        label="Remove"
        text={`The document is removed from this project.${issues.length ? ` The ${issues.length} issue${issues.length === 1 ? '' : 's'} it produced stay.` : ''} You can undo with ⌘Z.`}
        onYes={() => {
          mutate((pp) => {
            pp.sources = (pp.sources || []).filter((x: Any) => x.id !== sel.id);
          });
          S.sourceDoc = null;
          emit();
        }}
      />,
    );

  return (
    <>
      {header}
      <div className="src-layout">
        <nav className="src-list" aria-label="Documents">
          <div className="muted small src-list-h">
            {docs.length} document{docs.length === 1 ? '' : 's'}
          </div>
          {docs.map((d) => (
            <button
              key={d.id}
              className={`src-item ${d.id === sel.id ? 'on' : ''}`}
              aria-current={d.id === sel.id}
              onClick={() => select(d.id)}
            >
              <Ico svg={I.doc} />
              <span className="src-item-t">
                <b title={d.name}>{d.name}</b>
                <span className="muted small">
                  {KIND[d.kind]?.[0]} · {words(d.text).toLocaleString()} words
                  {(d.issueIds || []).length ? ` · ${(d.issueIds || []).length} issues` : ''}
                </span>
                {d.addedAt && (
                  <span className="muted small">
                    {d.kind === 'original' ? 'Created' : 'Added'} {ago(d.addedAt)}
                    {d.addedBy ? ` by ${d.addedBy}` : ''}
                  </span>
                )}
              </span>
            </button>
          ))}
        </nav>

        <section className="src-view">
          <div className="src-head">
            <div style={{ minWidth: 0 }}>
              <h2 className="src-title" title={sel.name}>
                {sel.name}
              </h2>
              <div className="muted small row" style={{ gap: 8 }}>
                <span className={`src-kind k-${sel.kind}`} title={KIND[sel.kind]?.[1]}>
                  {KIND[sel.kind]?.[0]}
                </span>
                <span>
                  {wc.toLocaleString()} words · about {Math.max(1, Math.round(wc / 230))} min read
                </span>
                {sel.addedAt && (
                  <span>
                    {sel.kind === 'original' ? 'Created' : 'Added'} {ago(sel.addedAt)}
                    {sel.addedBy ? ` by ${sel.addedBy}` : ''}
                  </span>
                )}
              </div>
            </div>
            <div className="row src-actions">
              {canAdd && can('ai.use') && (
                <button
                  className="btn ai sm"
                  onClick={() =>
                    openModal(
                      <FeatureModal
                        initialDoc={{ filename: sel.name, text: sel.text }}
                        sourceId={sel.id}
                      />,
                    )
                  }
                  title="Plan more epics and issues from this document"
                >
                  <Ico svg={I.sparkle} />
                  Plan work from it
                </button>
              )}
              <button className="btn sm" onClick={() => copyText(sel.text)}>
                <Ico svg={I.copy} />
                Copy
              </button>
              <button className="btn sm" onClick={download}>
                <Ico svg={I.download} />
                Download
              </button>
              {canEdit && sel.kind !== 'original' && (
                <>
                  <button
                    className="icon-btn"
                    title="Rename"
                    aria-label="Rename document"
                    onClick={rename}
                  >
                    <Ico svg={I.pencil} />
                  </button>
                  <button
                    className="icon-btn"
                    title="Remove"
                    aria-label="Remove document"
                    onClick={remove}
                  >
                    <Ico svg={I.trash} />
                  </button>
                </>
              )}
            </div>
          </div>

          {(sel.summary ||
            epics.length > 0 ||
            issues.length > 0 ||
            (sel.openQuestions || []).length > 0 ||
            (sel.assumptions || []).length > 0) && (
            <div className="src-work">
              {sel.summary && <p style={{ margin: '0 0 8px' }}>{sel.summary}</p>}
              {epics.length > 0 && (
                <div className="row" style={{ gap: 6, marginBottom: 6 }}>
                  <span className="muted small">Epics</span>
                  {epics.map((e: Any) => (
                    <button
                      key={e.id}
                      className="src-chip"
                      onClick={() => openDrawer('epic', e.id)}
                    >
                      <Swatch color={e.color} />
                      {e.title}
                    </button>
                  ))}
                </div>
              )}
              {issues.length > 0 && (
                <details className="src-issues" open={issues.length <= 6}>
                  <summary className="small">
                    <b>
                      {issues.length} issue{issues.length === 1 ? '' : 's'}
                    </b>{' '}
                    created from this document
                  </summary>
                  <div className="rows">
                    {issues.map((t: Any) => (
                      <div key={t.id} className="irow" onClick={() => openDrawer('issue', t.id)}>
                        <TypeIcon type={t.type} />
                        <span className="key">{t.key}</span>
                        <span className="sum">{t.title}</span>
                        <span className="right">
                          <StatusLoz s={t.status} />
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {(sel.issueIds || []).length > issues.length && (
                <p className="muted small" style={{ margin: '4px 0 0' }}>
                  {(sel.issueIds || []).length - issues.length} issue(s) from this document were
                  deleted since.
                </p>
              )}
              {[
                ['Assumptions', sel.assumptions],
                ['Open questions', sel.openQuestions],
              ].map(
                ([label, l]: Any) =>
                  l?.length > 0 && (
                    <details key={label} className="src-lists">
                      <summary className="small">
                        <b>
                          {l.length} {label.toLowerCase()}
                        </b>
                        {sel.kind === 'original' && can('project.settings') && (
                          <>
                            {' '}
                            ·{' '}
                            <Link
                              href={`/p/${p.id}/settings`}
                              onClick={() => {
                                S.setTab = 'details';
                              }}
                            >
                              Edit
                            </Link>
                          </>
                        )}
                      </summary>
                      <ol className="li-list read">
                        {l.map((x: string, i: number) => (
                          <li key={i}>
                            <span className="li-n">{i + 1}</span>
                            <div className="li-body">
                              <ItemText s={x} />
                            </div>
                          </li>
                        ))}
                      </ol>
                    </details>
                  ),
              )}
            </div>
          )}

          <div className="src-tools">
            <div className="seg" role="radiogroup" aria-label="View">
              <button
                role="radio"
                aria-checked={mode === 'page'}
                className={mode === 'page' ? 'on' : ''}
                onClick={() => {
                  setQ('');
                  setMode('page');
                }}
              >
                <Ico svg={I.doc} />
                Document
              </button>
              <button
                role="radio"
                aria-checked={mode === 'text'}
                className={mode === 'text' ? 'on' : ''}
                onClick={() => setMode('text')}
              >
                Text
              </button>
            </div>
            <div className="search src-search">
              <Ico svg={I.search} />
              <input
                value={q}
                placeholder="Find in document"
                aria-label="Find in document"
                onChange={(e) => {
                  setQ(e.target.value);
                  if (e.target.value) setMode('text');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && hits) {
                    e.preventDefault();
                    setHit((h) => (e.shiftKey ? (h - 1 + hits) % hits : (h + 1) % hits));
                  }
                  if (e.key === 'Escape') setQ('');
                }}
              />
            </div>
            {q && (
              <span className="muted small" aria-live="polite">
                {hits ? `${hit + 1} of ${hits}` : 'No matches'}
              </span>
            )}
            {q && hits > 1 && (
              <>
                <button
                  className="icon-btn"
                  aria-label="Previous match"
                  onClick={() => setHit((h) => (h - 1 + hits) % hits)}
                >
                  <Ico svg={I.up} />
                </button>
                <button
                  className="icon-btn"
                  aria-label="Next match"
                  onClick={() => setHit((h) => (h + 1) % hits)}
                >
                  <Ico svg={I.down} />
                </button>
              </>
            )}
            <div className="spacer" />
            {mode === 'page' && !isPdf && (
              <span className="row src-zoom" style={{ gap: 2 }}>
                <button
                  className="icon-btn"
                  aria-label="Zoom out"
                  disabled={zoom <= 0.6}
                  onClick={() => setZoom(Math.round((zoom - 0.1) * 10) / 10)}
                >
                  −
                </button>
                <button className="btn sm subtle" title="Reset zoom" onClick={() => setZoom(1)}>
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  className="icon-btn"
                  aria-label="Zoom in"
                  disabled={zoom >= 1.6}
                  onClick={() => setZoom(Math.round((zoom + 0.1) * 10) / 10)}
                >
                  +
                </button>
              </span>
            )}
            {mode === 'page' && (
              <button className="btn sm" onClick={print}>
                <Ico svg={I.download} />
                {isPdf ? 'Open PDF' : 'Print / PDF'}
              </button>
            )}
          </div>
          {sel.file && mode === 'page' && (
            <div className="src-file small">
              <Ico svg={I.doc} />
              <span>
                Original file: <b>{sel.file.name}</b> · {fmtBytes(sel.file.bytes)}
              </span>
              <a
                href={`/api/files/${sel.file.id}/${encodeURIComponent(sel.file.name)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open
              </a>
              <a href={`/api/files/${sel.file.id}?download=1`}>Download</a>
              {canEdit && (
                <button className="link-btn" onClick={() => attachRef.current?.click()}>
                  Replace
                </button>
              )}
            </div>
          )}
          {!sel.file && mode === 'page' && canEdit && sel.kind !== 'description' && (
            <div className="src-file small muted">
              <Ico svg={I.doc} />
              <span>
                Showing the document’s text as a page. Have the original PDF or Word file? Attach it
                to see it exactly as written.
              </span>
              <button
                className="btn sm"
                disabled={attaching}
                onClick={() => attachRef.current?.click()}
              >
                {attaching ? (
                  <>
                    <Spinner />
                    Uploading…
                  </>
                ) : (
                  <>
                    <Ico svg={I.upload} />
                    Attach original
                  </>
                )}
              </button>
            </div>
          )}
          <input
            ref={attachRef}
            type="file"
            hidden
            accept=".pdf,.docx"
            onChange={(e) => {
              attach(e.target.files?.[0]);
              e.target.value = '';
            }}
          />

          <div className={`src-body ${mode === 'page' ? 'is-page' : ''}`} ref={bodyRef}>
            {mode === 'text' ? (
              <div className="source src-plain">
                <Highlighted text={sel.text} q={q} current={hit} />
              </div>
            ) : isPdf ? (
              <iframe
                key={sel.file!.id}
                className="doc-pdf"
                src={`/api/files/${sel.file!.id}/${encodeURIComponent(sel.file!.name)}#view=FitH`}
                title={sel.name}
              />
            ) : (
              <div className="paper-desk">
                <div className="paper-zoom" style={{ zoom }}>
                  {isDocx ? (
                    <iframe
                      key={sel.file!.id}
                      ref={frameRef}
                      className="doc-frame"
                      sandbox="allow-same-origin allow-popups allow-modals"
                      src={`/api/files/${sel.file!.id}?view=html`}
                      title={sel.name}
                      onLoad={(e) => {
                        const f = e.currentTarget;
                        try {
                          f.style.height = `${f.contentDocument!.documentElement.scrollHeight + 4}px`;
                        } catch {
                          /* keep default */
                        }
                      }}
                    />
                  ) : (
                    <article className="paper" ref={paperRef}>
                      <TextPage text={sel.text} />
                    </article>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
