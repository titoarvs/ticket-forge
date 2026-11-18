'use client';
// The project's AI helper: a chat panel on every project page that searches tickets, generates ticket drafts and assigns
// tickets. The server decides what the person may do (project access and the per-person helper settings); the panel
// shows the server's answer, including its refusals. A generated ticket is a draft until someone approves it here.
import { useCallback, useEffect, useRef, useState } from 'react';
import { S, P, can, emit, toast, pullRemote, type Any } from './core';
import { helperState, helperSearch, helperGenerate, helperAssign, decideDraft, listHelperPerms, saveHelperPerms } from './api/helper';
import { Ico, I, Spinner } from './ui';

type Mode = 'search' | 'generate' | 'assign';
type Msg = { from: 'bot' | 'me'; text: string; kind?: string; tickets?: Any[] };

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'search', label: 'Search', hint: 'Find tickets, e.g. login' },
  { id: 'generate', label: 'Generate', hint: 'Describe a ticket to draft' },
  { id: 'assign', label: 'Assign', hint: 'Ticket key, e.g. TF-12' },
];
const WELCOME = 'Hi! I can search this project’s tickets, draft new ones for you to approve, and assign tickets to people in the project.';

const openIssue = (id: string) => {
  Object.assign(S, { drawer: { kind: 'issue', id }, menu: null });
  emit();
};

