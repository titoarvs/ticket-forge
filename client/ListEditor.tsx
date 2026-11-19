'use client';
// A readable list of assumptions or open questions. Reference codes such as "A-PR-01:" become a tag
// and short leads such as "Go-live timing:" are bolded. Each item can be edited in place or
// removed, and new ones added.
import { useState } from 'react';
import { copyText } from './core';
import { Ico, I } from './ui';

const LEAD = /^\s*([^:]{2,32}):\s+(?=\S)/;
const FLAG = /\((?:[^)]*\b(unconfirmed|pending|tbc|tbd|to be confirmed)\b[^)]*)\)/i;

/**
 * Splits "A-PR-01 (from PRD, unconfirmed): text" into its code, lead, text and whether it's
 * unconfirmed.
 */
function parseItem(s: string) {
  let rest = String(s || '').trim();
  let code = '',
    lead = '';
  const flag = FLAG.test(rest);
  const c = rest.match(
    /^\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[a-z]?)\s*(\([^)]*\))?\s*[:.\-–—]\s*/,
  );
  if (c) {
    code = c[1];
    rest = rest.slice(c[0].length);
  } else {
    const l = rest.match(LEAD);
    if (l && !/[.?!]/.test(l[1])) {
      lead = l[1];
      rest = rest.slice(l[0].length);
    }
  }
  return { code, lead, text: rest, flag };
}

export function ItemText({ s }: { s: string }) {
  const { code, lead, text, flag } = parseItem(s);
  return (
    <>
      {code && <span className="li-code">{code}</span>}
      {flag && (
        <span className="li-flag" title="Marked as not yet confirmed">
          Unconfirmed
        </span>
      )}
      <span className="li-text">
        {lead && <b>{lead}: </b>}
        {text}
      </span>
    </>
  );
}

export function ListEditor({
  items,
  onChange,
  disabled,
  noun,
  empty,
  limit = 8,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  noun: string;
  empty?: string;
  limit?: number;
}) {
  const [edit, setEdit] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState('');
  const [all, setAll] = useState(false);
  const list = items || [];
  const shown = all ? list : list.slice(0, limit);
  const save = (i: number) => {
    const v = draft.trim();
    onChange(v ? list.map((x, j) => (j === i ? v : x)) : list.filter((_, j) => j !== i));
    setEdit(null);
  };
  const add = () => {
    const v = adding.trim();
    if (!v) return;
    onChange([...list, v]);
    setAdding('');
    if (list.length >= limit) setAll(true);
  };
  return (
    <div className="li">
      {list.length > 0 ? (
        <ol className="li-list">
          {shown.map((s, i) => (
            <li key={i} className={edit === i ? 'editing' : ''}>
              <span className="li-n">{i + 1}</span>
              {edit === i ? (
                <div className="li-edit">
                  <textarea
                    autoFocus
                    rows={3}
                    value={draft}
                    aria-label={`Edit ${noun} ${i + 1}`}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        save(i);
                      }
                      if (e.key === 'Escape') setEdit(null);
                    }}
                  />
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn sm primary" onClick={() => save(i)}>
                      Save
                    </button>
                    <button className="btn sm subtle" onClick={() => setEdit(null)}>
                      Cancel
                    </button>
                    <span className="muted small">Enter to save · Esc to cancel</span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="li-body">
                    <ItemText s={s} />
                  </div>
                  {!disabled && (
                    <span className="li-actions">
                      <button
                        className="icon-btn"
                        title="Edit"
                        aria-label={`Edit ${noun} ${i + 1}`}
                        onClick={() => {
                          setEdit(i);
                          setDraft(s);
                        }}
                      >
                        <Ico svg={I.pencil} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Remove"
                        aria-label={`Remove ${noun} ${i + 1}`}
                        onClick={() => onChange(list.filter((_, j) => j !== i))}
                      >
                        <Ico svg={I.trash} />
                      </button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted small li-empty">{empty || `No ${noun}s.`}</p>
      )}
      <div className="li-foot">
        {list.length > limit && (
          <button className="btn sm subtle" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${list.length}`}
          </button>
        )}
        {list.length > 0 && (
          <button className="btn sm subtle" onClick={() => copyText(list.join('\n'))}>
            <Ico svg={I.copy} />
            Copy
          </button>
        )}
      </div>
      {!disabled && (
        <input
          className="li-add"
          value={adding}
          placeholder={`Add ${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}… (Enter)`}
          aria-label={`Add ${noun}`}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      )}
    </div>
  );
}
