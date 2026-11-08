'use client';
// Administration → Generation → Generation guide: a Markdown document (glossary, conventions, example tickets and
// test cases) that the AI uses as reference context, so generated work matches the team's language and structure.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, toast, openModal, ago, type Any } from './core';
import { Ico, I, Confirm, Spinner, ErrorState } from './ui';
import { TA, CB } from './fields';

export const GUIDE_TEMPLATE = `# Generation guide

## Product
One or two sentences: what the product is and who uses it.

## Glossary
- **Order**: a customer's purchase, with one or more items.
- **Customer** (not "user"): a person buying from the store.

## Roles
- **Admin**: manages products, prices and refunds.
- **Cashier**: takes orders; can't change settings.

## Ticket conventions
- Title: verb + object, e.g. "Export orders to CSV".
- Labels: frontend, backend, api, db.
- Mention the screen or API endpoint in the description.

## Example ticket
**Title:** Export orders to CSV
**User story:** As a store manager, I want to export orders to CSV, so that I can share them with accounting.
**Acceptance criteria:**
1. Given orders in the selected date range, when I click Export CSV, then a CSV with one row per order downloads.
2. Given no orders in the range, when I click Export CSV, then I see "No orders to export" and nothing downloads.
3. Given I'm a cashier, when I open Orders, then I don't see Export CSV.

## Test case conventions
- Use the product "Test Mug" and the customer "QA Customer".
- Expected results describe what's on screen, not what happens in the database.

## Example test case
**Title:** Verify a manager can export orders to CSV
**Preconditions:** Signed in as Admin; at least one order this week.
**Steps:**
1. Open Orders.
2. Choose "This week".
3. Click Export CSV.
**Expected:** A file orders.csv downloads with one row per order.

## Don'ts
- Don't add tickets for analytics, notifications or mobile unless the document asks for them.
`;

