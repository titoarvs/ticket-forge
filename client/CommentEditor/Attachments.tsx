'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { generateHTML } from '@tiptap/core';
import { type Any, openModal } from '../core';
import { Spinner, Modal, Ico, I } from '../ui';
import { textToDoc, Toolbar, isImage, fileUrl, fmtBytes } from './CommentEditor';
import { extensions, type Attachment } from './Attachment';

// ---------------------------------------------------------------- rich text fields (issue
// descriptions) The field's plain text stays the source of truth (exports, search, AI prompts read
// it). The formatted document is saved beside it as { text, doc } and is only used while its text
// still matches, so a change made elsewhere (Claude rewriting the description, an import) falls
// back to the plain text.
export type RichValue = { text: string; doc: Any };
/**
 * A TipTap document as readable plain text: blank lines between blocks, "- " and "1. " list
 * markers, "> " quotes.
 */
export function docToText(doc: Any): string {
  const inline = (n: Any): string =>
    (n.content || [])
      .map((c: Any) => (c.type === 'text' ? c.text : c.type === 'hardBreak' ? '\n' : inline(c)))
      .join('');
  const item = (li: Any, marker: string) =>
    marker +
    (li.content || [])
      .map(block)
      .join('\n')
      .split('\n')
      .join(`\n${' '.repeat(marker.length)}`);
  const blocks = (n: Any, sep: string) => (n.content || []).map(block).join(sep);
  function block(n: Any): string {
    switch (n.type) {
      case 'paragraph':
      case 'heading':
      case 'codeBlock':
        return inline(n);
      case 'bulletList':
        return (n.content || []).map((li: Any) => item(li, '- ')).join('\n');
      case 'orderedList': {
        const s = Number(n.attrs?.start) || 1;
        return (n.content || []).map((li: Any, i: number) => item(li, `${s + i}. `)).join('\n');
      }
      case 'blockquote':
        return blocks(n, '\n\n')
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n');
      case 'horizontalRule':
        return '---';
      default:
        return n.content ? blocks(n, '\n\n') : '';
    }
  }
  return blocks(doc || {}, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
/** The document to show for a field: its saved formatting if still current, else its plain text. */
const docFor = (text: string, rich?: RichValue | null) =>
  rich?.doc && rich.text === (text || '') ? rich.doc : textToDoc(text || '');
/**
 * A rich text input with a formatting toolbar. `ghost` hides the border and toolbar until it is
 * focused.
 */
export function RichTextField({
  text,
  rich,
  onChange,
  placeholder = '',
  disabled,
  ghost,
  autoFocus,
  ariaLabel = 'Description',
}: {
  text: string;
  rich?: RichValue | null;
  onChange: (v: RichValue) => void;
  placeholder?: string;
  disabled?: boolean;
  ghost?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
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
    editorProps: {
      attributes: {
        class: 'ce-content rich',
        'aria-label': ariaLabel,
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: ed }) => {
      const doc = ed.getJSON();
      seen.current = JSON.stringify(doc);
      changeRef.current({ text: ed.isEmpty ? '' : docToText(doc), doc });
    },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  });
  // Follow changes made elsewhere (undo, Claude, another tab) without disturbing what is being
  // typed here.
  useEffect(() => {
    if (!editor || editor.isDestroyed || seen.current === wantJson) return;
    seen.current = wantJson;
    editor.commands.setContent(JSON.parse(wantJson), { emitUpdate: false });
  }, [editor, wantJson]);
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(!disabled);
  }, [editor, disabled]);
  if (!editor)
    return (
      <div className="ce ce-loading muted small">
        <Spinner /> Loading editor…
      </div>
    );
  const showBar = !disabled && (!ghost || focused);
  return (
    <div
      className={`ce rtf ${ghost ? 'ghost' : ''} ${focused ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
    >
      {showBar && <Toolbar editor={editor} headings />}
      <EditorContent editor={editor} />
    </div>
  );
}
/** A saved comment: its rich text (or plain text for older comments) and attachments. */
export function CommentBody({ c }: { c: Any }) {
  const html = useMemo(() => {
    if (!c.doc) return null;
    // Links whose address was refused (not web or mail) come out empty: show their text without a
    // link.
    try {
      return generateHTML(c.doc, extensions()).replace(
        /<a\b[^>]*\bhref=""[^>]*>([\s\S]*?)<\/a>/g,
        '$1',
      );
    } catch {
      return null;
    }
  }, [c.doc]);
  return (
    <>
      {html !== null ? (
        <div className="cbody rich" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="cbody">{c.body}</div>
      )}
      {c.attachments?.length > 0 && <Attachments files={c.attachments} />}
    </>
  );
}
export function Attachments({
  files,
  uploading = 0,
  onRemove,
}: {
  files: Attachment[];
  uploading?: number;
  onRemove?: (id: string) => void;
}) {
  const images = files.filter((f) => isImage(f.mime));
  const others = files.filter((f) => !isImage(f.mime));
  const view = (f: Attachment) =>
    openModal(
      <Modal title={f.name} wide actions={[{ label: 'Close' }]}>
        <img
          src={fileUrl(f)}
          alt={f.name}
          style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }}
        />
        <p className="small" style={{ margin: '8px 0 0' }}>
          <a href={fileUrl(f, true)}>Download</a> · {fmtBytes(f.bytes)}
        </p>
      </Modal>,
    );
  return (
    <div className="att">
      {images.length > 0 && (
        <div className="att-imgs">
          {images.map((f) => (
            <div key={f.id} className="att-img">
              <button
                type="button"
                onClick={() => view(f)}
                title={`${f.name} · ${fmtBytes(f.bytes)}`}
              >
                <img src={fileUrl(f)} alt={f.name} loading="lazy" />
              </button>
              {onRemove && (
                <button
                  type="button"
                  className="att-x"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => onRemove(f.id)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {(others.length > 0 || uploading > 0) && (
        <div className="att-files">
          {others.map((f) => (
            <span key={f.id} className="att-file">
              <Ico svg={I.doc} />
              <a
                href={fileUrl(f, !/pdf|video/.test(f.mime))}
                target={/pdf|video/.test(f.mime) ? '_blank' : undefined}
                rel="noopener noreferrer"
                title={f.name}
              >
                {f.name}
              </a>
              <span className="muted small">{fmtBytes(f.bytes)}</span>
              {onRemove && (
                <button
                  type="button"
                  className="att-x inline"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => onRemove(f.id)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {uploading > 0 && (
            <span className="att-file muted">
              <Spinner /> Uploading {uploading} file{uploading === 1 ? '' : 's'}…
            </span>
          )}
        </div>
      )}
    </div>
  );
}
