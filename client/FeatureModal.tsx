'use client';
// Add feature: new epics and issues (with test cases) for an existing project, from a description or a document.
// The AI knows the project's epics and issues, so it reuses epics and doesn't repeat issues. You review the plan and
// pick what to add; nothing changes until you do (and it can be undone).
import { useRef, useState } from 'react';
import { S, P, api, toast, closeModal, mutate, readNdjson, can, newTicket, nextEpicKey, withIds, COLORS, aiBody, uid, nowIso, me, keepsOriginal, uploadOriginal, type Any } from './core';
import { Modal, Ico, I, Spinner, TypeIcon, EmptyState } from './ui';
import { TF, TA, SF, CB, MenuItem } from './fields';

type Step = 'input' | 'running' | 'review';

export function FeatureModal({ initialDoc, sourceId }: { initialDoc?: { filename: string; text: string }; sourceId?: string } = {}) {
  const p = P();
  const std = S.status?.generation?.testsPerTicket || 3;
  const [step, setStep] = useState<Step>('input');
  const [mode, setMode] = useState<'describe' | 'document'>(initialDoc ? 'document' : 'describe');
  const [text, setText] = useState('');
  const [doc, setDoc] = useState<Any>(initialDoc || null);
  const [reading, setReading] = useState(false);
  const [opts, setOpts] = useState({ granularity: 'balanced', includeTests: true, testsPerTicket: std, instructions: '' });
  const [log, setLog] = useState<Any[]>([]);
  const [chars, setChars] = useState(0);
  const [result, setResult] = useState<Any>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const ctrl = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const source = mode === 'document' ? doc : (text.trim() ? { filename: 'Feature description', text: text.trim() } : null);
  const upload = async (file?: File) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setReading(true);
    try { const r = await api('/api/parse', { method: 'POST', body: fd }); setDoc({ filename: r.filename, text: r.text, file: keepsOriginal(file) ? file : null }); }
    catch (e: Any) { toast(e.message, 'err'); } finally { setReading(false); }
  };
  const generate = async () => {
    if (!source || source.text.length < 15) { toast('Describe the feature in a sentence or two, or add a document.', 'err'); return; }
    ctrl.current = new AbortController();
    setStep('running'); setLog([{ message: `Sending “${source.filename}” to the AI…` }]); setChars(0);
    const push = (message: string, level?: string) => setLog((l) => [...l.map((x) => ({ ...x, done: true })), { message, level }]);
    try {
      const res = await api(`/api/projects/${p.id}/feature`, { method: 'POST', raw: true, signal: ctrl.current.signal, body: aiBody({ text: source.text, sourceName: source.filename, options: opts }) });
      let out: Any = null;
      await readNdjson(res, (ev) => {
        if (ev.type === 'progress') { if (ev.progressChars) setChars(ev.progressChars); if (ev.message) { setChars(0); push(ev.message, ev.level); } }
        else if (ev.type === 'done') out = ev.result;
        else if (ev.type === 'error') throw new Error(ev.error || ev.message);
      });
      if (!out) throw new Error('The AI didn’t return a plan.');
      setResult(out);
      setPick(Object.fromEntries(out.tickets.map((t: Any) => [t.id, true])));
      setStep('review');
    } catch (e: Any) {
      if (e.name === 'AbortError') { setStep('input'); toast('Cancelled'); return; }
      push(`Couldn’t plan the feature: ${e.message}`, 'err');
    }
  };

  // ---------------------------------------------------------------- add the chosen issues
  const chosen = result ? result.tickets.filter((t: Any) => pick[t.id]) : [];
  const canEpic = can('epic.manage');
  const newEpics = result ? result.epics.filter((e: Any) => !e.existing && chosen.some((t: Any) => t.epicId === e.id)) : [];
  const add = () => {
    const created: string[] = [], issueIds: string[] = [], epicIds = new Set<string>();
    const newSourceId = uid();
    mutate((pp) => {
      if (canEpic) for (const e of newEpics) pp.epics.push({ id: e.id, key: nextEpicKey(), title: e.title, description: e.description, color: COLORS[pp.epics.length % COLORS.length] });
      for (const t of chosen) {
        const lostEpic = !canEpic && newEpics.some((e: Any) => e.id === t.epicId);
        const nt = newTicket({
          title: t.title, type: t.type, priority: t.priority, storyPoints: t.storyPoints, labels: t.labels, userStory: t.userStory,
          description: t.description, acceptanceCriteria: t.acceptanceCriteria, dependencies: t.dependencies, testCases: withIds(t.testCases),
          epicId: lostEpic ? null : t.epicId,
        });
        nt.history[0].text = `created the issue with AI (Add feature: ${source?.filename || 'description'})`;
        pp.tickets.push(nt);
        created.push(nt.key); issueIds.push(nt.id);
        if (nt.epicId) epicIds.add(nt.epicId);
      }
      // Keep the document (or description) with the project, linked to the work it produced.
      pp.sources ??= [];
      if (sourceId === 'original') { // more work planned from the initial document: link it there
        pp.sourceIssueIds = [...new Set([...(pp.sourceIssueIds || []), ...issueIds])];
        pp.sourceEpicIds = [...new Set([...(pp.sourceEpicIds || []), ...epicIds])];
        return;
      }
      const prev = sourceId && pp.sources.find((x: Any) => x.id === sourceId);
      const run = { at: nowIso(), by: me(), summary: result.summary || '', openQuestions: result.openQuestions || [], issueIds, epicIds: [...epicIds] };
      if (prev) { prev.runs = [...(prev.runs || []), run]; prev.summary ||= run.summary; prev.openQuestions = [...new Set([...(prev.openQuestions || []), ...run.openQuestions])]; prev.issueIds = [...new Set([...(prev.issueIds || []), ...issueIds])]; prev.epicIds = [...new Set([...(prev.epicIds || []), ...epicIds])]; }
      else pp.sources.push({ id: newSourceId, name: source?.filename || 'Feature description', kind: mode === 'document' ? 'document' : 'description', text: source?.text || '',
        addedAt: run.at, addedBy: run.by, summary: run.summary, openQuestions: run.openQuestions, issueIds, epicIds: [...epicIds], runs: [run] });
    });
    closeModal();
    // Keep the original PDF or Word file with the new document entry (in the background).
    const file = mode === 'document' && !sourceId ? doc?.file : null;
    if (file) uploadOriginal(p.id, file).then((meta: Any) => mutate((pp) => { const d = (pp.sources || []).find((x: Any) => x.id === newSourceId); if (d) d.file = meta; }))
      .catch(() => toast('The issues were added, but the original file couldn’t be kept. You can attach it on the Source documents page.', 'err'));
    toast(`Added ${created.length} issue${created.length === 1 ? '' : 's'} (${created[0]}${created.length > 1 ? `–${created[created.length - 1]}` : ''})${canEpic && newEpics.length ? ` and ${newEpics.length} new epic${newEpics.length === 1 ? '' : 's'}` : ''} to the backlog`);
  };

  // ---------------------------------------------------------------- views
  if (step === 'running') {
    return (
      <Modal title="Add feature with AI" wide persistent actions={[{ label: 'Cancel', onClick: () => ctrl.current?.abort() }]}>
        <div className="progress-box">
          <div className="pbar"><i /></div>
          <ul className="log">{log.map((l, i) => <li key={i} className={l.level || ''}>{l.level === 'err' || l.level === 'warn' ? <Ico svg={I.warn} /> : l.done ? <Ico svg={I.check} className="ok" /> : <Spinner />}<span>{l.message}</span></li>)}</ul>
          {chars > 0 && <p className="muted small" style={{ margin: '6px 0 0' }}>Writing… {chars.toLocaleString()} characters so far</p>}
          {log.some((l) => l.level === 'err') && <button className="btn" style={{ marginTop: 10 }} onClick={() => setStep('input')}>Back</button>}
        </div>
      </Modal>
    );
  }

  if (step === 'review' && result) {
    const byEpic = result.epics.map((e: Any) => ({ e, items: result.tickets.filter((t: Any) => t.epicId === e.id) })).filter((g: Any) => g.items.length);
    return (
      <Modal title="Review the new work" wide persistent left={<button className="btn subtle" onClick={() => setStep('input')}>Back</button>}
        actions={[{ label: 'Cancel' }, { label: chosen.length ? `Add ${chosen.length} issue${chosen.length === 1 ? '' : 's'}${canEpic && newEpics.length ? ` and ${newEpics.length} epic${newEpics.length === 1 ? '' : 's'}` : ''}` : 'Add', kind: 'primary', disabled: !chosen.length, onClick: add }]}>
        {result.summary && <p style={{ marginTop: 0 }}>{result.summary}</p>}
        {result.openQuestions?.length > 0 && <details className="feat-q"><summary className="small">{result.openQuestions.length} open question{result.openQuestions.length === 1 ? '' : 's'} to raise</summary>
          <ul className="small">{result.openQuestions.map((q: string, i: number) => <li key={i}>{q}</li>)}</ul></details>}
        {!result.tickets.length && <EmptyState compact icon={I.search} tone="neutral" title="Nothing new to add"><p>The AI found that the project already covers this. Try describing what’s different.</p></EmptyState>}
        {!canEpic && result.epics.some((e: Any) => !e.existing) && <div className="warn-banner"><Ico svg={I.warn} /><span>Your role can’t create epics, so issues planned for new epics are added without an epic.</span></div>}
        {byEpic.map(({ e, items }: Any) => {
          const all = items.every((t: Any) => pick[t.id]);
          return (
            <div key={e.id} className="feat-epic">
              <label className="feat-epic-h">
                <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = !all && items.some((t: Any) => pick[t.id]); }}
                  onChange={(ev) => setPick({ ...pick, ...Object.fromEntries(items.map((t: Any) => [t.id, ev.target.checked])) })} />
                <TypeIcon type="Epic" /><b>{e.title}</b>
                <span className={`loz ${e.existing ? '' : 't-pass'}`}>{e.existing ? 'Existing epic' : 'New epic'}</span>
                <span className="muted small" style={{ marginLeft: 'auto' }}>{items.filter((t: Any) => pick[t.id]).length} of {items.length}</span>
              </label>
              {!e.existing && e.description && <p className="muted small feat-desc">{e.description}</p>}
              {items.map((t: Any) => (
                <div key={t.id} className={`feat-row ${pick[t.id] ? '' : 'off'}`}>
                  <input type="checkbox" checked={Boolean(pick[t.id])} onChange={(ev) => setPick({ ...pick, [t.id]: ev.target.checked })} aria-label={`Add ${t.title}`} />
                  <button type="button" className="feat-main" onClick={() => setOpen({ ...open, [t.id]: !open[t.id] })} aria-expanded={Boolean(open[t.id])}>
                    <TypeIcon type={t.type} /><span className="feat-title">{t.title}</span>
                    <span className="muted small">{t.storyPoints ?? '–'} pts · {t.acceptanceCriteria.length} AC · {t.testCases.length} tests</span>
                    <Ico svg={I.chevron} className={open[t.id] ? 'up' : ''} />
                  </button>
                  {open[t.id] && <div className="feat-detail small">
                    {t.userStory && <p><i>{t.userStory}</i></p>}
                    <ol>{t.acceptanceCriteria.map((a: string, i: number) => <li key={i}>{a}</li>)}</ol>
                    {t.testCases.length > 0 && <p className="muted" style={{ margin: '4px 0 0' }}>Tests: {t.testCases.map((x: Any) => x.title).join(' · ')}</p>}
                  </div>}
                </div>
              ))}
            </div>
          );
        })}
        <p className="muted small" style={{ marginBottom: 0 }}>New issues go to the backlog with the next keys ({p.key}-…). You can undo this with ⌘Z.</p>
      </Modal>
    );
  }

  return (
    <Modal title="Add feature with AI" wide actions={[{ label: 'Cancel' }, { label: '✨ Plan the work', kind: 'primary', disabled: !source || reading, onClick: generate }]}>
      <p style={{ marginTop: 0 }}>Describe a new feature, or import a document. The AI plans epics and issues{opts.includeTests ? ' with test cases' : ''} that fit <b>{p.name}</b>: it knows its {p.epics.length} epic{p.epics.length === 1 ? '' : 's'} and {p.tickets.length} issue{p.tickets.length === 1 ? '' : 's'}, adds to existing epics where they fit and doesn’t repeat work. You review everything before it’s added.</p>
      <div className="seg" role="tablist" style={{ marginBottom: 12 }}>
        <button role="tab" aria-selected={mode === 'describe'} className={mode === 'describe' ? 'on' : ''} onClick={() => setMode('describe')}>Describe it</button>
        <button role="tab" aria-selected={mode === 'document'} className={mode === 'document' ? 'on' : ''} onClick={() => setMode('document')}>Import a document</button>
      </div>
      {mode === 'describe'
        ? <label className="field"><span>What should the feature do?</span>
            <TA autoFocus style={{ minHeight: 120 }} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={'e.g. Customers can save items to a wishlist, share it with a link, and get an email when a wishlist item goes on sale.'} /></label>
        : <div className="feat-doc">
            <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.md,.markdown,.txt,.html,.htm,.csv,.json" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            {doc ? <div className="row" style={{ gap: 8 }}><Ico svg={I.doc} /><b>{doc.filename}</b><span className="muted small">{doc.text.split(/\s+/).length.toLocaleString()} words</span>
                <button className="btn sm subtle" onClick={() => fileRef.current?.click()}>Replace</button><button className="btn sm subtle" onClick={() => setDoc(null)}>Remove</button></div>
              : <button className="btn" disabled={reading} onClick={() => fileRef.current?.click()}>{reading ? <><Spinner />Reading…</> : <><Ico svg={I.upload} />Choose a document</>}</button>}
            <p className="muted small" style={{ margin: '8px 0 0' }}>PDF, Word (.docx), Markdown, text or HTML: a spec, PRD or change request for the new work.</p>
          </div>}
      <div className="grid2" style={{ marginTop: 12 }}>
        <label className="field"><span>Issue size</span><SF value={opts.granularity} onChange={(e) => setOpts({ ...opts, granularity: e.target.value })}>
          <MenuItem value="coarse">Fewer, larger issues</MenuItem><MenuItem value="balanced">Balanced</MenuItem><MenuItem value="fine">Many small issues</MenuItem></SF></label>
        <label className="field"><span>Test cases per issue{opts.testsPerTicket === std ? ' (team standard)' : ''}</span>
          <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
            <CB checked={opts.includeTests} onChange={(e: Any) => setOpts({ ...opts, includeTests: e.target.checked })} label="" />
            <TF type="number" disabled={!opts.includeTests} value={opts.testsPerTicket} slotProps={{ htmlInput: { min: 1, max: 15 } }} onChange={(e) => setOpts({ ...opts, testsPerTicket: Number(e.target.value) || std })} />
          </div></label>
      </div>
      <label className="field"><span>Extra instructions (optional)</span>
        <TA style={{ minHeight: 44 }} value={opts.instructions} onChange={(e) => setOpts({ ...opts, instructions: e.target.value })} placeholder="e.g. Put everything in the Checkout epic. Label backend work api." /></label>
    </Modal>
  );
}