/** Who may search, generate and assign with the helper, one row per person of the project (for people who edit the settings). */
function HelperSettings({ pid }: { pid: string }) {
  const [rows, setRows] = useState<Any[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    listHelperPerms(pid)
      .then(setRows)
      .catch((e: Any) => setErr(e.message));
  }, [pid]);
  const change = async (row: Any, key: string, value: boolean) => {
    const permissions = { ...row.permissions, [key]: value };
    setRows((r) => (r || []).map((x) => (x.id === row.id ? { ...x, permissions } : x)));
    try {
      await saveHelperPerms(pid, row.id, permissions);
    } catch (e: Any) {
      toast(`Not saved: ${e.message}`, 'err');
      setRows((r) => (r || []).map((x) => (x.id === row.id ? row : x)));
    }
  };
  if (err) return <div className="helper-note">{err}</div>;
  if (!rows) return <Spinner />;
  return (
    <div className="helper-settings">
      <div className="helper-note">What each person can do with the helper in this project.</div>
      <table>
        <thead>
          <tr>
            <th>Person</th>
            <th>Search</th>
            <th>Generate</th>
            <th>Assign</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              {(['search', 'generate', 'assign'] as const).map((k) => (
                <td key={k}>
                  <input
                    type="checkbox"
                    checked={Boolean(r.permissions[k])}
                    disabled={r.owner}
                    onChange={(e) => change(r, k, e.target.checked)}
                    aria-label={`${r.name} can ${k}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProjectHelper() {
  const pid = P()?.id as string;
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<Mode>('search');
  const [msgs, setMsgs] = useState<Msg[]>([{ from: 'bot', text: WELCOME }]);
  const [text, setText] = useState('');
  const [ticket, setTicket] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<Any>(null);
  const [settings, setSettings] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await helperState(pid));
    } catch (e: Any) {
      setInfo({ error: e.message });
    }
  }, [pid]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [msgs, busy, open, info]);

  const say = (m: Msg) => setMsgs((x) => [...x, m]);
  const refused = (e: Any) => say({ from: 'bot', text: e?.message || 'Something went wrong. Please try again.', kind: 'denied' });

  const run = async (me: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    say({ from: 'me', text: me });
    try {
      await work();
    } catch (e) {
      refused(e);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const value = text.trim();
    if (mode === 'assign') {
      const key = ticket.trim();
      const person = (info?.people || []).find((p: Any) => p.id === assignee);
      if (!key || !assignee) return;
      run(`Assign ${key} to ${person?.name || 'someone'}`, async () => {
        const r = await helperAssign(pid, key, assignee);
        say({ from: 'bot', text: `${r.ticket.key} is now assigned to ${r.ticket.assignee}.` });
        setTicket('');
        await pullRemote({ quiet: true });
      });
      return;
    }
    if (!value) return;
    setText('');
    if (mode === 'search')
      run(`Search: ${value}`, async () => {
        const r = await helperSearch(pid, value);
        say(
          r.tickets.length
            ? { from: 'bot', text: `${r.tickets.length}${r.more ? '+' : ''} ticket${r.tickets.length === 1 ? '' : 's'} match “${value}”:`, tickets: r.tickets }
            : { from: 'bot', text: `No tickets match “${value}”.` },
        );
      });
    else
      run(`Generate: ${value}`, async () => {
        const r = await helperGenerate(pid, value);
        say({ from: 'bot', text: `I drafted “${r.draft.ticket.title}”. It’s a draft until you approve it below.` });
        await load();
      });
  };

  const decide = async (d: Any, action: 'approve' | 'discard') => {
    try {
      const r = await decideDraft(pid, d.id, action);
      if (action === 'approve') {
        say({ from: 'bot', text: `Approved: ${r.issue.key} “${r.issue.title}” is now in the backlog.` });
        await pullRemote({ quiet: true });
      } else toast('Draft discarded.');
      await load();
    } catch (e) {
      refused(e);
    }
  };

  const mode0 = MODES.find((m) => m.id === mode)!;
  const drafts: Any[] = info?.drafts || [];
  return (
    <section className={`helper ${open ? 'open' : ''}`} aria-label="AI helper">
      <header className="helper-h">
        <Ico svg={I.sparkle} />
        <b>AI helper</b>
        <span className="spacer" />
        {open && info?.canManage && (
          <button className="btn sm subtle" onClick={() => setSettings((s) => !s)} aria-pressed={settings} title="Who can use the helper">
            Access
          </button>
        )}
        <button className="btn sm subtle" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? 'Collapse the AI helper' : 'Open the AI helper'}>
          <Ico svg={open ? I.close : I.comment} />
        </button>
      </header>
      {open && (
        <>
          <div className="helper-log" role="log" aria-live="polite">
            {info?.error ? (
              <div className="chat-msg bot denied">{info.error}</div>
            ) : settings ? (
              <HelperSettings pid={pid} />
            ) : (
              <>
                {msgs.map((m, i) => (
                  <div key={i} className={`chat-msg ${m.from} ${m.kind === 'denied' ? 'denied' : ''}`}>
                    {m.text}
                    {m.tickets && (
                      <ul className="helper-results">
                        {m.tickets.map((t) => (
                          <li key={t.id}>
                            <button className="link-btn" onClick={() => openIssue(t.id)}>
                              <b>{t.key}</b> {t.title}
                            </button>
                            <span className="helper-sub">
                              {t.status}
                              {t.assignee ? ` · ${t.assignee}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                {busy && (
                  <div className="chat-msg bot">
                    <Spinner />
                  </div>
                )}
                <div className="helper-drafts" aria-label="Drafts">
                  <div className="helper-sub">Drafts ({drafts.length})</div>
                  {drafts.length === 0 && <div className="helper-sub">No drafts waiting for approval.</div>}
                  {drafts.map((d) => (
                    <div key={d.id} className="helper-draft">
                      <span className="loz t-blocked" title="An AI-generated ticket that isn’t in the backlog until it is approved">Draft</span> <b>{d.ticket.title}</b>
                      <div className="helper-sub">by {d.createdBy || 'someone'}</div>
                      <div className="helper-actions">
                        {can('issue.create') && (
                          <button className="btn sm primary" onClick={() => decide(d, 'approve')}>
                            Approve
                          </button>
                        )}
                        <button className="btn sm subtle" onClick={() => decide(d, 'discard')}>
                          Discard
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div ref={end} />
              </>
            )}
          </div>
          <div className="helper-modes" role="tablist" aria-label="What should the helper do">
            {MODES.map((m) => (
              <button key={m.id} role="tab" aria-selected={mode === m.id} className={`btn sm ${mode === m.id ? 'primary' : 'subtle'}`} onClick={() => setMode(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          <form
            className="chat-in"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {mode === 'assign' ? (
              <>
                <input value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder={mode0.hint} aria-label="Ticket key" maxLength={40} />
                <select className="select compact" value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assignee">
                  <option value="">Assignee…</option>
                  {(info?.people || []).map((p: Any) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder={mode0.hint} aria-label={`${mode0.label}: ask the AI helper`} maxLength={2000} />
            )}
            <button className="btn primary sm" type="submit" disabled={busy || !!info?.error || (mode === 'assign' ? !ticket.trim() || !assignee : !text.trim())}>
              {mode === 'search' ? 'Search' : mode === 'generate' ? 'Draft' : 'Assign'}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
