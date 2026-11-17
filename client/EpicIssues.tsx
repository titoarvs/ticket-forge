'use client';
// Issues from an epic's approved documents. The Problem Statement, Feature Brief and Architecture Record Design must all
// be approved first (lib/approval.ts); the AI then writes the epic's issues from them, with every acceptance scenario
// of the brief covered, and the person reviews the result and adds what they choose.
import { useState } from 'react';
import { P, api, can, mutate, toast, openModal, closeModal, readNdjson, aiBody, startTask, newTicket, withIds, type Any } from './core';
import { Ico, I, Modal } from './ui';
import { TA, SF, MenuItem, CB } from './fields';
import { openPsd } from './Psd';
import { openDoc, setDocStatus } from './Fbd';
import { approvalCheck, STATE_LABEL, type DocState } from '../lib/approval';

const open = (kind: string, epic: Any) => (kind === 'psd' ? openPsd(epic) : openDoc(kind as 'fbd' | 'ard', epic));
const chip = (s: DocState) => <span className={`psd-status ${s === 'approved' ? 'ok' : ''}`}>{STATE_LABEL[s]}</span>;

/** Each document with its approval state, and approve / open buttons. */
function DocRows({ epic }: { epic: Any }) {
  const check = approvalCheck(epic);
  const mgr = can('epic.manage');
  return <div className="appr-rows">{check.docs.map((d: Any) => (
    <div key={d.kind} className="appr-row row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0' }}>
      <b style={{ fontWeight: 500, minWidth: 190 }}>{d.label}</b>{chip(d.state)}
      <span className="muted small">{d.state === 'approved' ? `${d.version || ''}${d.approvedBy ? ` · approved by ${d.approvedBy}` : ''}` : d.state === 'changed' ? 'Edited since it was approved' : d.state === 'missing' ? 'Write it first' : d.version}</span>
      <span style={{ marginLeft: 'auto' }} className="row">
        {d.state !== 'missing' && <button className="btn sm subtle" onClick={() => open(d.kind, epic)}>Open</button>}
        {mgr && ['draft', 'review', 'changed'].includes(d.state) && <button className="btn sm" onClick={() => { setDocStatus(epic, d.kind, 'Approved'); toast(`${d.label} approved`); }}><Ico svg={I.check} />Approve</button>}
        {mgr && d.state === 'approved' && <button className="btn sm subtle" title="Back to Draft: issues can’t be written until it’s approved again" onClick={() => setDocStatus(epic, d.kind, 'Draft')}>Withdraw</button>}
      </span>
    </div>))}</div>;
}

/** The epic panel's section: approval of the three documents, and writing the issues once they are all approved. */
export function ApprovalSection({ epic }: { epic: Any }) {
  const check = approvalCheck(epic);
  const can_ = can('ai.use') && can('issue.create');
  return (
    <div className="sec psd-sec"><div className="sec-title"><h3>Issues from approved documents</h3>
      <span className="muted small" style={{ marginLeft: 'auto' }}>{check.docs.filter((d: Any) => d.state === 'approved').length} of 3 approved</span></div>
      <p className="muted small" style={{ margin: '0 0 6px' }}>Issues for this epic are written from its Problem Statement, Feature Brief and Architecture Record Design, once all three are approved. Editing one after it was approved needs a new approval.</p>
      <DocRows epic={epic} />
      {can_ && <div className="row" style={{ marginTop: 8 }}>
        <button className="btn ai" disabled={!check.ok} title={check.ok ? '' : `Still to approve: ${check.blocking}`} onClick={() => openEpicIssues(epic)}><Ico svg={I.sparkle} />Write issues from the documents</button>
        {!check.ok && <span className="muted small">Approve all three documents first.</span>}
      </div>}
    </div>
  );
}

function RunModal({ epic }: { epic: Any }) {
  const check = approvalCheck(epic);
  const [text, setText] = useState('');
  const [gran, setGran] = useState('balanced');
  const [tests, setTests] = useState(true);
  return (
    <Modal title={`Write issues · ${epic.title}`} actions={[{ label: 'Cancel' }, { label: 'Write the issues', kind: 'ai', disabled: !check.ok, onClick: () => { closeModal(); run(epic, text, gran, tests); } }]}>
      <p className="muted small" style={{ marginTop: 0 }}>The AI writes the issues from the approved documents below: every acceptance scenario of the Feature Brief is covered, the technical scope follows the Architecture Record, and nothing outside the documents is added. You review them before they’re added.</p>
      <DocRows epic={epic} />
      <label className="field"><span>Size of issues</span>
        <SF value={gran} onChange={(e) => setGran(e.target.value)}><MenuItem value="coarse">Fewer, larger issues</MenuItem><MenuItem value="balanced">Balanced</MenuItem><MenuItem value="fine">Many small issues</MenuItem></SF></label>
      <CB label="Also write test cases for each issue" checked={tests} onChange={(e: Any) => setTests(e.target.checked)} />
      <label className="field"><span>Extra instructions (optional)</span><TA rows={3} value={text} placeholder="e.g. Keep the API and the UI in separate issues." onChange={(e) => setText(e.target.value)} /></label>
    </Modal>
  );
}
export const openEpicIssues = (epic: Any) => openModal(<RunModal epic={epic} />);

