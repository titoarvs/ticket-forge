'use client';
// Document review of an epic, before its issues are created. The PSD, FBD and ARD are uploaded (PDF, DOCX or PNG, up to
// 10 MB), the reviewers listed on the epic comment and approve or request changes, and the epic owner gives the final
// sign-off. A document is approved when every listed reviewer approved its current version; uploading it again saves a
// new version and the earlier ones stay in its history. The add-issue option appears only once the epic is signed off.
import { useCallback, useEffect, useRef, useState } from 'react';
import { S, P, ago, can, mutate, toast, openModal, closeModal, type Any } from './core';
import { getReview, uploadReviewDoc, decideReviewDoc, commentReviewDoc, signOffEpic } from './api/epicReview';
import { listPeople } from './api/specs';
import { Ico, I, Avatar, Modal, ErrorState, Loading, Sk, Spinner } from './ui';
import { TA, CB } from './fields';
import { CreateIssueModal } from './actions';
import { openReviewedEpicIssues } from './EpicIssues';

const ALLOWED = 'Allowed: PDF, DOCX and PNG files, up to 10 MB.';
const BAD_FILE = 'Only PDF, DOCX and PNG files up to 10 MB can be uploaded as a PSD, FBD or ARD.';
const MAX_BYTES = 10 * 1024 * 1024;
const fmtBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const DOC_STATUS: Record<string, string> = { missing: 'Not uploaded', review: 'In review', changes: 'Changes requested', approved: 'Approved' };
const DECISION: Record<string, string> = { approved: 'Approved', changes: 'Changes requested', pending: 'Waiting' };
const fileUrl = (id: string) => `/api/files/${id}`;

/** The add-issue option, shown once the epic is signed off: create issues by hand, or have the AI draft them. */
function AddIssueModal({ epic }: { epic: Any }) {
  return (
    <Modal title={`Add issue · ${epic.title}`} actions={[{ label: 'Close' }]}>
      <p className="muted small" style={{ marginTop: 0 }}>This epic’s documents are approved and signed off. Choose how to add its issues.</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {can('issue.create') && <button className="btn" onClick={() => { closeModal(); openModal(<CreateIssueModal epicId={epic.id} />); }}><Ico svg={I.plus} />Create issues manually</button>}
        {can('issue.create') && can('ai.use') && <button className="btn ai" onClick={() => { closeModal(); openReviewedEpicIssues(epic); }}><Ico svg={I.sparkle} />Generate draft issues with AI</button>}
      </div>
      {!can('issue.create') && <p className="muted small">You don’t have permission to create issues.</p>}
    </Modal>
  );
}

function Versions({ d }: { d: Any }) {
  return <details className="small"><summary>Version history ({d.versions.length})</summary>
    <ol className="ver-list" aria-label={`Versions of the ${d.short}`}>{d.versions.map((v: Any) => (
      <li key={v.number} className={`ver-row ${v.number === d.current.number ? 'on' : ''}`}>
        <b style={{ fontWeight: 500 }}>Version {v.number}{v.number === d.current.number ? ' (current)' : ''}</b>
        {v.approved && <span className="psd-status ok">Approved</span>}
        <a href={`${fileUrl(v.fileId)}?download=1`} title="Download this version">{v.name}</a>
        <span className="muted">{fmtBytes(v.bytes)} · {v.author || 'Unknown'} · <span title={when(v.at)}>{ago(v.at)}</span></span>
      </li>))}</ol></details>;
}

