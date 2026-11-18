'use client';
// Questions before the AI writes (lib/clarify.ts). The AI reads what it was given and asks the few questions whose
// answers would most change the result; the person answers (picks a suggested answer or types one) or skips.
// - askFirst(): a dialog. Resolves with the answers as instructions, '' when skipped (or nothing to ask), null when cancelled.
// - useQuestions() + <QuestionsView>: the same inside a dialog that is already open (Add feature).
import { useEffect, useRef, useState } from 'react';
import { S, P, api, aiBody, closeModal, openModal, type Any } from './core';
import { Modal, Spinner } from './ui';
import { TF } from './fields';

export type AskOpts = { kind: string; subject: string; epicId?: string | null; ticket?: Any; ticketIds?: string[]; text?: string; instructions?: string; projectless?: boolean };

// The same questions request already on its way is shared (a dialog opened twice in a row costs one AI call).
const inflight = new Map<string, Promise<Any>>();
function questions(body: Any) {
  const key = JSON.stringify(body);
  let p = inflight.get(key);
  if (!p) { p = api('/api/ai/questions', { method: 'POST', body }); inflight.set(key, p); p.finally(() => setTimeout(() => inflight.delete(key), 3000)).catch(() => {}); }
  return p;
}

export function useQuestions(o: AskOpts, onNone?: () => void) {
  const [qs, setQs] = useState<Any[] | null>(null);
  const [err, setErr] = useState('');
  const [ans, setAns] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    const body = aiBody({ kind: o.kind, projectId: o.projectless ? undefined : P()?.id, epicId: o.epicId, ticketIds: o.ticketIds, text: o.text, instructions: o.instructions,
      ticket: o.ticket ? { ...o.ticket, history: undefined, comments: undefined } : undefined });
    questions(body).then((r: Any) => {
      if (!live) return;
      setQs(r.questions || []);
      if (!r.questions?.length) onNone?.();
    }).catch((e) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const answered = qs ? qs.filter((q) => ans[q.id]?.trim()).length : 0;
  const text = () => {
    const lines = (qs || []).filter((q) => ans[q.id]?.trim()).map((q) => `- ${q.question} → ${ans[q.id].trim()}`);
    return lines.length ? `Answers to the questions asked before writing:\n${lines.join('\n')}` : '';
  };
  const continueLabel = answered ? `Continue with ${answered} answer${answered > 1 ? 's' : ''}` : 'Continue';
  return { qs, err, ans, setAns, answered, text, continueLabel };
}

export function QuestionsView({ q: { qs, err, ans, setAns }, subject }: { q: ReturnType<typeof useQuestions>; subject: string }) {
  return <>
    <p className="muted small" style={{ marginTop: 0 }}>Before it writes {subject}, the AI asks what would most change the result. Pick an answer, type your own, or leave it blank.</p>
    {err ? <div className="warn-banner"><span>Couldn’t get the questions: {err}. You can continue without them.</span></div>
      : !qs ? <div className="ai-running"><Spinner /> Reading what it was given to see what it needs to know…</div>
      : !qs.length ? <p className="muted small">Nothing to ask: the material already answers what matters.</p>
      : <ol className="clarify-list">{qs.map((q) => (
        <li key={q.id}>
          <b>{q.question}</b>{q.why && <div className="muted small">{q.why}</div>}
          {q.options?.length > 0 && <div className="clarify-opts">{q.options.map((opt: string) => (
            <button key={opt} type="button" className={`chip-btn ${ans[q.id] === opt ? 'on' : ''}`} aria-pressed={ans[q.id] === opt}
              onClick={() => setAns({ ...ans, [q.id]: ans[q.id] === opt ? '' : opt })}>{opt}</button>))}</div>}
          <TF value={ans[q.id] || ''} placeholder="Your answer (optional)" onChange={(e) => setAns({ ...ans, [q.id]: e.target.value })} aria-label={q.question} />
        </li>))}</ol>}
  </>;
}

function AskModal({ o, resolve, box }: { o: AskOpts; resolve: (v: string | null) => void; box: { node?: unknown } }) {
  const done = useRef(false);
  const finish = (v: string | null, close = true) => { if (done.current) return; done.current = true; resolve(v); if (close && S.modal === box.node) closeModal(); };
  const q = useQuestions(o, () => finish(''));
  // Closed with ✕, Escape or the backdrop (or replaced by another dialog): cancel. Checked after the unmount settles,
  // so React's development double-mount doesn't count as closing.
  useEffect(() => () => { setTimeout(() => { if (!done.current && S.modal !== box.node) finish(null, false); }, 0); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="A few questions first" wide persistent actions={[
      { label: 'Cancel', onClick: () => finish(null) },
      { label: q.err ? 'Continue without' : 'Skip questions', onClick: () => finish('') },
      { label: q.continueLabel, kind: 'ai', disabled: !q.qs, onClick: () => finish(q.text()) },
    ]}>
      <QuestionsView q={q} subject={o.subject} />
    </Modal>
  );
}

/** Asks the AI's questions before a generation. '' = go ahead without answers, null = cancelled. */
export function askFirst(o: AskOpts): Promise<string | null> {
  return new Promise((resolve) => {
    const box: { node?: unknown } = {};
    box.node = <AskModal o={o} resolve={resolve} box={box} />;
    openModal(box.node as Any);
  });
}
