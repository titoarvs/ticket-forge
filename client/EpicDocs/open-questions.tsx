'use client';
import { useState } from 'react';
// A document's open questions on the epic panel: every [To confirm: …] point and open decision the
// AI left in it. People type the answers (saved on the epic as they type); "Update the document
// with answers" has the AI write them into the document. Answered questions move to "Resolved".
import {
  P,
  api,
  can,
  mutate,
  toast,
  readNdjson,
  aiBody,
  me,
  emit,
  startTask,
  type Any,
} from '../core';
import { Ico, I, Spinner } from '../ui';
import { TA } from '../fields';
import {
  openQuestions,
  answeredNow,
  questionLabel,
  type OpenQuestion,
} from '../../lib/doc-questions';
import { type DocKind, DOC_NAME, docBusy, markBusy, clearBusy } from './shared';

async function fetchAnswered(k: DocKind, epic: Any, answers: Any[], signal: AbortSignal) {
  const res = await api(`/api/projects/${P().id}/${k}/answers`, {
    method: 'POST',
    raw: true,
    signal,
    body: aiBody({ epicId: epic.id, answers }),
  });
  let out: Any = null;
  await readNdjson(res, (ev) => {
    if (ev.type === 'done') out = ev;
    else if (ev.type === 'error') throw new Error(ev.error);
  });
  if (!(k === 'psd' ? out?.psd : out?.markdown))
    throw new Error(`The AI didn’t return the ${DOC_NAME[k]}.`);
  return out;
}

/** Saves the updated document: answered questions move to `resolved`, the rest keep answers. */
function saveUpdated(k: DocKind, epic: Any, out: Any, answered: Any[]) {
  const prev = epic[k];
  const at = new Date().toISOString();
  const body = k === 'psd' ? out.psd : { markdown: out.markdown };
  const next = { ...prev, ...body, revisedAt: at, revisedBy: me() };
  const done = new Set(answered.map((a) => a.id));
  const answers: Record<string, string> = {};
  for (const q of openQuestions(k, next))
    if (prev.answers?.[q.id] && !done.has(q.id)) answers[q.id] = prev.answers[q.id];
  mutate(() => {
    epic[k] = {
      ...next,
      answers,
      resolved: [
        ...(prev.resolved || []),
        ...answered.map((a) => ({ question: a.question, answer: a.answer, by: me(), at })),
      ].slice(-100),
    };
  });
}

/** Has the AI write the typed answers into the document (in the tray, with Cancel). */
export async function updateWithAnswers(k: DocKind, epic: Any) {
  const name = DOC_NAME[k];
  const answered = openQuestions(k, epic[k])
    .filter((q) => String(epic[k].answers?.[q.id] || '').trim())
    .map((q) => ({
      id: q.id,
      question: questionLabel(q),
      answer: String(epic[k].answers[q.id]).trim(),
    }));
  if (!answered.length) return toast('Answer at least one open question first.', 'info');
  if (docBusy(k, epic.id)) return toast(`The ${name} is already being written.`, 'info');
  const ctrl = new AbortController();
  const task = startTask(`Updating the ${name}`, {
    detail: `${epic.title} · ${answered.length} answer${answered.length > 1 ? 's' : ''}`,
    kind: 'doc',
    cancel: () => ctrl.abort(),
  });
  markBusy(k, epic.id);
  emit();
  try {
    const out = await fetchAnswered(k, epic, answered, ctrl.signal);
    saveUpdated(k, epic, out, answered);
    task.finish(`Saved on “${epic.title}”`);
    toast(`${answered.length} answer${answered.length > 1 ? 's' : ''} written in.`, 'ok', {
      title: `${name} updated`,
    });
  } catch (e: Any) {
    if (e.name === 'AbortError') {
      task.fail('');
      toast('The document wasn’t changed.', 'info', { title: `Stopped updating the ${name}` });
    } else task.fail(`Couldn’t update the ${name}: ${e.message}`);
  } finally {
    clearBusy(k, epic.id);
    emit();
  }
}

function Question({ k, epic, q, ed }: { k: DocKind; epic: Any; q: OpenQuestion; ed: boolean }) {
  const value = epic[k].answers?.[q.id] || '';
  const set = (v: string) =>
    mutate(
      () => {
        epic[k] = { ...epic[k], answers: { ...(epic[k].answers || {}), [q.id]: v } };
      },
      { tag: `${k}.ans${epic.id}${q.id}` },
    );
  return (
    <li className={`oq-item ${value.trim() ? 'done' : ''}`}>
      <div className="oq-q">
        {q.code && <span className="label-chip">{q.code}</span>}
        <span>{q.text}</span>
      </div>
      {(q.section || q.line) && (
        <div className="oq-where muted small">
          {q.section && <b>{q.section}</b>}
          {q.section && q.line && ' · '}
          {q.line}
        </div>
      )}
      <TA
        rows={1}
        disabled={!ed}
        value={value}
        placeholder={q.kind === 'decision' ? 'The decision…' : 'Your answer…'}
        aria-label={`Answer: ${q.text}`}
        onChange={(e: Any) => set(e.target.value)}
      />
    </li>
  );
}

function Resolved({ list }: { list: Any[] }) {
  if (!list.length) return null;
  return (
    <details className="oq-resolved">
      <summary className="muted small">Resolved ({list.length})</summary>
      <ul>
        {list
          .slice()
          .reverse()
          .map((a: Any, i: number) => (
            <li key={i} className="small">
              <b>{a.question}</b>
              <div>{a.answer}</div>
              {a.by && <span className="muted">{a.by}</span>}
            </li>
          ))}
      </ul>
    </details>
  );
}

/** The open questions of one document, under its actions on the epic panel. */
const FIRST = 8; // shown before "Show all"

export function OpenQuestions({ k, epic }: { k: DocKind; epic: Any }) {
  const [all, setAll] = useState(false);
  const doc = epic[k];
  const qs = openQuestions(k, doc);
  const resolved = doc?.resolved || [];
  if (!qs.length && !resolved.length) return null;
  const n = answeredNow(k, doc).length;
  const ed = can('epic.manage');
  const busy = docBusy(k, epic.id);
  return (
    <div className="oq">
      <div className="oq-head">
        <b>Open questions</b>
        <span className="muted small">
          {qs.length ? `${n} of ${qs.length} answered` : 'all answered'}
        </span>
        {qs.length > 0 && can('ai.use') && ed && (
          <button
            className="btn sm ai"
            style={{ marginLeft: 'auto' }}
            disabled={!n || busy}
            title={n ? '' : 'Answer at least one question first'}
            onClick={() => updateWithAnswers(k, epic)}
          >
            {busy ? <Spinner /> : <Ico svg={I.sparkle} />}
            Update the document with answers
          </button>
        )}
      </div>
      {qs.length > 0 && (
        <ol className="oq-list">
          {(all ? qs : qs.slice(0, FIRST)).map((q) => (
            <Question key={q.id} k={k} epic={epic} q={q} ed={ed} />
          ))}
        </ol>
      )}
      {qs.length > FIRST && (
        <button className="btn sm subtle oq-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${qs.length}`}
        </button>
      )}
      <Resolved list={resolved} />
    </div>
  );
}
