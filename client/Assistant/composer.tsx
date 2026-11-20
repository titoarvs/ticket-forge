'use client';
// Where the person types: Enter sends, Shift+Enter starts a new line, and Stop ends a reply that is
// still being written (nothing is saved and the message comes back into the box).
import type { AssistantState } from './use-assistant';

export function Composer({ a }: { a: AssistantState }) {
  const placeholder = a.pid ? 'Ask about this project or describe an issue…' : 'Ask a question…';
  return (
    <form
      className="pchat-in"
      onSubmit={(e) => {
        e.preventDefault();
        a.send();
      }}
    >
      <textarea
        value={a.text}
        onChange={(e) => a.setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            a.send();
          }
        }}
        rows={2}
        placeholder={placeholder}
        aria-label="Message"
        maxLength={2000}
        autoFocus
      />
      {a.busy ? (
        <button className="btn sm" type="button" onClick={a.stop}>
          Stop
        </button>
      ) : (
        <button className="btn primary sm" type="submit" disabled={!a.text.trim() || !a.msgs}>
          Send
        </button>
      )}
    </form>
  );
}