function Comments({ d, canComment, onSend }: { d: Any; canComment: boolean; onSend: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => { setBusy(true); if (await onSend(text)) setText(''); setBusy(false); };
  return <div className="small" style={{ marginTop: 6 }}>
    <b style={{ fontWeight: 500 }}>Comments ({d.comments.length})</b>
    {d.comments.length ? <ul style={{ listStyle: 'none', margin: '4px 0', padding: 0 }}>{d.comments.map((c: Any) => (
      <li key={c.id} style={{ display: 'flex', gap: 8, padding: '4px 0', borderTop: '1px solid var(--border)' }}>
        <Avatar name={c.author} size={22} />
        <div><b style={{ fontWeight: 500 }}>{c.author || 'Unknown'}</b> <span className="muted" title={when(c.at)}>{ago(c.at)} · version {c.version}</span>
          <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div></div>
      </li>))}</ul> : <p className="muted small" style={{ margin: '4px 0' }}>No comments yet.</p>}
    {canComment && <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
      <TA rows={2} aria-label={`Comment on the ${d.short}`} value={text} placeholder="Add a comment…" onChange={(e: Any) => setText(e.target.value)} />
      <button className="btn sm" disabled={busy || !text.trim()} onClick={send}>{busy && <Spinner />}Comment</button></div>}
  </div>;
}

function DocCard({ d, me, busy, onUpload, onDecide, onComment }: { d: Any; me: Any; busy: boolean; onUpload: (kind: string, f: File) => void; onDecide: (kind: string, decision: 'approved' | 'changes') => void; onComment: (kind: string, text: string) => Promise<boolean> }) {
  const input = useRef<HTMLInputElement>(null);
  const mine = d.reviews.find((r: Any) => r.userId === S.user?.id);
  return (
    <div className="appr-row" style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }} data-doc={d.kind}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontWeight: 500, minWidth: 190 }}>{d.label} ({d.short})</b>
        <span className={`psd-status ${d.status === 'approved' ? 'ok' : ''}`}>{DOC_STATUS[d.status]}</span>
        {d.current && <span className="muted small">v{d.current.number} · <a href={fileUrl(d.current.fileId)} target="_blank" rel="noopener noreferrer">{d.current.name}</a> · {fmtBytes(d.current.bytes)}</span>}
        <span style={{ marginLeft: 'auto' }} className="row">
          {me.canUpload && <>
            <input ref={input} type="file" hidden aria-label={`Upload the ${d.short}`} accept=".pdf,.docx,.png" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onUpload(d.kind, f); }} />
            <button className="btn sm" disabled={busy} onClick={() => input.current?.click()}><Ico svg={I.upload} />{d.current ? 'Upload new version' : `Upload ${d.short}`}</button></>}
          {me.isReviewer && d.current && <>
            <button className="btn sm" disabled={busy || mine?.decision === 'approved'} onClick={() => onDecide(d.kind, 'approved')}><Ico svg={I.check} />Approve</button>
            <button className="btn sm subtle" disabled={busy || mine?.decision === 'changes'} onClick={() => onDecide(d.kind, 'changes')}>Request changes</button></>}
        </span>
      </div>
      {d.current && <ul className="small" aria-label={`Approval status of the ${d.short}`} style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
        {d.reviews.length ? d.reviews.map((r: Any) => (
          <li key={r.userId} className="row" style={{ gap: 8, alignItems: 'center' }}>
            <Avatar name={r.name} size={20} /><span>{r.name}</span>
            <span className={`psd-status ${r.decision === 'approved' ? 'ok' : ''}`}>{DECISION[r.decision]}</span>
            {r.at && <span className="muted" title={when(r.at)}>{ago(r.at)}</span>}
          </li>)) : <li className="muted">No reviewers are listed on this epic yet.</li>}
      </ul>}
      {d.current && <Versions d={d} />}
      {d.current && <Comments d={d} canComment={me.canComment} onSend={(text) => onComment(d.kind, text)} />}
    </div>
  );
}

