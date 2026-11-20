// Reading the model's reply: the text the person sees (everything before the [[DRAFT …]] line) and
// the draft request, if any. While the reply streams, a tail that could be the start of the marker
// is held back so the marker never flashes on screen.
export const DRAFT_MARK = '[[DRAFT';

/** The visible part of the reply. final: the reply is complete (nothing more is coming). */
export function visiblePart(text: string, final = false) {
  const at = text.indexOf(DRAFT_MARK);
  if (at >= 0) return text.slice(0, at);
  if (final) return text;
  for (let n = Math.min(DRAFT_MARK.length - 1, text.length); n > 0; n--)
    if (DRAFT_MARK.startsWith(text.slice(-n))) return text.slice(0, -n);
  return text;
}

/** null: no draft asked for. Otherwise the one-line request ('' when the model left it empty). */
export function draftRequest(text: string) {
  const at = text.indexOf(DRAFT_MARK);
  if (at < 0) return null;
  const m = text.slice(at).match(/^\[\[DRAFT:?\s*([\s\S]*?)(\]\]|$)/);
  return (m?.[1] || '').trim();
}

/** Sends the visible text as it grows; reset() starts over (the AI switched provider mid-reply). */
export function replyStream(onDelta: (text: string) => void) {
  let full = '';
  let sent = 0;
  return {
    push(chunk: string) {
      full += chunk;
      const v = visiblePart(full);
      if (v.length > sent) {
        onDelta(v.slice(sent));
        sent = v.length;
      }
    },
    reset() {
      full = '';
      sent = 0;
    },
  };
}
