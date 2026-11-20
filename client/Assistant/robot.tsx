'use client';
// The release announcement robot beside the chat button. The message comes from GET /api/chatbot
// (only while the RELEASE_ANNOUNCEMENT flag is on) and shows once per message; with
// prefers-reduced-motion it shows without animation.
import { useEffect, useState } from 'react';
import { api } from '../core';
import { Ico, I } from '../ui';

const SEEN = 'tf.announce.seen';
type Ann = { id: string; message: string };

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

function seenId() {
  try {
    return localStorage.getItem(SEEN);
  } catch {
    return null;
  }
}

function markSeen(id: string) {
  try {
    localStorage.setItem(SEEN, id);
  } catch {
    /* private mode */
  }
}

/** The announcement not yet seen (asked once when the app opens), and dismissing it. */
export function useAnnouncement() {
  const [ann, setAnn] = useState<Ann | null>(null);
  useEffect(() => {
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
  const dismiss = () => {
    if (ann) markSeen(ann.id);
    setAnn(null);
  };
  return { ann, dismiss };
}

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

export function Announcement({ ann, onDismiss }: { ann: Ann; onDismiss: () => void }) {
  const [still, setStill] = useState(false);
  useEffect(() => setStill(reducedMotion()), []);
  return (
    <div className="bot-announce" role="status">
      <button className="bot-x" onClick={onDismiss} aria-label="Dismiss the announcement">
        <Ico svg={I.close} />
      </button>
      <span className="bot-bubble">{ann.message}</span>
      <span className={`bot-robot ${still ? 'still' : ''}`}>
        <Robot still={still} />
      </span>
    </div>
  );
}