// ---------------------------------------------------------------- a small, safe Markdown preview (no HTML injection)
function inline(text: string, key = ''): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0, m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0], k = `${key}-${n++}`;
    if (t.startsWith('**')) out.push(<b key={k}>{t.slice(2, -2)}</b>);
    else if (t.startsWith('`')) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      const lm = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      out.push(lm && /^https?:\/\//.test(lm[2]) ? <a key={k} href={lm[2]} target="_blank" rel="noopener noreferrer">{lm[1]}</a> : t);
    } else out.push(<i key={k}>{t.slice(1, -1)}</i>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const k = `b${i}`;
    if (!l.trim()) { i++; continue; }
    if (l.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={k} className="code">{code.join('\n')}</pre>);
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const H = `h${Math.min(6, h[1].length + 2)}` as Any; blocks.push(<H key={k}>{inline(h[2], k)}</H>); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) { blocks.push(<hr key={k} />); i++; continue; }
    if (/^\s*>/.test(l)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={k}>{inline(q.join(' '), k)}</blockquote>);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push(<table key={k} className="tbl md-tbl"><thead><tr>{rows[0]?.map((c, j) => <th key={j}>{inline(c, `${k}h${j}`)}</th>)}</tr></thead>
        <tbody>{rows.slice(1).map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${k}${ri}${j}`)}</td>)}</tr>)}</tbody></table>);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d+[.)]\s+/.test(l);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
      const L = ordered ? 'ol' : 'ul';
      blocks.push(<L key={k}>{items.map((it, j) => <li key={j}>{inline(it, `${k}${j}`)}</li>)}</L>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*>|\s*\||\s*([-*+]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k}>{para.flatMap((x, j) => (j ? [<br key={`br${j}`} />, ...inline(x, `${k}${j}`)] : inline(x, `${k}${j}`)))}</p>);
  }
  return <div className="md">{blocks}</div>;
}

// ---------------------------------------------------------------- the card
const APPLY: [string, string][] = [['tickets', 'Tickets'], ['tests', 'Test cases'], ['automation', 'Automation scripts']];

export function GuideCard({ onChange }: { onChange?: () => void } = {}) {
  const [data, setData] = useState<Any>(null);
  const [err, setErr] = useState<Any>(null);
  const [draft, setDraft] = useState<Any>(null); // { text, name, applyTo } while editing or after an import
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [busy, setBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const load = async () => { setErr(null); try { setData(await api('/api/admin/generation/guide')); } catch (e: Any) { setErr(e); } };
  useEffect(() => { load(); }, []);
  if (err) return <div className="card wide"><ErrorState compact title="Couldn’t load the generation guide" error={err} onRetry={load} /></div>;
  if (!data) return <div className="card wide"><h3>Generation guide</h3><Spinner /></div>;

  const g = data.guide;
  const max = data.max;
  const cur = draft || (g ? { text: g.text, name: g.name, applyTo: g.applyTo } : null);
  const dirty = Boolean(draft) && (!g || draft.text !== g.text || draft.name !== g.name || JSON.stringify(draft.applyTo) !== JSON.stringify(g.applyTo));
  const start = (text: string, name: string, edit = false) => { setDraft({ text, name, applyTo: g?.applyTo || { tickets: true, tests: true, automation: false } }); setMode(edit ? 'edit' : 'preview'); };
  const importFile = async (f?: File) => {
    if (!f) return;
    if (!/\.(md|markdown|txt)$/i.test(f.name)) { toast('Choose a Markdown file (.md)', 'err'); return; }
    const text = await f.text();
    if (text.length > max) { toast(`That file has ${text.length.toLocaleString()} characters; the limit is ${max.toLocaleString()}. Shorten it first.`, 'err'); return; }
    start(text, f.name);
    toast(`Imported ${f.name}. Review it, then Save guide.`);
  };
  const save = async () => {
    setBusy('save');
    try { setData(await api('/api/admin/generation/guide', { method: 'PUT', body: draft })); setDraft(null); setMode('preview'); onChange?.(); toast('Generation guide saved. New generations use it.'); }
    catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const remove = () => openModal(<Confirm title="Remove the generation guide?" label="Remove" text="The AI stops using it for new generations. Download it first if you want to keep a copy."
    onYes={async () => { setData(await api('/api/admin/generation/guide', { method: 'DELETE' })); setDraft(null); onChange?.(); toast('Generation guide removed'); }} />);
  const download = () => {
    const url = URL.createObjectURL(new Blob([cur.text], { type: 'text/markdown' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: cur.name || 'generation-guide.md' });
    a.click(); URL.revokeObjectURL(url);
  };
  const setApply = (k: string, v: boolean) => setDraft({ ...cur, applyTo: { ...cur.applyTo, [k]: v } });
  const picker = <input ref={fileRef} type="file" hidden accept=".md,.markdown,.txt,text/markdown" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} />;

  return (
    <div className="card wide guide-card">
      <h3>Generation guide</h3>
      <p className="sub">A Markdown document the AI reads before writing: your glossary, roles, conventions and example tickets and test cases. It makes generated work use your words and look the same every time.</p>
      {picker}
      {!cur ? (
        <div className="guide-empty">
          <Ico svg={I.doc} size={28} />
          <div><b>No guide yet</b><div className="muted small">Import a .md file, or start from the template and fill in your own terms and examples.</div></div>
          <div className="row" style={{ gap: 8, marginLeft: 'auto' }}>
            <button className="btn primary" onClick={() => fileRef.current?.click()}><Ico svg={I.upload} />Import .md file</button>
            <button className="btn" onClick={() => start(GUIDE_TEMPLATE, 'generation-guide.md', true)}>Start from the template</button>
          </div>
        </div>
      ) : <>
        <div className="row guide-head">
          <Ico svg={I.doc} /><b>{cur.name}</b>
          <span className={`muted small ${cur.text.length > max ? 'over' : ''}`}>{cur.text.length.toLocaleString()} / {max.toLocaleString()} characters · about {Math.ceil(cur.text.length / 4).toLocaleString()} tokens</span>
          <span className="muted small">{dirty ? <b style={{ color: 'var(--warning)' }}>Not saved</b> : g?.updatedAt ? <>Saved{g.updatedBy ? ` by ${g.updatedBy}` : ''} {ago(g.updatedAt)}</> : null}</span>
          <div className="spacer" />
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={mode === 'preview'} className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>Preview</button>
            <button role="tab" aria-selected={mode === 'edit'} className={mode === 'edit' ? 'on' : ''} onClick={() => { if (!draft) setDraft(cur); setMode('edit'); }}>Edit</button>
          </div>
        </div>
        <div className="row" style={{ gap: 14, margin: '4px 0 8px' }}>
          <span className="small" style={{ fontWeight: 600, color: 'var(--text-subtle)' }}>Use it for</span>
          {APPLY.map(([k, label]) => <CB key={k} label={label} checked={Boolean(cur.applyTo?.[k])} onChange={(e: Any) => setApply(k, e.target.checked)} />)}
        </div>
        {mode === 'edit'
          ? <TA mono spellCheck={false} value={cur.text} max={520} onChange={(e) => setDraft({ ...cur, text: e.target.value })} />
          : <div className="guide-preview"><Markdown text={cur.text} /></div>}
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          {dirty && <button className="btn primary" disabled={!!busy || !cur.text.trim() || cur.text.length > max} onClick={save}>{busy === 'save' ? <><Spinner />Saving…</> : 'Save guide'}</button>}
          {dirty && <button className="btn" disabled={!!busy} onClick={() => { setDraft(null); setMode('preview'); }}>{g ? 'Discard changes' : 'Cancel'}</button>}
          <button className="btn subtle" onClick={() => fileRef.current?.click()}><Ico svg={I.upload} />{g ? 'Replace with a file' : 'Import a file instead'}</button>
          <button className="btn subtle" onClick={download}><Ico svg={I.download} />Download .md</button>
          <div className="spacer" />
          {g && <button className="btn subtle danger-text" disabled={!!busy} onClick={remove}>Remove guide</button>}
        </div>
      </>}
    </div>
  );
}