/** The epic panel's Document review section. */
export function EpicReviewSection({ epic }: { epic: Any }) {
  const pid = P()?.id;
  const [state, setState] = useState<{ loading: boolean; error: Any; data: Any }>({ loading: true, error: null, data: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [people, setPeople] = useState<Any[]>([]);
  // Reviewers live on the epic, which is saved as a project section: load again when it has been saved.
  const rev = S.revs?.meta?.epics ?? 0;
  const ed = can('epic.manage');
  const listed: Any[] = Array.isArray(epic.reviewers) ? epic.reviewers : [];

  const load = useCallback(async () => {
    try { setState({ loading: false, error: null, data: await getReview(pid, epic.id) }); }
    catch (e: Any) { setState((s) => ({ ...s, loading: false, error: e })); }
  }, [pid, epic.id]);
  useEffect(() => { load(); }, [load, rev]);
  useEffect(() => { if (ed) listPeople(pid).then(setPeople).catch(() => setPeople([])); }, [pid, ed]);

  const run = async (fn: () => Promise<Any>, okMsg: string) => {
    setBusy(true); setError('');
    try { const d = await fn(); setState({ loading: false, error: null, data: d }); toast(okMsg); return true; }
    catch (e: Any) { setError(e.message || 'That didn’t work.'); toast(e.message, 'err'); return false; }
    finally { setBusy(false); }
  };
  const upload = (kind: string, f: File) => {
    if (!/\.(pdf|docx|png)$/i.test(f.name) || f.size > MAX_BYTES) { setError(BAD_FILE); toast(BAD_FILE, 'err'); return; }
    return run(() => uploadReviewDoc(pid, epic.id, kind, f), 'Document uploaded');
  };
  const decide = (kind: string, decision: 'approved' | 'changes') => run(() => decideReviewDoc(pid, epic.id, kind, decision), decision === 'approved' ? 'Approval recorded' : 'Changes requested');
  const comment = (kind: string, text: string) => run(() => commentReviewDoc(pid, epic.id, kind, text), 'Comment added');
  const signOff = () => run(() => signOffEpic(pid, epic.id), 'Epic signed off');
  const toggleReviewer = (u: Any, on: boolean) => mutate(() => { epic.reviewers = on ? [...listed.filter((x) => x.id !== u.id), { id: u.id, name: u.name }] : listed.filter((x) => x.id !== u.id); }, { tag: `e.reviewers${epic.id}` });

  const d = state.data;
  const approved = d ? d.docs.filter((x: Any) => x.status === 'approved').length : 0;
  return (
    <div className="sec psd-sec" data-sec="doc-review"><div className="sec-title"><Ico svg={I.doc} /><h3>Document review</h3>
      {d && <span className="muted small" style={{ marginLeft: 'auto' }}>{approved} of 3 approved{d.signoff ? ' · signed off' : ''}</span>}</div>
      <p className="muted small" style={{ margin: '0 0 6px' }}>Upload the PSD, FBD and ARD. Every reviewer listed below approves each document, then the epic owner signs off, and then issues can be added. {ALLOWED}</p>
      {state.loading ? <Loading label="Loading the document review…"><Sk w="60%" /><Sk w="40%" h={10} style={{ marginTop: 8 }} /></Loading>
        : state.error && !d ? <ErrorState compact title="Couldn’t load the document review" error={state.error} onRetry={load} />
        : d && <>
          <div className="small" style={{ marginBottom: 6 }}><b style={{ fontWeight: 500 }}>Reviewers:</b> {d.reviewers.length ? d.reviewers.map((r: Any) => r.name || 'Reviewer').join(', ') : <span className="muted">none listed yet</span>}</div>
          {ed && <details style={{ marginBottom: 6 }}><summary className="small">Choose the reviewers of this epic</summary>
            {people.map((u) => <CB key={u.id} size="small" label={`${u.name} (${u.role})`} checked={listed.some((x) => x.id === u.id)} onChange={(ev: Any) => toggleReviewer(u, ev.target.checked)} />)}
            {!people.length && <span className="muted small">No people found.</span>}</details>}
          {error && <p className="small ref-err" role="alert">{error}</p>}
          {d.docs.map((x: Any) => <DocCard key={x.kind} d={x} me={d.me} busy={busy} onUpload={upload} onDecide={decide} onComment={comment} />)}
          <div className="row" style={{ marginTop: 8, gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            {d.signoff
              ? <div className="ok-banner" style={{ flex: 1 }}><Ico svg={I.check} /><span>Signed off by {d.signoff.by || 'the epic owner'} <span title={when(d.signoff.at)}>{ago(d.signoff.at)}</span>.</span></div>
              : <>{d.me.canSignOff && <button className="btn" disabled={busy} onClick={signOff}>{busy && <Spinner />}Record final sign-off</button>}
                <span className="muted small">{d.allApproved ? 'All documents are approved: the epic can be signed off.' : 'Issues can be added after all three documents are approved and the epic is signed off.'}</span></>}
            {d.canAddIssues && <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => openModal(<AddIssueModal epic={epic} />)}><Ico svg={I.plus} />Add issue</button>}
          </div>
        </>}
    </div>
  );
}
