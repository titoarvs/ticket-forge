'use client';
// Rich-text comments (TipTap), like Jira: bold, italic, strike, code, lists, quotes, code blocks and links, with
// Markdown-style shortcuts, plus file attachments (button, drag and drop, or paste). Saved comments keep the
// TipTap document for display, a plain-text copy for search and exports, and their attachments.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { generateHTML } from '@tiptap/core';
import { P, api, toast, openModal, type Any } from './core';
import { Ico, I, Spinner, Modal } from './ui';

export type Attachment = { id: string; name: string; mime: string; bytes: number };
export type CommentValue = { doc: Any; text: string; attachments: Attachment[] };

// Links only to web and mail addresses; they open in a new tab.
const LINK = { openOnClick: false, autolink: true, defaultProtocol: 'https', protocols: ['http', 'https', 'mailto'],
  HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } };
const extensions = (placeholder = '') => [
  StarterKit.configure({ heading: { levels: [3, 4] }, link: LINK as Any }),
  ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
];
const MAX_DOC = 200_000;

const fmtBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isImage = (m: string) => /^image\/(png|jpeg|gif|webp)$/.test(m);
const fileUrl = (a: Attachment, download = false) => `/api/files/${a.id}/${encodeURIComponent(a.name)}${download ? '?download=1' : ''}`;

/** Plain text as a TipTap document (for comments written before rich text). */
export function textToDoc(text: string) {
  const paras = String(text || '').split(/\n{2,}/);
  return { type: 'doc', content: paras.map((p) => ({ type: 'paragraph', content: p ? p.split('\n').flatMap((line, i) => [...(i ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])]) : [] })) };
}

async function upload(file: File): Promise<Attachment> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('purpose', 'attachment');
  return api(`/api/projects/${P().id}/files`, { method: 'POST', body: fd });
}

