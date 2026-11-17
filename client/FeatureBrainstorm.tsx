'use client';
// Add feature with AI, steps 2 to 4. Before any epic or issue is created the feature is worked through:
//   1. Brainstorm: the AI thinks it through (problem, goals, options, risks, open questions) and proposes the epics.
//   2. Documents: each epic gets a Problem Statement, a Feature Brief and an Architecture Record Design, written from the
//      brainstorm; you read, edit and approve each one.
//   3. Issues: written from the approved documents only, with every acceptance scenario of the brief covered.
// Then the review step (FeatureModal) adds the epics, with their approved documents, and the issues.
import { useEffect, useRef, useState } from 'react';
import { P, api, toast, readNdjson, aiBody, uid, me, can, type Any } from './core';
import { Modal, Ico, I, Spinner } from './ui';
import { TA, TF, CB } from './fields';
import { Markdown } from './GuideCard';
import { PsdDocument } from './Psd';
import { syncDocControl } from './Fbd';
import { approvalCheck, approvalStamp, docState, STATE_LABEL, APPROVAL_DOCS, type DocKind } from '../lib/approval';

type Phase = 'thinking' | 'brainstorm' | 'docs' | 'issues';
const KINDS: DocKind[] = ['psd', 'fbd', 'ard'];
const LABEL: Record<string, string> = Object.fromEntries(APPROVAL_DOCS.map((d) => [d.kind, d.label]));

async function stream(path: string, body: Any, signal: AbortSignal, onMsg?: (m: string) => void): Promise<Any> {
  const res = await api(path, { method: 'POST', raw: true, signal, body: aiBody(body) });
  let out: Any = null;
  await readNdjson(res, (ev) => {
    if (ev.type === 'progress' && ev.message) onMsg?.(ev.message);
    else if (ev.type === 'done') out = ev;
    else if (ev.type === 'error') throw new Error(ev.error || ev.message);
  });
  if (!out) throw new Error('The AI didn’t return anything.');
  return out;
}

