'use client';
// Help chatbot (rule-based, no AI) and the release announcement robot, in the corner of every
// signed-in page.
// The robot's message comes from GET /api/chatbot (only while the RELEASE_ANNOUNCEMENT flag is on).
// With prefers-reduced-motion it shows the message without animation.
import { useEffect, useRef, useState } from 'react';
import { api } from './core';
import { Ico, I, Spinner } from './ui';

const WELCOME =
  'Hi! I’m the Ticket Forge helper. Ask me how something works, or about the tickets in your projects.';
const HINTS = ['How do I create a project?', 'How many tickets are in my project?', 'What’s new?'];
const SEEN = 'tf.announce.seen';

type Msg = { from: 'bot' | 'me'; text: string; kind?: string };

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const seenId = () => {
  try {
    return localStorage.getItem(SEEN);
  } catch {
    return null;
  }
};

/** A small robot drawn in SVG (no images to load). */
function Robot({ still }: { still: boolean }) {
  return (
    <svg
      className={`bot-svg ${still ? 'still' : ''}`}
      viewBox="0 0 40 40"
      width="40"
      height="40"
      aria-hidden="true"
      focusable="false"
    >
      <line
        x1="20"
        y1="3"
        x2="20"
        y2="8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle className="bot-ant" cx="20" cy="3" r="2" fill="currentColor" />
      <rect x="7" y="8" width="26" height="22" rx="7" fill="currentColor" />
      <circle cx="15" cy="18" r="3" fill="#fff" />
      <circle cx="25" cy="18" r="3" fill="#fff" />
      <rect x="14" y="24" width="12" height="2.5" rx="1.25" fill="#fff" />
      <rect className="bot-arm" x="2" y="30" width="6" height="7" rx="3" fill="currentColor" />
      <rect x="32" y="30" width="6" height="7" rx="3" fill="currentColor" />
    </svg>
  );
}

export function Chatbot() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ from: 'bot', text: WELCOME }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [ann, setAnn] = useState<{ id: string; message: string } | null>(null);
  const [still, setStill] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  // The release announcement: asked once when the app opens. Off (null) unless the flag is on.
  useEffect(() => {
    setStill(reducedMotion());
    let live = true;
    api('/api/chatbot')
      .then((d) => {
        if (live && d?.announcement && seenId() !== d.announcement.id) setAnn(d.announcement);
      })
      .catch(() => {
        /* no announcement */
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end', behavior: still ? 'auto' : 'smooth' });
  }, [msgs, busy, open, still]);

  const dismiss = () => {
    if (ann) {
      try {
        localStorage.setItem(SEEN, ann.id);
      } catch {
        /* private mode */
      }
    }
    setAnn(null);
  };
  const openChat = () => {
    setOpen(true);
    dismiss();
  };

  const send = async (raw?: string) => {
    const q = (raw ?? text).trim();
    if (!q || busy) return;
    setText('');
    setBusy(true);
    setMsgs((m) => [...m, { from: 'me', text: q }]);
    try {
      const r = await api('/api/chatbot', { method: 'POST', body: { message: q } });
      setMsgs((m) => [...m, { from: 'bot', text: r.reply, kind: r.kind }]);
    } catch (e) {
      setMsgs((m) => [
        ...m,
        {
          from: 'bot',
          text: (e as Error)?.message || 'Something went wrong. Please try again.',
          kind: 'error',
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chatbot">
      {open && (
        <section className="chat-panel" role="dialog" aria-label="Help chatbot">
          <header className="chat-h">
            <Ico svg={I.sparkle} />
            <b>Ticket Forge helper</b>
            <span className="spacer" />
            <button
              className="btn sm subtle"
              onClick={() => setOpen(false)}
              aria-label="Close the chatbot"
            >
              <Ico svg={I.close} />
            </button>
          </header>
          <div className="chat-log" role="log" aria-live="polite">
            {msgs.map((m, i) => (
              <div key={i} className={`chat-msg ${m.from} ${m.kind === 'denied' ? 'denied' : ''}`}>
                {m.text}
              </div>
            ))}
            {busy && (
              <div className="chat-msg bot">
                <Spinner />
              </div>
            )}
            {msgs.length === 1 && (
              <div className="chat-hints">
                {HINTS.map((h) => (
                  <button key={h} className="btn sm subtle" onClick={() => send(h)}>
                    {h}
                  </button>
                ))}
              </div>
            )}
            <div ref={end} />
          </div>
          <form
            className="chat-in"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ask a question…"
              aria-label="Ask the chatbot a question"
              maxLength={500}
              autoFocus
            />
            <button className="btn primary sm" type="submit" disabled={busy || !text.trim()}>
              Send
            </button>
          </form>
        </section>
      )}
      {!open && ann && (
        <div className="bot-announce" role="status">
          <button className="bot-x" onClick={dismiss} aria-label="Dismiss the announcement">
            <Ico svg={I.close} />
          </button>
          <span className="bot-bubble">{ann.message}</span>
          <span className={`bot-robot ${still ? 'still' : ''}`}>
            <Robot still={still} />
          </span>
        </div>
      )}
      {!open && (
        <button
          className="chat-fab"
          onClick={openChat}
          aria-label="Open the help chatbot"
          title="Help chatbot"
        >
          <Ico svg={I.comment} />
        </button>
      )}
    </div>
  );
}
