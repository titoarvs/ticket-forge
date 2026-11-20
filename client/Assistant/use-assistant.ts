'use client';
// The chat's state: the conversation (saved per project on the server; outside projects kept here
// and sent with each message), the reply while it streams, sending, stopping, starting over, and
// creating or discarding an issue draft.
import { useEffect, useRef, useState } from 'react';
import { toast, pullRemote, type Any } from '../core';
import { chatHistory, chatClear, chatTurn, chatCreate, chatDiscard } from '../api/chat';

export type Notice = { text: string; limit: boolean };

const withDraft = (list: Any[] | null, id: string, draft: Any) =>
  (list || []).map((x) => (x.id === id ? { ...x, draft } : x));

export function useAssistant(pid: string | null, open: boolean) {
  const [msgs, setMsgs] = useState<Any[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState('');
  const [status, setStatus] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const outside = useRef<Any[]>([]);
  const abort = useRef<AbortController | null>(null);

  // The conversation of the place the person is in, when the chat opens or the project changes.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setNotice(null);
    if (!pid) {
      setMsgs(outside.current);
      return;
    }
    setMsgs(null);
    chatHistory(pid)
      .then((r) => active && setMsgs(r.messages))
      .catch((e) => {
        if (!active) return;
        setMsgs([]);
        setNotice({ text: e.message, limit: false });
      });
    return () => {
      active = false;
    };
  }, [pid, open]);

  const send = async (raw?: string) => {
    const value = (raw ?? text).trim();
    if (!value || busy || msgs === null) return;
    const before = msgs;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setNotice(null);
    setText('');
    setMsgs([...before, { id: 'pending', role: 'user', content: value }]);
    try {
      const body = { message: value, projectId: pid, history: pid ? undefined : before };
      const out = await chatTurn(body, ctrl.signal, {
        delta: (t) => setLive((x) => x + t),
        status: (s) => (s === 'reset' ? setLive('') : setStatus(s)),
      });
      const next = [...before, ...out.messages];
      if (!pid) outside.current = next;
      setMsgs(next);
    } catch (e: Any) {
      // Nothing was saved: the message goes back into the input.
      setMsgs(before);
      setText(value);
      if (!ctrl.signal.aborted)
        setNotice({
          text: e?.message || 'Something went wrong. Please try again.',
          limit: e?.status === 402,
        });
    } finally {
      setBusy(false);
      setLive('');
      setStatus('');
      abort.current = null;
    }
  };

  const stop = () => abort.current?.abort();

  const clear = async () => {
    if (busy) return;
    try {
      if (pid) await chatClear(pid);
      else outside.current = [];
      setMsgs([]);
      setNotice(null);
    } catch (e: Any) {
      toast(e.message, 'err');
    }
  };

  const create = async (msg: Any, draft: Any) => {
    if (!pid) return;
    try {
      const r = await chatCreate(pid, msg.id, draft);
      setMsgs((m) => withDraft(m, msg.id, { ...msg.draft, ...draft, created: r.issue }));
      toast(`${r.issue.key} created.`);
      await pullRemote({ quiet: true });
    } catch (e: Any) {
      toast(`Not created: ${e.message}`, 'err');
    }
  };

  const discard = async (msg: Any) => {
    if (!pid) return;
    try {
      await chatDiscard(pid, msg.id);
      setMsgs((m) => withDraft(m, msg.id, { ...msg.draft, discarded: true }));
    } catch (e: Any) {
      toast(e.message, 'err');
    }
  };

  return {
    pid,
    msgs,
    text,
    setText,
    busy,
    live,
    status,
    notice,
    send,
    stop,
    clear,
    create,
    discard,
  };
}

export type AssistantState = ReturnType<typeof useAssistant>;
