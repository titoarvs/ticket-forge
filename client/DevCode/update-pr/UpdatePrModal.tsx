'use client';
// Update an open pull / merge request with AI: apply changes, enhance it, address its review
// comments (code changes on its own branch), or rewrite its description from the real diff.
import { useState } from 'react';
import {
  type Any,
  api,
  P,
  toast,
  aiBody,
  mutate,
  logEvent,
  closeModal,
  openModal,
} from '../../core';
import { Spinner, Modal } from '../../ui';
import { TA } from '../../fields';
import { openCode } from '../open-code';

const MODES: [string, string, string][] = [
  ['prompt', 'Apply changes', 'Tell the agent what to change; it works on the request’s branch.'],
  [
    'enhance',
    'Enhance',
    'Better tests, edge cases and error handling, without changing what it does.',
  ],
  ['review', 'Address review comments', 'Reads the open review comments and fixes what they ask.'],
  [
    'describe',
    'Improve description',
    'Rewrites the title and description from the real diff. No code changes.',
  ],
];

const codeApi = () => `/api/projects/${P().id}/code`;
const prRef = (pr: Any) => `${pr.provider === 'GitLab' ? '!' : '#'}${pr.number}`;
const prNoun = (pr: Any) => (pr.provider === 'GitLab' ? 'merge request' : 'pull request');

/** Rewrites the title and description, and records it on the issue. */
async function rewriteDescription(t: Any, pr: Any) {
  const r = await api(codeApi(), {
    method: 'POST',
    body: aiBody({ action: 'describe', ticketId: t.id, prId: pr.id }),
  });
  mutate(() => {
    pr.title = r.title;
    logEvent(t, `rewrote the description of ${prNoun(pr)} ${prRef(pr)} with AI`, 'Development');
  });
  closeModal();
  toast(`${prRef(pr)} now reads “${r.title}”.`, 'ok', {
    title: 'Description updated',
    action: { label: 'Open', onClick: () => window.open(pr.url, '_blank', 'noopener') },
  });
}

/** Starts an agent round on the request's branch and shows it in the Write code modal. */
async function startUpdate(t: Any, pr: Any, mode: string, prompt: string) {
  const job = await api(codeApi(), {
    method: 'POST',
    body: aiBody({ action: 'update', ticketId: t.id, prId: pr.id, mode, prompt }),
  });
  closeModal();
  openCode(t, job.side);
}

/** The open review comments the agent will address (the first 12). */
function ReviewComments({ comments }: { comments: Any[] | null }) {
  if (comments === null)
    return (
      <span className="muted small">
        <Spinner /> Reading the review comments…
      </span>
    );
  if (!comments.length) return <span className="muted small">No open review comments on it.</span>;
  return (
    <ul className="small">
      {comments.slice(0, 12).map((c, i) => (
        <li key={i}>
          <b>{c.author ? `@${c.author}` : 'Reviewer'}</b>
          {c.file ? (
            <code>
              {' '}
              {c.file}
              {c.line ? `:${c.line}` : ''}
            </code>
          ) : null}{' '}
          — {c.body.slice(0, 220)}
          {c.body.length > 220 ? '…' : ''}
        </li>
      ))}
      {comments.length > 12 && <li className="muted">…and {comments.length - 12} more</li>}
    </ul>
  );
}

function ModePicker({ mode, onPick }: { mode: string; onPick: (m: string) => void }) {
  return (
    <div className="upd-modes" role="radiogroup" aria-label="What to do">
      {MODES.map(([k, l, d]) => (
        <button
          key={k}
          role="radio"
          aria-checked={mode === k}
          className={mode === k ? 'on' : ''}
          onClick={() => onPick(k)}
        >
          <b>{l}</b>
          <span className="muted small">{d}</span>
        </button>
      ))}
    </div>
  );
}

/** The review comments, read once when "Address review comments" is first picked. */
function useReviewComments(t: Any, pr: Any) {
  const [comments, setComments] = useState<Any[] | null>(null);
  const load = async () => {
    setComments(null);
    try {
      const r = await api(codeApi(), {
        method: 'POST',
        body: { action: 'comments', ticketId: t.id, prId: pr.id },
      });
      setComments(r.comments);
    } catch (e: Any) {
      setComments([]);
      toast(e.message, 'err');
    }
  };
  return { comments, load };
}

function UpdatePrModal({ t, pr }: { t: Any; pr: Any }) {
  const [mode, setMode] = useState('prompt');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const review = useReviewComments(t, pr);
  const pick = (m: string) => {
    setMode(m);
    if (m === 'review' && review.comments === null) review.load();
  };
  const go = async () => {
    setBusy(true);
    try {
      if (mode === 'describe') await rewriteDescription(t, pr);
      else await startUpdate(t, pr, mode, text);
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  const ready =
    mode === 'prompt'
      ? Boolean(text.trim())
      : mode === 'review'
        ? Boolean(review.comments?.length)
        : true;
  const noun = prNoun(pr);
  return (
    <Modal
      title={`Update ${prRef(pr)} with AI`}
      wide
      actions={[
        { label: 'Cancel' },
        {
          label: busy ? 'Starting…' : mode === 'describe' ? 'Rewrite description' : 'Start',
          kind: 'ai',
          disabled: busy || !ready,
          onClick: go,
        },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        <b>{pr.title}</b> · {pr.repo} · <code>{pr.branch}</code> → <code>{pr.base}</code>. Code
        changes run on the {noun}’s own branch; you review the diff, then push to the same {noun}.
      </p>
      <ModePicker mode={mode} onPick={pick} />
      {mode === 'review' && (
        <div className="upd-comments">
          <ReviewComments comments={review.comments} />
        </div>
      )}
      {mode !== 'describe' && (
        <label className="field" style={{ marginTop: 10 }}>
          <span>{mode === 'prompt' ? 'What to change' : 'Anything else (optional)'}</span>
          <TA
            rows={4}
            value={text}
            autoFocus={mode === 'prompt'}
            placeholder={
              mode === 'prompt'
                ? 'e.g. Rename the endpoint to /salary-proposals/:id/notify, and return 404 when the proposal is missing.'
                : 'e.g. Focus the tests on the approval rules.'
            }
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      )}
    </Modal>
  );
}

export const openUpdatePr = (t: Any, pr: Any) => openModal(<UpdatePrModal t={t} pr={pr} />);