function Toolbar({ editor, onAttach, busy = false, headings = false }: { editor: Editor; onAttach?: () => void; busy?: boolean; headings?: boolean }) {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); editor.on('transaction', f); return () => { editor.off('transaction', f); }; }, [editor]);
  const b = (label: string, active: boolean, run: () => void, content: React.ReactNode, key?: string) => (
    <button type="button" className={`ce-btn ${active ? 'on' : ''}`} title={key ? `${label} (${key})` : label} aria-label={label} aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()} onClick={run}>{content}</button>
  );
  const c = () => editor.chain().focus();
  const link = () => {
    const prev = editor.getAttributes('link').href || '';
    const url = window.prompt('Link address (https://…)', prev);
    if (url === null) return;
    if (!url.trim()) { c().extendMarkRange('link').unsetLink().run(); return; }
    c().extendMarkRange('link').setLink({ href: /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}` }).run();
  };
  return (
    <div className="ce-bar" role="toolbar" aria-label="Formatting">
      {headings && <>
        {b('Heading', editor.isActive('heading', { level: 3 }), () => c().toggleHeading({ level: 3 }).run(), <b>H</b>, '⌘⌥3')}
        {b('Subheading', editor.isActive('heading', { level: 4 }), () => c().toggleHeading({ level: 4 }).run(), <b style={{ fontSize: 11 }}>H2</b>, '⌘⌥4')}
        <span className="ce-sep" /></>}
      {b('Bold', editor.isActive('bold'), () => c().toggleBold().run(), <b>B</b>, '⌘B')}
      {b('Italic', editor.isActive('italic'), () => c().toggleItalic().run(), <i style={{ fontFamily: 'Georgia, serif' }}>I</i>, '⌘I')}
      {b('Strikethrough', editor.isActive('strike'), () => c().toggleStrike().run(), <s>S</s>, '⌘⇧S')}
      {b('Inline code', editor.isActive('code'), () => c().toggleCode().run(), <code>{'<>'}</code>, '⌘E')}
      <span className="ce-sep" />
      {b('Bulleted list', editor.isActive('bulletList'), () => c().toggleBulletList().run(), <span>•≡</span>, '⌘⇧8')}
      {b('Numbered list', editor.isActive('orderedList'), () => c().toggleOrderedList().run(), <span>1.</span>, '⌘⇧7')}
      {b('Quote', editor.isActive('blockquote'), () => c().toggleBlockquote().run(), <span>❝</span>, '⌘⇧B')}
      {b('Code block', editor.isActive('codeBlock'), () => c().toggleCodeBlock().run(), <code>{'{ }'}</code>, '⌘⌥C')}
      {b('Link', editor.isActive('link'), link, <Ico svg={I.link} />, '')}
      {onAttach && <><span className="ce-sep" />
      {b(busy ? 'Uploading…' : 'Attach files', false, onAttach, busy ? <Spinner /> : <Ico svg={I.upload} />, '')}</>}
    </div>
  );
}

/** The comment box. `value` starts it (editing); onSave gets the document, its text and the attachments. */
export function CommentEditor({ value, onSave, onCancel, saveLabel = 'Save', placeholder = 'Add a comment…', autoFocus, compactUntilFocus }: {
  value?: Partial<CommentValue> & { body?: string }; onSave: (v: CommentValue) => void; onCancel?: () => void; saveLabel?: string; placeholder?: string; autoFocus?: boolean; compactUntilFocus?: boolean;
}) {
  const [files, setFiles] = useState<Attachment[]>(value?.attachments || []);
  const [busy, setBusy] = useState(0);
  const [empty, setEmpty] = useState(true);
  const [active, setActive] = useState(!compactUntilFocus);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<() => void>(() => {});
  const addFiles = async (list: FileList | File[]) => {
    const arr = [...list].slice(0, 10);
    if (!arr.length) return;
    setActive(true);
    setBusy((n) => n + arr.length);
    for (const f of arr) {
      try { const meta = await upload(f); setFiles((x) => [...x, meta]); }
      catch (e: Any) { toast(`${f.name}: ${e.message}`, 'err'); }
      finally { setBusy((n) => n - 1); }
    }
  };
  const editor = useEditor({
    immediatelyRender: false,
    extensions: extensions(placeholder),
    content: value?.doc || (value?.body ? textToDoc(value.body) : ''),
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { class: 'ce-content rich', 'aria-label': 'Comment', role: 'textbox', 'aria-multiline': 'true' },
      handleKeyDown: (_v, e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveRef.current(); return true; }
        if (e.key === 'Escape' && onCancel) { onCancel(); return true; }
        return false;
      },
      handlePaste: (_v, e) => { const fl = e.clipboardData?.files; if (fl && fl.length) { addFiles(fl); return true; } return false; },
      handleDrop: (_v, e) => { const fl = (e as DragEvent).dataTransfer?.files; if (fl && fl.length) { e.preventDefault(); addFiles(fl); return true; } return false; },
    },
    onUpdate: ({ editor: ed }) => setEmpty(ed.isEmpty),
    onCreate: ({ editor: ed }) => setEmpty(ed.isEmpty),
    onFocus: () => setActive(true),
  });
  const canSave = Boolean(editor) && (!empty || files.length > 0) && !busy;
  saveRef.current = () => {
    if (!editor || !canSave) return;
    const doc = editor.getJSON();
    if (JSON.stringify(doc).length > MAX_DOC) { toast('This comment is too long. Split it up, or attach the text as a file.', 'err'); return; }
    onSave({ doc, text: editor.getText({ blockSeparator: '\n' }).trim(), attachments: files });
    if (!value) { editor.commands.clearContent(); setFiles([]); setEmpty(true); if (compactUntilFocus) setActive(false); }
  };
  if (!editor) return <div className="ce ce-loading muted small"><Spinner /> Loading editor…</div>;
  return (
    <div className={`ce ${active ? 'active' : ''}`} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={(e) => { if (e.dataTransfer.files.length && !(e.target as HTMLElement).closest('.ProseMirror')) { e.preventDefault(); addFiles(e.dataTransfer.files); } }}>
      {active && <Toolbar editor={editor} busy={busy > 0} onAttach={() => fileRef.current?.click()} />}
      <EditorContent editor={editor} onClick={() => setActive(true)} />
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
      {(files.length > 0 || busy > 0) && <Attachments files={files} uploading={busy} onRemove={(id) => setFiles((x) => x.filter((f) => f.id !== id))} />}
      {active && <div className="ce-foot">
        <button className="btn sm primary" disabled={!canSave} onClick={() => saveRef.current()}>{saveLabel}</button>
        {onCancel && <button className="btn sm subtle" onClick={onCancel}>Cancel</button>}
        <span className="muted small ce-hint">⌘↩ to save · drop or paste files to attach · **bold**, _italic_, - list, &gt; quote, ``` code</span>
      </div>}
    </div>
  );
}

// ---------------------------------------------------------------- rich text fields (issue descriptions)
// The field's plain text stays the source of truth (exports, search, AI prompts read it). The formatted
// document is saved beside it as { text, doc } and is only used while its text still matches, so a change
// made elsewhere (Claude rewriting the description, an import) falls back to the plain text.
export type RichValue = { text: string; doc: Any };

