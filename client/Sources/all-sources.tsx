'use client';
import { useState, useRef } from 'react';
import {
  type Any,
  api,
  keepsOriginal,
  toast,
  uid,
  nowIso,
  me,
  mutate,
  S,
  closeModal,
  emit,
  uploadOriginal,
  P,
  openModal,
  can,
} from '../core';
import { Modal, Spinner, Ico, I } from '../ui';
import { TF, TA } from '../fields';
import { Markdown } from '../GuideCard';
import { FeatureModal } from '../FeatureModal';

type Doc = {
  id: string;
  name: string;
  kind: 'original' | 'document' | 'description' | 'reference';
  text: string;
  addedAt?: string;
  addedBy?: string;
  summary?: string;
  assumptions?: string[];
  openQuestions?: string[];
  issueIds?: string[];
  epicIds?: string[];
  runs?: Any[];
  file?: { id: string; name: string; mime: string; bytes: number };
};
export const KIND: Record<string, [string, string]> = {
  original: ['Initial feature', 'The document this project was created from'],
  document: ['Added feature', 'Imported with Add feature with AI'],
  description: ['Feature description', 'Described in Add feature with AI'],
  reference: ['Reference', 'Attached for reference'],
};
export const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const looksMarkdown = (s: string) => /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|.+\|)/m.test(s);
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const fmtBytes = (n: number) =>
  n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
/** Extracted text laid out as a page: Markdown formatting when present, otherwise paragraphs. Lines that a PDF
 *  broke mid-sentence are joined back up. */
export function TextPage({ text }: { text: string }) {
  if (looksMarkdown(text)) return <Markdown text={text} />;
  const paras = text
    .split(/\n\s*\n/)
    .map((b) =>
      b
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    )
    .filter((b) => b.length);
  return (
    <>
      {paras.map((ls, i) => {
        const heading =
          ls.length === 1 && ls[0].length < 70 && !/[.,;:]$/.test(ls[0]) && /^[A-Z0-9]/.test(ls[0]);
        if (heading) return <h3 key={i}>{ls[0]}</h3>;
        const out: React.ReactNode[] = [];
        ls.forEach((l, j) => {
          if (j)
            out.push(
              /[.:;!?]$/.test(ls[j - 1]) || /^([-•*]|\d+[.)])\s/.test(l) ? (
                <br key={`b${j}`} />
              ) : (
                ' '
              ),
            );
          out.push(l);
        });
        return <p key={i}>{out}</p>;
      })}
    </>
  );
}
/** Prints a text document as a clean page (the browser offers "Save as PDF"). */
export function printPaper(title: string, html: string) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const d = f.contentDocument!;
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<&>]/g, '')}</title><style>
    body{margin:0;font:11pt/1.55 Calibri,Carlito,"Segoe UI",Arial,sans-serif;color:#1f2328}
    h1,h2,h3,h4{color:#1f3864;line-height:1.25;margin:1.1em 0 .4em} h1{font-size:20pt} h2{font-size:15pt} h3{font-size:13pt}
    p{margin:0 0 .7em} ul,ol{padding-left:1.6em} table{border-collapse:collapse;width:100%} td,th{border:1px solid #c8ccd1;padding:4px 8px;text-align:left}
    pre,code{font-family:ui-monospace,Menlo,monospace;font-size:9.5pt} @page{margin:20mm}</style></head><body>${html}</body></html>`);
  d.close();
  setTimeout(() => {
    f.contentWindow?.focus();
    f.contentWindow?.print();
    setTimeout(() => f.remove(), 1000);
  }, 150);
}
export function allSources(p: Any): Doc[] {
  const out: Doc[] = [];
  if (p.sourceText)
    out.push({
      id: 'original',
      name: p.sourceName || 'Requirements',
      kind: 'original',
      text: p.sourceText,
      addedAt: p.createdAt,
      summary: p.summary,
      assumptions: p.assumptions || [],
      openQuestions: p.openQuestions || [],
      issueIds: p.sourceIssueIds || [],
      epicIds: p.sourceEpicIds || [],
      file: p.sourceFile,
    });
  for (const d of p.sources || []) out.push(d);
  return out;
}
/** Plain text with search matches highlighted. */
export function Highlighted({ text, q, current }: { text: string; q: string; current: number }) {
  if (!q) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRe(q)})`, 'gi'));
  let n = -1;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <mark key={i} data-hit={++n} className={n === current ? 'on' : ''}>
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
/** Attach a document for reference (no generation): upload a file or paste text. */
export function AddDocModal() {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [orig, setOrig] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await api('/api/parse', { method: 'POST', body: fd });
      setName(r.filename);
      setText(r.text);
      setOrig(keepsOriginal(file) ? file : null);
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  const save = (thenFeature: boolean) => {
    const doc = {
      id: uid(),
      name: name.trim() || 'Untitled document',
      kind: 'reference',
      text: text.trim(),
      addedAt: nowIso(),
      addedBy: me(),
      issueIds: [],
      epicIds: [],
      runs: [],
    };
    mutate((pp) => {
      pp.sources ??= [];
      pp.sources.push(doc);
    });
    S.sourceDoc = doc.id;
    closeModal();
    emit();
    toast(`Added “${doc.name}”`);
    if (orig)
      uploadOriginal(P().id, orig)
        .then((meta: Any) =>
          mutate((pp) => {
            const d = (pp.sources || []).find((x: Any) => x.id === doc.id);
            if (d) d.file = meta;
          }),
        )
        .catch(() =>
          toast('The document was added, but its original file couldn’t be kept.', 'err'),
        );
    if (thenFeature)
      openModal(
        <FeatureModal initialDoc={{ filename: doc.name, text: doc.text }} sourceId={doc.id} />,
      );
  };
  const ok = text.trim().length > 0;
  return (
    <Modal
      title="Add a document"
      wide
      actions={[
        { label: 'Cancel' },
        {
          label: 'Add and plan work with AI',
          kind: 'ai',
          onClick: () => save(true),
          disabled: !ok,
          hidden: !can('ai.use'),
        },
        { label: 'Add document', kind: 'primary', onClick: () => save(false), disabled: !ok },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Keep supporting documents with the project: change requests, specs, meeting notes. You can
        plan new epics and issues from one now or later.
      </p>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".pdf,.docx,.md,.markdown,.txt,.html,.htm,.xlsx,.xls,.csv,.json"
        onChange={(e) => upload(e.target.files?.[0])}
      />
      <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? (
          <>
            <Spinner />
            Reading…
          </>
        ) : (
          <>
            <Ico svg={I.upload} />
            Upload a file
          </>
        )}
      </button>
      <span className="muted small" style={{ marginLeft: 8 }}>
        PDF, Word, Markdown, text, HTML, Excel or CSV, or paste below
      </span>
      <label className="field" style={{ marginTop: 12 }}>
        <span>Name</span>
        <TF
          value={name}
          placeholder="e.g. Change request 12 — loyalty points"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Text</span>
        <TA
          value={text}
          rows={12}
          placeholder="Paste the document text…"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {ok && (
        <p className="muted small" style={{ margin: 0 }}>
          {words(text).toLocaleString()} words
        </p>
      )}
    </Modal>
  );
}
