'use client';
// Code jobs page → Coding: where a project's code gets written. Pick a feature (epic), see its tickets with their coding
// state and coding spec, and start code per ticket (its code panel: start, review, pull request) or for many at once
// (the bulk dialog, which checks for tickets that touch the same code first and splits them into rounds).
import { useEffect, useMemo, useState } from 'react';
import { S, P, can, isDone, useStore, type Any } from './core';
import { Ico, I, LayerChip, PriorityIcon, StatusLoz } from './ui';
import { TF, SF, MenuItem } from './fields';
import { listSpecs } from './api/specs';
import { CodeChip, codeInfo, finishedCode } from './codeStatus';
import { openCode } from './DevCode';
import { canWriteCode, openBulkCode, openDevOrder } from './DevPlan';

const NO_EPIC = '__none';
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

export function CodingBoard() {
  useStore();
  const p = P();
  const [epicId, setEpicId] = useState<string>(() => store.get(`tf.coding.epic.${p?.id}`) || '');
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [specs, setSpecs] = useState<Record<string, Any>>({});
  const [open, setOpen] = useState(() => store.get('tf.coding.open') !== '0');
  useEffect(() => { if (p?.id) listSpecs(p.id, '').then((d: Any) => setSpecs(Object.fromEntries((d.specs || []).map((s: Any) => [s.ticketId, s])))).catch(() => setSpecs({})); }, [p?.id]);
  const epics = useMemo(() => (p?.epics || []).filter((e: Any) => !e.draft), [p?.epics]);
  // The first feature with work left, when none was chosen before.
  useEffect(() => {
    if (!p || epicId) return;
    const first = epics.find((e: Any) => p.tickets.some((t: Any) => t.epicId === e.id && !t.parentId && !isDone(t)));
    if (first) setEpicId(first.id);
  }, [p?.id, epics.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return null;
  const choose = (id: string) => { setEpicId(id); setPicked(new Set()); store.set(`tf.coding.epic.${p.id}`, id); };
  const toggleOpen = () => { setOpen(!open); store.set('tf.coding.open', open ? '0' : '1'); };
  const ok = canWriteCode();
  const inEpic = (t: Any) => (epicId === NO_EPIC ? !t.epicId : !epicId || t.epicId === epicId);
  const all = p.tickets.filter((t: Any) => !t.parentId && inEpic(t));
  const todo = (t: Any) => !isDone(t) && !finishedCode(t) && codeInfo(t).state !== 'working';
  const needle = q.trim().toLowerCase();
  const rows = all.filter((t: Any) => (showAll || todo(t) || codeInfo(t).state) && (!needle || `${t.key} ${t.title}`.toLowerCase().includes(needle)));
  const codable = rows.filter(todo);
  const sel = codable.filter((t: Any) => picked.has(t.id));
  const allPicked = codable.length > 0 && sel.length === codable.length;
  const flip = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const count = (e: Any) => p.tickets.filter((t: Any) => !t.parentId && (e ? t.epicId === e : !t.epicId) && todo(t)).length;
  const done = all.filter((t: Any) => finishedCode(t) || isDone(t)).length;
  const working = all.filter((t: Any) => codeInfo(t).state === 'working').length;
  const epic = epics.find((e: Any) => e.id === epicId);
  const specTag = (t: Any) => { const s = specs[t.id]; return s ? <span className={`cb-spec ${s.status === 'ready' ? 'ok' : ''}`} title={s.files?.length ? s.files.map((f: Any) => f.path).join('\n') : 'No files listed'}>Spec {s.status === 'ready' ? 'ready' : 'draft'}{s.files?.length ? ` · ${s.files.length} files` : ''}</span> : null; };

  return (
    <section className="card coding-board" aria-label="Coding">
      <header className="cb-head">
        <button className="cb-toggle" aria-expanded={open} onClick={toggleOpen}><Ico svg={I.chevron} /><h3>Coding</h3></button>
        <span className="muted small">{epicId === '' ? 'All features' : epic ? epic.title : 'Tickets without a feature'}: {all.length} tickets · {done} coded{working ? ` · ${working} being coded` : ''} · {all.length - done - working} to code</span>
        {all.length > 0 && <span className="cb-progress" aria-hidden><span style={{ width: `${Math.round((done / all.length) * 100)}%` }} /><span className="w" style={{ width: `${Math.round((working / all.length) * 100)}%` }} /></span>}
      </header>
      {open && <>
        {!ok && <div className="warn-banner" style={{ marginTop: 10 }}><Ico svg={I.warn} /><span>{!can('ai.use') || !can('issue.edit') ? 'Starting code needs the Use AI and Edit issues permissions.'
          : <>Set up Write code with AI first: your local repository folder or the GitHub repository, in <a href={`/p/${p.id}/settings`} onClick={() => { (S as Any).setTab = 'code'; }}>Project settings → Code &amp; GitHub</a>.</>}</span></div>}
        <div className="cb-bar">
          <SF searchable value={epicId} onChange={(e: Any) => choose(String(e.target.value))} aria-label="Feature (epic)" sx={{ minWidth: 260 }}>
            <MenuItem value="">All features ({count('') + epics.reduce((n: number, e: Any) => n + count(e.id), 0)} to code)</MenuItem>
            {epics.map((e: Any) => <MenuItem key={e.id} value={e.id}>{e.key ? `${e.key} · ` : ''}{e.title} ({count(e.id)} to code)</MenuItem>)}
            <MenuItem value={NO_EPIC}>Tickets without a feature ({count('')})</MenuItem></SF>
          <TF search sx={{ width: 220 }} placeholder="Find a ticket" value={q} onChange={(e: Any) => setQ(e.target.value)} />
          <label className="cb-check small"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Show done tickets</label>
          <span className="spacer" />
          {epic && <button className="btn" onClick={() => openDevOrder({ epicId: epic.id, title: epic.title })} title="The order to build this feature’s tickets in, with a reason for each"><Ico svg={I.up} />Development order</button>}
          <button className="btn ai" disabled={!ok || !(sel.length || codable.length)} onClick={() => openBulkCode((sel.length ? sel : codable).map((t: Any) => t.id))}
            title="One code job per ticket, checked first for tickets that touch the same code"><Ico svg={I.sparkle} />{sel.length ? `Write code for ${sel.length} selected` : `Write code for all ${codable.length}`}</button>
        </div>
        {!rows.length ? <p className="muted small cb-empty">{all.length ? 'Every ticket here is coded or done. Tick “Show done tickets” to see them.' : 'No tickets here yet.'}</p> : (
          <div className="cb-table" role="table" aria-label="Tickets to code">
            <div className="cb-row cb-th" role="row">
              <span role="columnheader"><input type="checkbox" aria-label="Select all to code" disabled={!codable.length} checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(codable.map((t: Any) => t.id)))} /></span>
              <span role="columnheader">Ticket</span><span role="columnheader">Status</span><span role="columnheader">Code</span><span role="columnheader" />
            </div>
            {rows.map((t: Any) => {
              const c = codeInfo(t), can2 = todo(t);
              return <div key={t.id} className={`cb-row ${picked.has(t.id) ? 'on' : ''}`} role="row">
                <span role="cell"><input type="checkbox" aria-label={`Select ${t.key}`} disabled={!can2} checked={picked.has(t.id)} onChange={() => flip(t.id)} /></span>
                <span role="cell" className="cb-ticket">
                  <span className="cb-l1"><code>{t.key}</code><span className="cb-title" title={t.title}>{t.title}</span></span>
                  <span className="cb-l2 muted small"><PriorityIcon p={t.priority} />{t.priority}{t.storyPoints != null && <> · {t.storyPoints} pts</>} · {(t.acceptanceCriteria || []).length} AC<LayerChip layer={t.layer} short />{specTag(t)}</span>
                </span>
                <span role="cell"><StatusLoz s={t.status} /></span>
                <span role="cell">{c.state ? <CodeChip t={t} /> : <span className="muted small">Not coded</span>}</span>
                <span role="cell" className="cb-act">{finishedCode(t) || c.state === 'working'
                  ? <button className="btn sm" onClick={() => openCode(t)} title={c.title}>{c.state === 'working' ? 'Watch' : c.state === 'review' ? 'Review' : 'View code'}</button>
                  : <button className="btn sm ai" disabled={!ok || isDone(t)} onClick={() => openCode(t)} title="Start the AI agent, review its changes, then open the pull request"><Ico svg={I.sparkle} />{c.state === 'failed' ? 'Retry' : 'Write code'}</button>}</span>
              </div>;
            })}
          </div>)}
      </>}
    </section>
  );
}