/** A TipTap document as readable plain text: blank lines between blocks, "- " and "1. " list markers, "> " quotes. */
export function docToText(doc: Any): string {
  const inline = (n: Any): string => (n.content || []).map((c: Any) => (c.type === 'text' ? c.text : c.type === 'hardBreak' ? '\n' : inline(c))).join('');
  const item = (li: Any, marker: string) => marker + (li.content || []).map(block).join('\n').split('\n').join(`\n${' '.repeat(marker.length)}`);
  const blocks = (n: Any, sep: string) => (n.content || []).map(block).join(sep);
  function block(n: Any): string {
    switch (n.type) {
      case 'paragraph': case 'heading': case 'codeBlock': return inline(n);
      case 'bulletList': return (n.content || []).map((li: Any) => item(li, '- ')).join('\n');
      case 'orderedList': { const s = Number(n.attrs?.start) || 1; return (n.content || []).map((li: Any, i: number) => item(li, `${s + i}. `)).join('\n'); }
      case 'blockquote': return blocks(n, '\n\n').split('\n').map((l) => `> ${l}`).join('\n');
      case 'horizontalRule': return '---';
      default: return n.content ? blocks(n, '\n\n') : '';
    }
  }
  return blocks(doc || {}, '\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
/** The document to show for a field: its saved formatting if still current, else its plain text. */
export const docFor = (text: string, rich?: RichValue | null) => (rich?.doc && rich.text === (text || '') ? rich.doc : textToDoc(text || ''));

/** A rich text input with a formatting toolbar. `ghost` hides the border and toolbar until it is focused. */
export function RichTextField({ text, rich, onChange, placeholder = '', disabled, ghost, autoFocus, ariaLabel = 'Description' }: {
  text: string; rich?: RichValue | null; onChange: (v: RichValue) => void; placeholder?: string; disabled?: boolean; ghost?: boolean; autoFocus?: boolean; ariaLabel?: string;
}) {
  const [focused, setFocused] = useState(false);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const want = docFor(text, rich);
  const wantJson = JSON.stringify(want);
  const seen = useRef(wantJson); // the last document this field loaded or produced
  const editor = useEditor({
    immediatelyRender: false,
    extensions: extensions(placeholder),
    content: want,
    editable: !disabled,
    autofocus: autoFocus ? 'end' : false,
    editorProps: { attributes: { class: 'ce-content rich', 'aria-label': ariaLabel, role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor: ed }) => { const doc = ed.getJSON(); seen.current = JSON.stringify(doc); changeRef.current({ text: ed.isEmpty ? '' : docToText(doc), doc }); },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  });
  // Follow changes made elsewhere (undo, Claude, another tab) without disturbing what is being typed here.
  useEffect(() => {
    if (!editor || editor.isDestroyed || seen.current === wantJson) return;
    seen.current = wantJson;
    editor.commands.setContent(JSON.parse(wantJson), { emitUpdate: false });
  }, [editor, wantJson]);
  useEffect(() => { if (editor && !editor.isDestroyed) editor.setEditable(!disabled); }, [editor, disabled]);
  if (!editor) return <div className="ce ce-loading muted small"><Spinner /> Loading editor…</div>;
  const showBar = !disabled && (!ghost || focused);
  return (
    <div className={`ce rtf ${ghost ? 'ghost' : ''} ${focused ? 'active' : ''} ${disabled ? 'disabled' : ''}`}>
      {showBar && <Toolbar editor={editor} headings />}
      <EditorContent editor={editor} />
    </div>
  );
}

/** A saved comment: its rich text (or plain text for older comments) and attachments. */
export function CommentBody({ c }: { c: Any }) {
  const html = useMemo(() => {
    if (!c.doc) return null;
    // Links whose address was refused (not web or mail) come out empty: show their text without a link.
    try { return generateHTML(c.doc, extensions()).replace(/<a\b[^>]*\bhref=""[^>]*>([\s\S]*?)<\/a>/g, '$1'); } catch { return null; }
  }, [c.doc]);
  return <>
    {html !== null ? <div className="cbody rich" dangerouslySetInnerHTML={{ __html: html }} />
      : <div className="cbody">{c.body}</div>}
    {c.attachments?.length > 0 && <Attachments files={c.attachments} />}
  </>;
}

export function Attachments({ files, uploading = 0, onRemove }: { files: Attachment[]; uploading?: number; onRemove?: (id: string) => void }) {
  const images = files.filter((f) => isImage(f.mime));
  const others = files.filter((f) => !isImage(f.mime));
  const view = (f: Attachment) => openModal(<Modal title={f.name} wide actions={[{ label: 'Close' }]}>
    <img src={fileUrl(f)} alt={f.name} style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }} />
    <p className="small" style={{ margin: '8px 0 0' }}><a href={fileUrl(f, true)}>Download</a> · {fmtBytes(f.bytes)}</p></Modal>);
  return (
    <div className="att">
      {images.length > 0 && <div className="att-imgs">{images.map((f) => <div key={f.id} className="att-img">
        <button type="button" onClick={() => view(f)} title={`${f.name} · ${fmtBytes(f.bytes)}`}><img src={fileUrl(f)} alt={f.name} loading="lazy" /></button>
        {onRemove && <button type="button" className="att-x" aria-label={`Remove ${f.name}`} onClick={() => onRemove(f.id)}>×</button>}
      </div>)}</div>}
      {(others.length > 0 || uploading > 0) && <div className="att-files">
        {others.map((f) => <span key={f.id} className="att-file">
          <Ico svg={I.doc} /><a href={fileUrl(f, !/pdf|video/.test(f.mime))} target={/pdf|video/.test(f.mime) ? '_blank' : undefined} rel="noopener noreferrer" title={f.name}>{f.name}</a>
          <span className="muted small">{fmtBytes(f.bytes)}</span>
          {onRemove && <button type="button" className="att-x inline" aria-label={`Remove ${f.name}`} onClick={() => onRemove(f.id)}>×</button>}
        </span>)}
        {uploading > 0 && <span className="att-file muted"><Spinner /> Uploading {uploading} file{uploading === 1 ? '' : 's'}…</span>}
      </div>}
    </div>
  );
}
