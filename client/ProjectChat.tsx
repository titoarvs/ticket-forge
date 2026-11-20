'use client';
// The project's AI chatbot: a chat panel on every project page (and so on the refine board) that
// replaced the AI helper.
// The person describes an issue in plain words; the assistant answers with a draft preview (title,
// description, type, story points, priority, acceptance criteria) that they can edit. Nothing
// becomes an issue until they click Create;
// Create is off while the title is empty. The conversation is saved on the server per person and
// per project and is restored when the panel opens. The server decides everything (access, the
// plan's AI limit); the panel shows its answers.
// The layout (message list, bubbles, one input at the bottom, a typing indicator) follows common
// LLM chat apps.
import { useCallback, useEffect, useRef, useState } from 'react';
import { P, can, toast, pullRemote, TYPES, PRIORITIES, type Any } from './core';
import { chatHistory, chatSend, chatCreate, chatDiscard } from './api/chat';
import { Ico, I, Spinner } from './ui';

const POINTS = [1, 2, 3, 5, 8, 13, 21];
const WELCOME =
  'Hi! Tell me what you need, for example “Users should reset their password by email”. I’ll draft the issue for you to check and create.';
const EXAMPLES = ['Add a password reset by email', 'Bug: the export button does nothing on Safari'];

/**
 * The draft of one assistant message: every field can be edited here; Create sends the edited
 * fields.
 */