async function run(epic: Any, instructions: string, granularity: string, includeTests: boolean) {
  const ctrl = new AbortController();
  const task = startTask(`Writing issues for ${epic.title}`, { kind: 'ai', cancel: () => ctrl.abort() });
  try {
    const res = await api(`/api/projects/${P().id}/epic-issues`, { method: 'POST', raw: true, signal: ctrl.signal, body: aiBody({ epicId: epic.id, instructions, granularity, includeTests }) });
    let out: Any = null;
    await readNdjson(res, (ev) => {
      if (ev.type === 'progress') task.update({ detail: ev.message });
      else if (ev.type === 'done') out = ev.result;
      else if (ev.type === 'error') throw new Error(ev.error);
    });
    if (!out) throw new Error('Nothing came back.');
    task.finish(`${out.tickets.length} issue${out.tickets.length === 1 ? '' : 's'} ready to review`);
    openModal(<Review epic={epic} result={out} />);
  } catch (e: Any) {
    if (e.name === 'AbortError') { task.fail(''); toast('Nothing was added.', 'info', { title: 'Stopped' }); }
    else task.fail(`Couldn’t write the issues: ${e.message}`);
  }
}

function Review({ epic, result }: { epic: Any; result: Any }) {
  const [pick, setPick] = useState<Record<string, boolean>>(() => Object.fromEntries(result.tickets.map((t: Any) => [t.id, true])));
  const [openId, setOpenId] = useState<string | null>(null);
  const chosen = result.tickets.filter((t: Any) => pick[t.id]);
  const docs = result.docs.map((d: Any) => `${d.label} ${d.version}`.trim()).join(', ');
  const add = () => {
    const keys: string[] = [];
    mutate((pp: Any) => {
      for (const t of chosen) {
        const nt = newTicket({ title: t.title, type: t.type, priority: t.priority, storyPoints: t.storyPoints, labels: t.labels, userStory: t.userStory, description: t.description,
          acceptanceCriteria: t.acceptanceCriteria, dependencies: t.dependencies, testCases: withIds(t.testCases), epicId: epic.id, ...(t.layer ? { layer: t.layer } : {}) });
        nt.history[0].text = `created the issue with AI from the approved documents (${docs})`;
        pp.tickets.push(nt); keys.push(nt.key);
      }
    });
    closeModal();
    toast(`Added ${keys.length} issue${keys.length === 1 ? '' : 's'} (${keys[0]}${keys.length > 1 ? `–${keys[keys.length - 1]}` : ''}) to ${epic.title}`);
  };
  return (
    <Modal title={`Issues for ${epic.title}`} wide persistent actions={[{ label: 'Discard' }, { label: `Add ${chosen.length} issue${chosen.length === 1 ? '' : 's'}`, kind: 'primary', disabled: !chosen.length, onClick: add }]}>
      {result.summary && <p style={{ marginTop: 0 }}>{result.summary}</p>}
      <p className="muted small" style={{ margin: '0 0 8px' }}>Written from: {docs}.</p>
      {result.uncovered?.length > 0 && <div className="warn-banner"><Ico svg={I.warn} /><span>No issue covers {result.uncovered.join(', ')}. Add one by hand, or write the issues again with an instruction that mentions {result.uncovered.length > 1 ? 'them' : 'it'}.</span></div>}
      {result.coverage?.length > 0 && !result.uncovered?.length && <div className="ok-banner"><Ico svg={I.check} /><span>All {result.coverage.length} acceptance scenarios of the Feature Brief are covered.</span></div>}
      <div className="split-list" style={{ marginTop: 8 }}>{result.tickets.map((t: Any) => (
        <div key={t.id} className="card" style={{ padding: 10, marginBottom: 6 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <CB label="" checked={Boolean(pick[t.id])} onChange={(e: Any) => setPick({ ...pick, [t.id]: e.target.checked })} />
            <b style={{ fontWeight: 500, flex: 1 }}>{t.title}</b>
            <span className="muted small">{t.type}{t.storyPoints ? ` · ${t.storyPoints} pts` : ''}{t.testCases?.length ? ` · ${t.testCases.length} tests` : ''}</span>
            <button className="btn sm subtle" onClick={() => setOpenId(openId === t.id ? null : t.id)}>{openId === t.id ? 'Hide' : 'Details'}</button>
          </div>
          {openId === t.id && <div className="small" style={{ marginTop: 6 }}>
            {t.userStory && <p style={{ margin: '0 0 6px' }}><i>{t.userStory}</i></p>}
            {t.description && <p className="muted" style={{ margin: '0 0 6px', whiteSpace: 'pre-wrap' }}>{t.description}</p>}
            {t.acceptanceCriteria?.length > 0 && <ul style={{ margin: 0, paddingLeft: 18 }}>{t.acceptanceCriteria.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul>}
          </div>}
        </div>))}</div>
      {result.openQuestions?.length > 0 && <><h4 style={{ margin: '12px 0 4px' }}>Open questions from the documents</h4><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{result.openQuestions.map((q: string, i: number) => <li key={i}>{q}</li>)}</ul></>}
    </Modal>
  );
}
