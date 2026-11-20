'use client';
// The conversation: the welcome with example questions, each message (the assistant's in Markdown,
// with its issue draft), the reply while it is written, and any problem (the AI limit, errors).
import { useEffect, useRef } from 'react';
import type { Any } from '../core';
import { Spinner } from '../ui';
import { MarkdownDoc } from '../markdown';
import { DraftPreview } from './draft-preview';
import type { AssistantState } from './use-assistant';

const HINTS_PROJECT = [
  'What’s assigned to me?',
  'Summarize the open bugs',
  'Draft a story: users can reset their password by email',
];
const HINTS_OUTSIDE = [
  'How do I create a project?',
  'How many tickets are in my projects?',
  'What’s new?',
];

function Welcome({ a }: { a: AssistantState }) {
  const hints = a.pid ? HINTS_PROJECT : HINTS_OUTSIDE;
  const intro = a.pid
    ? 'Hi! Ask me anything about this project, or describe an issue and I’ll draft it for you to check and create.'
    : 'Hi! Ask me how TicketForge works or about the tickets in your projects. Open a project to draft issues with me.';
  return (
    <>
      <div className="chat-msg bot">{intro}</div>
      <div className="chat-hints">
        {hints.map((h) => (
          <button key={h} className="btn sm subtle" onClick={() => a.send(h)}>
            {h}
          </button>
        ))}
      </div>
    </>
  );
}

const Bubble = ({ m }: { m: Any }) =>
  m.role === 'user' ? (
    <div className="chat-msg me">{m.content}</div>
  ) : (
    <div className="chat-msg bot md">
      <MarkdownDoc text={m.content} baseLevel={4} />
    </div>
  );

function Turn({ m, a }: { m: Any; a: AssistantState }) {
  const d = m.draft;
  return (
    <div className={`pchat-turn ${m.role === 'user' ? 'me' : 'bot'}`}>
      <Bubble m={m} />
      {d && !d.created && !d.discarded && (
        <DraftPreview
          key={m.id}
          msg={m}
          onCreate={(x) => a.create(m, x)}
          onDiscard={() => a.discard(m)}
        />
      )}
      {d?.created && (
        <div className="pchat-hint">
          Created {d.created.key} “{d.created.title}” in the backlog.
        </div>
      )}
    </div>
  );
}

/** The reply while it is written: its text so far, or dots until the first words arrive. */
function Writing({ a }: { a: AssistantState }) {
  if (!a.busy) return null;
  return (
    <div className="pchat-turn bot" aria-label="Ticket Forge AI is writing">
      {a.live ? (
        <div className="chat-msg bot md">
          <MarkdownDoc text={a.live} baseLevel={4} />
        </div>
      ) : (
        <div className="chat-msg bot chat-typing">
          <span />
          <span />
          <span />
        </div>
      )}
      {a.status === 'drafting' && (
        <div className="pchat-hint">
          <Spinner /> Writing the issue draft…
        </div>
      )}
    </div>
  );
}

export function Messages({ a }: { a: AssistantState }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [a.msgs, a.live, a.busy, a.notice]);
  const list = a.msgs || [];
  return (
    <div className="chat-log" role="log" aria-label="Messages" aria-live="polite">
      {a.msgs === null && <Spinner />}
      {a.msgs !== null && list.length === 0 && <Welcome a={a} />}
      {list.map((m) => (
        <Turn key={m.id} m={m} a={a} />
      ))}
      <Writing a={a} />
      {a.notice && (
        <div className="chat-msg bot denied" role="alert" data-limit={a.notice.limit || undefined}>
          {a.notice.limit ? `AI limit reached. ${a.notice.text}` : a.notice.text}
        </div>
      )}
      <div ref={end} />
    </div>
  );
}