function DraftPreview({
  msg,
  onCreate,
  onDiscard,
}: {
  msg: Any;
  onCreate: (d: Any) => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const [d, setD] = useState<Any>(() => ({
    ...msg.draft,
    criteria: (msg.draft.acceptanceCriteria || []).join('\n'),
  }));
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: Any) => setD((x: Any) => ({ ...x, [k]: v }));
  const title = String(d.title || '').trim();
  const mayCreate = can('issue.create');
  const create = async () => {
    if (!title || busy) return;
    setBusy(true);
    const { criteria, ...rest } = d;
    try {
      await onCreate({ ...rest, title, acceptanceCriteria: String(criteria || '').split('\n') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pchat-draft" aria-label="Draft preview">
      <span className="loz t-blocked" title="A draft isn’t in the backlog until you click Create">
        Draft
      </span>
      <label className="pchat-f">
        <span>Title</span>
        <input
          value={d.title || ''}
          onChange={(e) => set('title', e.target.value)}
          maxLength={200}
          aria-label="Title"
          aria-invalid={!title}
        />
      </label>
      {!title && <div className="pchat-hint">A title is needed to create the issue.</div>}
      <div className="pchat-row">
        <label className="pchat-f">
          <span>Type</span>
          <select
            className="select compact"
            value={d.type}
            onChange={(e) => set('type', e.target.value)}
            aria-label="Type"
          >
            {TYPES.map((t: string) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="pchat-f">
          <span>Priority</span>
          <select
            className="select compact"
            value={d.priority}
            onChange={(e) => set('priority', e.target.value)}
            aria-label="Priority"
          >
            {PRIORITIES.map((t: string) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="pchat-f">
          <span>Story points</span>
          <select
            className="select compact"
            value={d.storyPoints ?? ''}
            onChange={(e) => set('storyPoints', e.target.value ? Number(e.target.value) : null)}
            aria-label="Story points"
          >
            <option value="">–</option>
            {[...new Set([...POINTS, d.storyPoints].filter(Boolean))].map((p: Any) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="pchat-f">
        <span>Description</span>
        <textarea
          value={d.description || ''}
          onChange={(e) => set('description', e.target.value)}
          rows={4}
          aria-label="Description"
        />
      </label>
      <label className="pchat-f">
        <span>Acceptance criteria (one per line)</span>
        <textarea
          value={d.criteria}
          onChange={(e) => set('criteria', e.target.value)}
          rows={4}
          aria-label="Acceptance criteria"
        />
      </label>
      <div className="pchat-actions">
        <button
          className="btn sm primary"
          onClick={create}
          disabled={!title || busy || !mayCreate}
          title={
            !mayCreate
              ? 'You don’t have permission to create issues'
              : !title
                ? 'Add a title first'
                : 'Create this issue in the backlog'
          }
        >
          Create
        </button>
        <button className="btn sm subtle" onClick={onDiscard} disabled={busy}>
          Discard
        </button>
      </div>
    </div>
  );
}

export function ProjectChat() {
  const pid = P()?.id as string;
  const [open, setOpen] = useState(true);
  const [msgs, setMsgs] = useState<Any[] | null>(null);
  const [err, setErr] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; limit: boolean } | null>(null);
  const end = useRef<HTMLDivElement>(null);

  // The saved conversation of this person in this project, each time the panel opens or the project
  // changes.
  const load = useCallback(async () => {
    setErr('');
    try {
      setMsgs((await chatHistory(pid)).messages);
    } catch (e: Any) {
      setMsgs([]);
      setErr(e.message);
    }
  }, [pid]);
  useEffect(() => {
    setMsgs(null);
    if (open) load();
  }, [load, open]);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [msgs, busy, notice, open]);

  const send = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setNotice(null);
    setText('');
    setMsgs((m) => [...(m || []), { id: 'pending', role: 'user', content: value }]);
    try {
      const r = await chatSend(pid, value);
      setMsgs((m) => [...(m || []).filter((x) => x.id !== 'pending'), ...r.messages]);
    } catch (e: Any) {
      // Not sent to the assistant (or it failed): nothing was saved, so the request goes back into
      // the input.
      setMsgs((m) => (m || []).filter((x) => x.id !== 'pending'));
      setText(value);
      setNotice({
        text: e?.message || 'Something went wrong. Please try again.',
        limit: e?.status === 402 && e?.body?.code === 'limit',
      });
    } finally {
      setBusy(false);
    }
  };

  const patchDraft = (id: string, draft: Any) =>
    setMsgs((m) => (m || []).map((x) => (x.id === id ? { ...x, draft } : x)));
  const create = async (msg: Any, draft: Any) => {
    try {
      const r = await chatCreate(pid, msg.id, draft);
      patchDraft(msg.id, { ...msg.draft, ...draft, created: r.issue });
      toast(`${r.issue.key} created.`);
      await pullRemote({ quiet: true });
    } catch (e: Any) {
      toast(`Not created: ${e.message}`, 'err');
    }
  };
  const discard = async (msg: Any) => {
    try {
      await chatDiscard(pid, msg.id);
      patchDraft(msg.id, { ...msg.draft, discarded: true });
    } catch (e: Any) {
      toast(e.message, 'err');
    }
  };

  const list = msgs || [];
  return (
    <section className={`pchat ${open ? 'open' : ''}`} aria-label="AI chat">
      <header className="pchat-h">
        <Ico svg={I.sparkle} />
        <b>AI helper</b>
        <span className="spacer" />
        <button
          className="btn sm subtle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Collapse the AI chat' : 'Open the AI chat'}
        >
          <Ico svg={open ? I.close : I.comment} />
        </button>
      </header>
      {open && (
        <>
          <div className="pchat-log" role="log" aria-label="Messages" aria-live="polite">
            {msgs === null && <Spinner />}
            {err && <div className="chat-msg bot denied">{err}</div>}
            {msgs !== null && !err && list.length === 0 && (
              <>
                <div className="chat-msg bot">{WELCOME}</div>
                <div className="chat-hints">
                  {EXAMPLES.map((x) => (
                    <button key={x} className="btn sm subtle" onClick={() => setText(x)}>
                      {x}
                    </button>
                  ))}
                </div>
              </>
            )}
            {list.map((m) => (
              <div key={m.id} className={`pchat-turn ${m.role === 'user' ? 'me' : 'bot'}`}>
                <div className={`chat-msg ${m.role === 'user' ? 'me' : 'bot'}`}>{m.content}</div>
                {m.draft && !m.draft.created && !m.draft.discarded && (
                  <DraftPreview
                    key={m.id}
                    msg={m}
                    onCreate={(d) => create(m, d)}
                    onDiscard={() => discard(m)}
                  />
                )}
                {m.draft?.created && (
                  <div className="pchat-hint">
                    Created {m.draft.created.key} “{m.draft.created.title}” in the backlog.
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="chat-msg bot" aria-label="The assistant is writing">
                <Spinner />
              </div>
            )}
            {notice && (
              <div
                className="chat-msg bot denied"
                role="alert"
                data-limit={notice.limit ? 'true' : undefined}
              >
                {notice.limit ? `AI limit reached. ${notice.text}` : notice.text}
              </div>
            )}
            <div ref={end} />
          </div>
          <form
            className="pchat-in"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder="Describe the issue you need…"
              aria-label="Message"
              maxLength={2000}
            />
            <button
              className="btn primary sm"
              type="submit"
              disabled={busy || !text.trim() || msgs === null}
            >
              Send
            </button>
          </form>
        </>
      )}
    </section>
  );
}
