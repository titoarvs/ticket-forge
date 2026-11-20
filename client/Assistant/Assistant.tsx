'use client';
// Ticket Forge AI: the one chat of the app, in the corner of every signed-in page (it replaced the
// help chatbot and the project's AI helper). On a project page it knows that project and drafts
// issues; elsewhere it answers how the app works and about the person's projects. The parts are in
// client/Assistant/.
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { P, useStore } from '../core';
import { Ico, I } from '../ui';
import { useAssistant, type AssistantState } from './use-assistant';
import { Messages } from './messages';
import { Composer } from './composer';
import { useAnnouncement, Announcement } from './robot';

/** The project whose page is open (and loaded), else null. */
function useProjectId() {
  useStore();
  const pathname = usePathname() || '';
  const id = pathname.match(/^\/p\/([^/]+)/)?.[1];
  return id && P()?.id === id ? id : null;
}

function Header({ a, onClose }: { a: AssistantState; onClose: () => void }) {
  const where = a.pid ? P()?.name : 'All projects';
  return (
    <header className="chat-h">
      <Ico svg={I.sparkle} />
      <b>Ticket Forge AI</b>
      <span className="chat-where" title={a.pid ? 'It knows this project' : 'No project open'}>
        {where}
      </span>
      <span className="spacer" />
      <button
        className="btn sm subtle"
        onClick={a.clear}
        disabled={a.busy || !a.msgs?.length}
        title="Start a new conversation"
      >
        New chat
      </button>
      <button className="btn sm subtle" onClick={onClose} aria-label="Close the chat">
        <Ico svg={I.close} />
      </button>
    </header>
  );
}

export function Assistant() {
  const [open, setOpen] = useState(false);
  const a = useAssistant(useProjectId(), open);
  const { ann, dismiss } = useAnnouncement();
  const openChat = () => {
    setOpen(true);
    dismiss();
  };
  return (
    <div className="chatbot">
      {open && (
        <section
          className="chat-panel"
          role="dialog"
          aria-label="Ticket Forge AI"
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        >
          <Header a={a} onClose={() => setOpen(false)} />
          <Messages a={a} />
          <Composer a={a} />
        </section>
      )}
      {!open && ann && <Announcement ann={ann} onDismiss={dismiss} />}
      {!open && (
        <button
          className="chat-fab"
          onClick={openChat}
          aria-label="Open Ticket Forge AI"
          title="Ticket Forge AI"
        >
          <Ico svg={I.sparkle} />
        </button>
      )}
    </div>
  );
}
