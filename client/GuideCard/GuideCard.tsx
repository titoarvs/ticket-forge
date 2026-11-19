'use client';
import { useState, useRef, useEffect } from 'react';
import { type Any, api, toast, openModal, ago } from '../core';
import { ErrorState, Spinner, Confirm, Ico, I } from '../ui';
import { CB, TA } from '../fields';
import { GUIDE_TEMPLATE, Markdown } from './Markdown';

// ---------------------------------------------------------------- the card
const APPLY: [string, string][] = [
  ['tickets', 'Tickets'],
  ['tests', 'Test cases'],
  ['automation', 'Automation scripts'],
];
export function GuideCard({ onChange }: { onChange?: () => void } = {}) {
  const [data, setData] = useState<Any>(null);
  const [err, setErr] = useState<Any>(null);
  const [draft, setDraft] = useState<Any>(null); // { text, name, applyTo } while editing or after an import
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [busy, setBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const load = async () => {
    setErr(null);
    try {
      setData(await api('/api/admin/generation/guide'));
    } catch (e: Any) {
      setErr(e);
    }
  };
  useEffect(() => {
    load();
  }, []);
  if (err)
    return (
      <div className="card wide">
        <ErrorState compact title="Couldn’t load the generation guide" error={err} onRetry={load} />
      </div>
    );
  if (!data)
    return (
      <div className="card wide">
        <h3>Generation guide</h3>
        <Spinner />
      </div>
    );

  const g = data.guide;
  const max = data.max;
  const cur = draft || (g ? { text: g.text, name: g.name, applyTo: g.applyTo } : null);
  const dirty =
    Boolean(draft) &&
    (!g ||
      draft.text !== g.text ||
      draft.name !== g.name ||
      JSON.stringify(draft.applyTo) !== JSON.stringify(g.applyTo));
  const start = (text: string, name: string, edit = false) => {
    setDraft({
      text,
      name,
      applyTo: g?.applyTo || { tickets: true, tests: true, automation: false },
    });
    setMode(edit ? 'edit' : 'preview');
  };
  const importFile = async (f?: File) => {
    if (!f) return;
    if (!/\.(md|markdown|txt)$/i.test(f.name)) {
      toast('Choose a Markdown file (.md)', 'err');
      return;
    }
    const text = await f.text();
    if (text.length > max) {
      toast(
        `That file has ${text.length.toLocaleString()} characters; the limit is ${max.toLocaleString()}. Shorten it first.`,
        'err',
      );
      return;
    }
    start(text, f.name);
    toast(`Imported ${f.name}. Review it, then Save guide.`);
  };
  const save = async () => {
    setBusy('save');
    try {
      setData(await api('/api/admin/generation/guide', { method: 'PUT', body: draft }));
      setDraft(null);
      setMode('preview');
      onChange?.();
      toast('Generation guide saved. New generations use it.');
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const remove = () =>
    openModal(
      <Confirm
        title="Remove the generation guide?"
        label="Remove"
        text="The AI stops using it for new generations. Download it first if you want to keep a copy."
        onYes={async () => {
          setData(await api('/api/admin/generation/guide', { method: 'DELETE' }));
          setDraft(null);
          onChange?.();
          toast('Generation guide removed');
        }}
      />,
    );
  const download = () => {
    const url = URL.createObjectURL(new Blob([cur.text], { type: 'text/markdown' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: cur.name || 'generation-guide.md',
    });
    a.click();
    URL.revokeObjectURL(url);
  };
  const setApply = (k: string, v: boolean) =>
    setDraft({ ...cur, applyTo: { ...cur.applyTo, [k]: v } });
  const picker = (
    <input
      ref={fileRef}
      type="file"
      hidden
      accept=".md,.markdown,.txt,text/markdown"
      onChange={(e) => {
        importFile(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );

  return (
    <div className="card wide guide-card">
      <h3>Generation guide</h3>
      <p className="sub">
        A Markdown document the AI reads before writing: your glossary, roles, conventions and
        example tickets and test cases. It makes generated work use your words and look the same
        every time.
      </p>
      {picker}
      {!cur ? (
        <div className="guide-empty">
          <Ico svg={I.doc} size={28} />
          <div>
            <b>No guide yet</b>
            <div className="muted small">
              Import a .md file, or start from the template and fill in your own terms and examples.
            </div>
          </div>
          <div className="row" style={{ gap: 8, marginLeft: 'auto' }}>
            <button className="btn primary" onClick={() => fileRef.current?.click()}>
              <Ico svg={I.upload} />
              Import .md file
            </button>
            <button
              className="btn"
              onClick={() => start(GUIDE_TEMPLATE, 'generation-guide.md', true)}
            >
              Start from the template
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="row guide-head">
            <Ico svg={I.doc} />
            <b>{cur.name}</b>
            <span className={`muted small ${cur.text.length > max ? 'over' : ''}`}>
              {cur.text.length.toLocaleString()} / {max.toLocaleString()} characters · about{' '}
              {Math.ceil(cur.text.length / 4).toLocaleString()} tokens
            </span>
            <span className="muted small">
              {dirty ? (
                <b style={{ color: 'var(--warning)' }}>Not saved</b>
              ) : g?.updatedAt ? (
                <>
                  Saved{g.updatedBy ? ` by ${g.updatedBy}` : ''} {ago(g.updatedAt)}
                </>
              ) : null}
            </span>
            <div className="spacer" />
            <div className="seg" role="tablist">
              <button
                role="tab"
                aria-selected={mode === 'preview'}
                className={mode === 'preview' ? 'on' : ''}
                onClick={() => setMode('preview')}
              >
                Preview
              </button>
              <button
                role="tab"
                aria-selected={mode === 'edit'}
                className={mode === 'edit' ? 'on' : ''}
                onClick={() => {
                  if (!draft) setDraft(cur);
                  setMode('edit');
                }}
              >
                Edit
              </button>
            </div>
          </div>
          <div className="row" style={{ gap: 14, margin: '4px 0 8px' }}>
            <span className="small" style={{ fontWeight: 600, color: 'var(--text-subtle)' }}>
              Use it for
            </span>
            {APPLY.map(([k, label]) => (
              <CB
                key={k}
                label={label}
                checked={Boolean(cur.applyTo?.[k])}
                onChange={(e: Any) => setApply(k, e.target.checked)}
              />
            ))}
          </div>
          {mode === 'edit' ? (
            <TA
              mono
              spellCheck={false}
              value={cur.text}
              max={520}
              onChange={(e) => setDraft({ ...cur, text: e.target.value })}
            />
          ) : (
            <div className="guide-preview">
              <Markdown text={cur.text} />
            </div>
          )}
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            {dirty && (
              <button
                className="btn primary"
                disabled={!!busy || !cur.text.trim() || cur.text.length > max}
                onClick={save}
              >
                {busy === 'save' ? (
                  <>
                    <Spinner />
                    Saving…
                  </>
                ) : (
                  'Save guide'
                )}
              </button>
            )}
            {dirty && (
              <button
                className="btn"
                disabled={!!busy}
                onClick={() => {
                  setDraft(null);
                  setMode('preview');
                }}
              >
                {g ? 'Discard changes' : 'Cancel'}
              </button>
            )}
            <button className="btn subtle" onClick={() => fileRef.current?.click()}>
              <Ico svg={I.upload} />
              {g ? 'Replace with a file' : 'Import a file instead'}
            </button>
            <button className="btn subtle" onClick={download}>
              <Ico svg={I.download} />
              Download .md
            </button>
            <div className="spacer" />
            {g && (
              <button className="btn subtle danger-text" disabled={!!busy} onClick={remove}>
                Remove guide
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