export function FeatureBrainstorm({ source, opts, answers, onBack, onDone }: { source: Any; opts: Any; answers: string; onBack: () => void; onDone: (result: Any) => void }) {
  const p = P();
  const [phase, setPhase] = useState<Phase>('thinking');
  const [msg, setMsg] = useState('Sending the feature to the AI…');
  const [err, setErr] = useState('');
  const [b, setB] = useState<Any>(null);
  const [notes, setNotes] = useState('');
  const [plan, setPlan] = useState<Any[]>([]);
  const [docs, setDocs] = useState<Record<string, Any>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [openDoc, setOpenDoc] = useState('');
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<Record<string, Any>>({});
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const ctrl = useRef<AbortController>(new AbortController());
  const started = useRef(false);
  const closed = useRef(false);

  // The brainstorm to work from, and the epics to plan. A brainstorm that has no epics (or none came back at all) still
  // plans one epic from the source, with no documents, so the person can carry on by hand.
  const begin = (result: Any) => {
    setB(result);
    const name = String(source.filename || '');
    const eps = result.epics?.length ? result.epics : [{ title: !name || name === 'Feature description' ? 'New feature' : name.replace(/\.[^.]+$/, ''), description: result.summary || '', existing: false }];
    setPlan(eps.map((e: Any) => ({ id: e.id || uid(), title: e.title, description: e.description, existing: Boolean(e.existing), reason: e.reason || '', include: true })));
    // An existing epic that already has its documents starts with them.
    const pre: Record<string, Any> = {};
    for (const e of eps) { const x = e.id && p.epics.find((q: Any) => q.id === e.id); if (x) pre[x.id] = { psd: x.psd, fbd: x.fbd, ard: x.ard }; }
    setDocs(pre);
    setPhase('brainstorm');
  };
  const run = async () => {
    const signal = ctrl.current.signal;
    setErr(''); setPhase('thinking'); setMsg('Brainstorming the feature…');
    try {
      const out = await stream(`/api/projects/${p.id}/brainstorm`, { text: source.text, sourceName: source.filename, answers, instructions: opts.instructions }, signal, setMsg);
      begin(out.result || {});
    } catch (e: Any) {
      // A run that was replaced or closed (a new controller took over) is ignored; every other ending, an abort included, ends the spinner.
      if (e.name === 'AbortError') { if (ctrl.current.signal === signal && !closed.current) setErr('The brainstorm was stopped before it finished.'); }
      else setErr(e.message || 'The brainstorm didn’t finish.');
    }
  };
  // Without the AI's brainstorm (it failed, or you don't want to wait): an empty brainstorm and the source as one epic, to work through by hand.
  const manual = () => begin({ summary: '', epics: [] });
  useEffect(() => {
    closed.current = false;
    // Strict mode runs the cleanup below and then this effect again: the second run gets a fresh controller, so it isn't left aborted.
    if (started.current) ctrl.current = new AbortController();
    started.current = true;
    run();
    return () => { closed.current = true; ctrl.current.abort(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const active = plan.filter((e) => e.include);
  const epicObj = (e: Any) => ({ id: e.id, title: e.title, description: e.description, ...(docs[e.id] || {}) });
  const upd = (id: string, patch: Any) => setPlan((l) => l.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const setDoc = (id: string, k: DocKind, d: Any) => setDocs((m) => ({ ...m, [id]: { ...(m[id] || {}), [k]: d } }));

  const write = async (e: Any, k: DocKind) => {
    const key = `${e.id}:${k}`;
    setBusy((x) => ({ ...x, [key]: true })); setErr('');
    try {
      const out = await stream(`/api/projects/${p.id}/feature-docs`, { kind: k, epic: epicObj(e), brainstorm: b, notes, sourceText: source.text, sourceName: source.filename }, ctrl.current.signal);
      const prev = docs[e.id]?.[k];
      const base = { generatedAt: new Date().toISOString(), generatedBy: me(), version: prev?.version || 'v1.0', status: 'Draft' };
      setDoc(e.id, k, k === 'psd' ? { ...out.psd, ...base } : { markdown: out.markdown, ...base });
      setOpenDoc(key);
      // A document that others build on changed: the ones written from it need a new look.
    } catch (x: Any) { if (x.name !== 'AbortError') setErr(`Couldn’t write the ${LABEL[k]}: ${x.message}`); } finally { setBusy((m) => ({ ...m, [key]: false })); }
  };
  const status = (e: Any, k: DocKind, s: string) => {
    const cur = docs[e.id]?.[k];
    if (!cur) return;
    let next = { ...cur, status: s };
    if (k !== 'psd') next = { ...next, markdown: syncDocControl(k, next.markdown, next.version || 'v1.0', s) };
    setDoc(e.id, k, { ...next, ...approvalStamp(next, me()) });
  };
  const saveEdit = (e: Any, k: 'fbd' | 'ard') => {
    const key = `${e.id}:${k}`;
    setDoc(e.id, k, { ...docs[e.id][k], markdown: edit[key], editedAt: new Date().toISOString(), editedBy: me() });
    setEdit((m) => { const n = { ...m }; delete n[key]; return n; });
  };
  const writeIssues = async (e: Any) => {
    setBusy((x) => ({ ...x, [`${e.id}:issues`]: true })); setErr('');
    try {
      const out = await stream(`/api/projects/${p.id}/epic-issues`, { epicId: e.id, draftEpic: epicObj(e), granularity: opts.granularity, includeTests: opts.includeTests, testsPerTicket: opts.testsPerTicket, instructions: opts.instructions }, ctrl.current.signal);
      setIssues((m) => ({ ...m, [e.id]: out.result }));
      setPick((m) => ({ ...m, ...Object.fromEntries(out.result.tickets.map((t: Any) => [t.id, true])) }));
    } catch (x: Any) { if (x.name !== 'AbortError') setErr(`Couldn’t write the issues for “${e.title}”: ${x.message}`); } finally { setBusy((m) => ({ ...m, [`${e.id}:issues`]: false })); }
  };

  const allApproved = active.length > 0 && active.every((e) => approvalCheck(epicObj(e)).ok);
  const allIssues = active.length > 0 && active.every((e) => issues[e.id]);
  const finish = () => onDone({
    summary: b.summary, openQuestions: [...new Set([...(b.openQuestions || []), ...active.flatMap((e) => issues[e.id]?.openQuestions || [])])],
    epics: active.map((e) => ({ id: e.id, title: e.title, description: e.description, existing: e.existing, docs: docs[e.id] })),
    tickets: active.flatMap((e) => (issues[e.id]?.tickets || []).filter((t: Any) => pick[t.id])), brainstorm: b,
  });
  const working = Object.values(busy).some(Boolean);
  const chosen = active.reduce((n, e) => n + (issues[e.id]?.tickets || []).filter((t: Any) => pick[t.id]).length, 0);

  // ---------------------------------------------------------------- views
  const steps = <div className="seg" role="tablist" style={{ marginBottom: 10 }}>{([['brainstorm', '1 Brainstorm'], ['docs', '2 Documents'], ['issues', '3 Issues']] as [Phase, string][]).map(([k, l]) => (
    <button key={k} role="tab" aria-selected={phase === k} className={phase === k ? 'on' : ''} disabled={phase === 'thinking' || (k !== 'brainstorm' && !active.length)} onClick={() => setPhase(k)}>{l}</button>))}</div>;

  if (phase === 'thinking') {
    return (
      <Modal title="Add feature with AI" wide persistent left={<button className="btn subtle" onClick={() => { ctrl.current.abort(); onBack(); }}>Back</button>} actions={[{ label: 'Cancel', onClick: () => ctrl.current.abort() }]}>
        {err ? <><div className="warn-banner danger"><Ico svg={I.warn} /><span>{err}</span></div><div className="row" style={{ marginTop: 10, gap: 8 }}><button className="btn" onClick={() => { ctrl.current = new AbortController(); run(); }}>Try again</button><button className="btn subtle" onClick={manual}>Continue manually</button></div></>
          : <div className="progress-box"><div className="pbar"><i /></div><ul className="log"><li><Spinner /><span>{msg}</span></li></ul>
            <p className="muted small" style={{ margin: '6px 0 0' }}>Before anything is created the feature is brainstormed: the problem, options, risks and the epics it needs. Then each epic gets a Problem Statement, a Feature Brief and an Architecture Record that you approve.</p></div>}
      </Modal>
    );
  }

  const header = <>{steps}{err && <div className="warn-banner danger"><Ico svg={I.warn} /><span>{err}</span></div>}</>;
  const left = <button className="btn subtle" disabled={working} onClick={onBack}>Back</button>;

  if (phase === 'brainstorm') {
    const List = ({ title, items }: { title: string; items?: string[] }) => (items?.length ? <div style={{ marginBottom: 8 }}><b className="small">{title}</b><ul className="small" style={{ margin: '2px 0 0', paddingLeft: 18 }}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null);
    return (
      <Modal title="Brainstorm the feature" wide persistent left={left} actions={[{ label: 'Cancel' }, { label: `Write the documents for ${active.length} epic${active.length === 1 ? '' : 's'}`, kind: 'primary', disabled: !active.length || active.some((e) => !e.title.trim()), onClick: () => setPhase('docs') }]}>
        {header}
        <p style={{ marginTop: 0 }}>{b.summary}</p>
        {b.problem && <p className="small"><b>The problem.</b> {b.problem}</p>}
        <div className="grid2"><List title="Goals" items={b.goals} /><List title="Not in scope" items={b.nonGoals} /></div>
        {b.personas?.length > 0 && <List title="Who it is for" items={b.personas.map((x: Any) => `${x.who}: ${x.need}`)} />}
        {b.options?.length > 0 && <div style={{ marginBottom: 8 }}><b className="small">Options</b>{b.options.map((o: Any, i: number) => (
          <div key={i} className="card" style={{ padding: 8, margin: '4px 0' }}><b className="small">{o.name}</b>{o.recommended && <span className="loz t-pass" style={{ marginLeft: 6 }}>Recommended</span>}
            <div className="small muted">+ {o.pros.join(' · ') || '–'}<br />− {o.cons.join(' · ') || '–'}</div></div>))}</div>}
        {b.risks?.length > 0 && <List title="Risks" items={b.risks.map((r: Any) => `${r.risk} → ${r.mitigation}`)} />}
        <div className="grid2"><List title="Assumptions to confirm" items={b.assumptions} /><List title="Open questions" items={b.openQuestions} /></div>
        <label className="field"><span>Your decisions and answers (optional)</span>
          <TA rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Go with option 2. Only admins can see it. No email notifications in the first version. They override the brainstorm in every document." /></label>
        <h4 style={{ margin: '12px 0 4px' }}>Epics for this feature</h4>
        <p className="muted small" style={{ margin: '0 0 6px' }}>Each epic gets its own Problem Statement, Feature Brief and Architecture Record, approved before any issue is written.</p>
        {plan.map((e) => (
          <div key={e.id} className="card" style={{ padding: 8, marginBottom: 6 }}>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <CB label="" checked={e.include} onChange={(ev: Any) => upd(e.id, { include: ev.target.checked })} />
              <TF value={e.title} disabled={e.existing} onChange={(ev) => upd(e.id, { title: ev.target.value })} aria-label="Epic title" />
              <span className={`loz ${e.existing ? '' : 't-pass'}`}>{e.existing ? 'Existing epic' : 'New epic'}</span>
            </div>
            {!e.existing && <TA rows={2} value={e.description} onChange={(ev) => upd(e.id, { description: ev.target.value })} aria-label="Epic description" />}
            {e.reason && <div className="muted small">{e.reason}</div>}
          </div>))}
      </Modal>
    );
  }

  if (phase === 'docs') {
    return (
      <Modal title="Documents for the new work" wide persistent left={left} actions={[{ label: 'Cancel' }, { label: 'Write the issues', kind: 'primary', disabled: !allApproved || working, onClick: () => setPhase('issues') }]}>
        {header}
        <p className="muted small" style={{ marginTop: 0 }}>Write each document from the brainstorm, read and edit it, then approve it. Issues are written only from approved documents.{!allApproved && ' Approve all three for every epic to continue.'}</p>
        {active.map((e) => {
          const chk = approvalCheck(epicObj(e));
          return (
            <div key={e.id} className="feat-epic" style={{ marginBottom: 10 }}>
              <div className="feat-epic-h"><b>{e.title}</b><span className="muted small" style={{ marginLeft: 'auto' }}>{chk.docs.filter((d: Any) => d.state === 'approved').length} of 3 approved</span></div>
              {KINDS.map((k) => {
                const d = docs[e.id]?.[k];
                const st = docState(epicObj(e), k);
                const key = `${e.id}:${k}`;
                const isMd = k !== 'psd';
                const needs = k === 'fbd' && !docs[e.id]?.psd ? 'Write the Problem Statement first (the brief builds on it).' : k === 'ard' && !docs[e.id]?.fbd ? 'Write the Feature Brief first (the architecture builds on it).' : '';
                return (
                  <div key={k} style={{ padding: '6px 0', borderTop: '1px solid var(--border, #2a2f3a)' }}>
                    <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <b style={{ fontWeight: 500, minWidth: 190 }}>{LABEL[k]}</b>
                      <span className={`psd-status ${st === 'approved' ? 'ok' : ''}`}>{STATE_LABEL[st]}</span>
                      <span style={{ marginLeft: 'auto' }} className="row">
                        {busy[key] ? <span className="small muted"><Spinner /> Writing…</span> : <>
                          <button className="btn sm ai" disabled={working || Boolean(needs)} title={needs} onClick={() => write(e, k)}><Ico svg={I.sparkle} />{d ? 'Rewrite' : 'Write'}</button>
                          {d && <button className="btn sm subtle" onClick={() => setOpenDoc(openDoc === key ? '' : key)}>{openDoc === key ? 'Hide' : 'Read'}</button>}
                          {d && can('epic.manage') && st !== 'approved' && <button className="btn sm" disabled={working} onClick={() => status(e, k, 'Approved')}><Ico svg={I.check} />Approve</button>}
                          {d && st === 'approved' && <button className="btn sm subtle" onClick={() => status(e, k, 'Draft')}>Withdraw</button>}</>}
                      </span>
                    </div>
                    {needs && !d && <div className="muted small">{needs}</div>}
                    {d && openDoc === key && <div style={{ marginTop: 6 }}>
                      {isMd ? (edit[key] !== undefined
                        ? <><TA rows={16} value={edit[key]} onChange={(ev) => setEdit({ ...edit, [key]: ev.target.value })} spellCheck /><div className="row" style={{ marginTop: 6 }}><button className="btn sm primary" onClick={() => saveEdit(e, k as 'fbd' | 'ard')}>Save changes</button><button className="btn sm subtle" onClick={() => { const n = { ...edit }; delete n[key]; setEdit(n); }}>Discard</button></div></>
                        : <><div className="fbd-doc" style={{ maxHeight: 360, overflow: 'auto' }}><Markdown text={d.markdown} /></div><button className="btn sm subtle" style={{ marginTop: 6 }} onClick={() => setEdit({ ...edit, [key]: d.markdown })}>Edit</button></>)
                        : <div style={{ maxHeight: 360, overflow: 'auto' }}><PsdDocument psd={d} /></div>}
                      {st === 'changed' && <div className="warn-banner" style={{ marginTop: 6 }}><Ico svg={I.warn} /><span>Edited after it was approved: approve it again.</span></div>}
                    </div>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </Modal>
    );
  }

  return (
    <Modal title="Issues from the approved documents" wide persistent left={left} actions={[{ label: 'Cancel' }, { label: chosen ? `Review ${chosen} issue${chosen === 1 ? '' : 's'}` : 'Review', kind: 'primary', disabled: !allIssues || !chosen || working, onClick: finish }]}>
      {header}
      <p className="muted small" style={{ marginTop: 0 }}>Issues are written from each epic’s approved documents: every acceptance scenario of the Feature Brief is covered and the technical scope follows the Architecture Record.</p>
      {active.map((e) => {
        const r = issues[e.id];
        return (
          <div key={e.id} className="feat-epic" style={{ marginBottom: 10 }}>
            <div className="feat-epic-h"><b>{e.title}</b>
              <span style={{ marginLeft: 'auto' }}>{busy[`${e.id}:issues`] ? <span className="small muted"><Spinner /> Writing…</span>
                : <button className="btn sm ai" disabled={working || !approvalCheck(epicObj(e)).ok} onClick={() => writeIssues(e)}><Ico svg={I.sparkle} />{r ? 'Write again' : 'Write the issues'}</button>}</span></div>
            {r && <>
              {r.summary && <p className="small" style={{ margin: '4px 0' }}>{r.summary}</p>}
              {r.uncovered?.length > 0 && <div className="warn-banner"><Ico svg={I.warn} /><span>No issue covers {r.uncovered.join(', ')}.</span></div>}
              {r.coverage?.length > 0 && !r.uncovered?.length && <div className="ok-banner"><Ico svg={I.check} /><span>All {r.coverage.length} acceptance scenarios are covered.</span></div>}
              {r.tickets.map((t: Any) => (
                <label key={t.id} className="feat-row" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
                  <input type="checkbox" checked={Boolean(pick[t.id])} onChange={(ev) => setPick({ ...pick, [t.id]: ev.target.checked })} />
                  <span style={{ flex: 1 }}>{t.title}</span><span className="muted small">{t.type}{t.storyPoints ? ` · ${t.storyPoints} pts` : ''}{t.testCases?.length ? ` · ${t.testCases.length} tests` : ''}</span>
                </label>))}
            </>}
          </div>
        );
      })}
    </Modal>
  );
}
