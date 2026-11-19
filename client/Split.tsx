'use client';
// Split issues into smaller ones, many at a time (Epics page → AI actions, or an epic's panel).
// Pick the issues (big ones are ticked for you), the AI proposes small tickets for each or says why
// one is fine as it is, you review, then apply: the first part keeps the original issue (key,
// history, comments, links), the others become new issues beside it.
import { useState } from 'react';
import {
  S,
  P,
  api,
  mutate,
  toast,
  openModal,
  closeModal,
  can,
  readNdjson,
  aiBody,
  startTask,
  newTicket,
  logEvent,
  addLink,
  isSub,
  type Any,
} from './core';
import { Ico, I, Modal, Spinner, TypeIcon, StatusLoz } from './ui';
import { TA, CB, SF, MenuItem } from './fields';

/**
 * Worth splitting: estimated above 3 points, or not estimated with many acceptance criteria, many
 * test cases or a long description.
 */
export const isBig = (t: Any) =>
  t.storyPoints != null
    ? t.storyPoints > 3
    : (t.acceptanceCriteria?.length || 0) > 6 ||
      (t.testCases?.length || 0) >= 15 ||
      String(t.description || '').length > 1200;

function SplitPicker({ epicId }: { epicId?: string }) {
  const p = P();
  const [scope, setScope] = useState(epicId || 'all');
  const pool = p.tickets.filter(
    (t: Any) =>
      !isSub(t) && (scope === 'all' || (scope === 'none' ? !t.epicId : t.epicId === scope)),
  );
  const [pick, setPick] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(p.tickets.map((t: Any) => [t.id, isBig(t)])),
  );
  const [text, setText] = useState('');
  const chosen = pool.filter((t: Any) => pick[t.id]);
  const big = pool.filter(isBig).length;
  const go = () => {
    closeModal();
    runSplit(
      chosen.map((t: Any) => t.id),
      text.trim(),
    );
  };
  return (
    <Modal
      title="Split issues into smaller ones"
      wide
      actions={[
        { label: 'Cancel' },
        {
          label: chosen.length ? `Propose splits for ${chosen.length}` : 'Pick issues',
          kind: 'ai',
          disabled: !chosen.length || chosen.length > 60,
          onClick: go,
        },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        The AI splits each picked issue into small tickets (one testable behaviour each, 1–3 points,
        your team’s acceptance-criteria rules) that cover exactly its scope, and shares out its test
        cases. Issues that are already small stay as they are. You review everything before it
        changes.
      </p>
      <div className="row split-tools">
        <SF
          filter
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          aria-label="Which issues"
        >
          <MenuItem value="all">All epics</MenuItem>
          {p.epics.map((e: Any) => (
            <MenuItem key={e.id} value={e.id}>
              {e.key} {e.title}
            </MenuItem>
          ))}
          <MenuItem value="none">No epic</MenuItem>
        </SF>
        <button
          className="btn sm subtle"
          onClick={() =>
            setPick({ ...pick, ...Object.fromEntries(pool.map((t: Any) => [t.id, isBig(t)])) })
          }
        >
          Tick the big ones ({big})
        </button>
        <button
          className="btn sm subtle"
          onClick={() =>
            setPick({ ...pick, ...Object.fromEntries(pool.map((t: Any) => [t.id, true])) })
          }
        >
          All
        </button>
        <button
          className="btn sm subtle"
          onClick={() =>
            setPick({ ...pick, ...Object.fromEntries(pool.map((t: Any) => [t.id, false])) })
          }
        >
          None
        </button>
        <span className="spacer" />
        <span className="muted small">
          {chosen.length} of {pool.length} picked{chosen.length > 60 ? ' · 60 at a time' : ''}
        </span>
      </div>
      <div className="split-list">
        {pool.map((t: Any) => (
          <label key={t.id} className={`split-row ${pick[t.id] ? '' : 'off'}`}>
            <CB
              checked={Boolean(pick[t.id])}
              onChange={() => setPick({ ...pick, [t.id]: !pick[t.id] })}
              aria-label={`Split ${t.key}`}
            />
            <TypeIcon type={t.type} />
            <span className="key">{t.key}</span>
            <span className="split-title">{t.title}</span>
            {isBig(t) && <span className="pg-badge dyn">big</span>}
            <span className="muted small">
              {t.acceptanceCriteria?.length || 0} AC · {t.testCases?.length || 0} tests
            </span>
            <StatusLoz s={t.status} />
            <span className="sp" title="Story points">
              {t.storyPoints ?? '–'}
            </span>
          </label>
        ))}
        {!pool.length && <p className="muted small">No issues here.</p>}
      </div>
      <label className="field" style={{ marginTop: 10 }}>
        <span>Guidance (optional)</span>
        <TA
          rows={2}
          value={text}
          placeholder="e.g. Split by user role. Keep API and UI work in separate issues."
          onChange={(e) => setText(e.target.value)}
        />
      </label>
    </Modal>
  );
}
export { SplitReview };
export const openSplitIssues = (epicId?: string) => openModal(<SplitPicker epicId={epicId} />);

async function runSplit(ids: string[], instruction: string) {
  const ctrl = new AbortController();
  const task = startTask(`Splitting ${ids.length} issue${ids.length > 1 ? 's' : ''}`, {
    total: ids.length,
    kind: 'ai',
    cancel: () => ctrl.abort(),
  });
  try {
    const res = await api(`/api/projects/${P().id}/split`, {
      method: 'POST',
      raw: true,
      signal: ctrl.signal,
      body: aiBody({ ticketIds: ids, instruction }),
    });
    let out: Any = null;
    await readNdjson(res, (ev) => {
      if (ev.type === 'progress')
        task.update({ detail: ev.message, done: ev.done, total: ev.total });
      else if (ev.type === 'done') out = ev;
      else if (ev.type === 'error') throw new Error(ev.error);
    });
    if (!out) throw new Error('Nothing came back.');
    const n = out.results.filter((r: Any) => r.action === 'split').length;
    task.finish(`${n} to split, ${out.results.length - n} fine as they are`);
    openModal(<SplitReview results={out.results} />);
  } catch (e: Any) {
    if (e.name === 'AbortError') {
      task.fail('');
      toast('Nothing was changed.', 'info', { title: 'Stopped splitting' });
    } else task.fail(`Couldn’t split the issues: ${e.message}`);
  }
}

function SplitReview({ results }: { results: Any[] }) {
  const p = P();
  const splits = results.filter((r) => r.action === 'split');
  const kept = results.filter((r) => r.action !== 'split');
  const [pick, setPick] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(splits.map((r) => [r.ticketId, true])),
  );
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const chosen = splits.filter((r) => pick[r.ticketId]);
  const pts = (list: Any[]) => list.reduce((n, x) => n + (x.storyPoints || 0), 0);
  const tcTitle = (t: Any, id: string) => t?.testCases.find((c: Any) => c.id === id)?.title || '';
  const apply = () => {
    let made = 0;
    mutate((pp: Any) => {
      for (const r of chosen) {
        const i = pp.tickets.findIndex((x: Any) => x.id === r.ticketId);
        if (i < 0) continue;
        const orig = pp.tickets[i];
        const tcs = orig.testCases || [];
        const tcsFor = (part: Any) =>
          part.testCaseIds.map((id: string) => tcs.find((c: Any) => c.id === id)).filter(Boolean);
        // The first part keeps the original issue: key, history, comments, PRs, links.
        const [first, ...rest] = r.parts;
        Object.assign(orig, {
          title: first.title,
          type: first.type,
          storyPoints: first.storyPoints,
          userStory: first.userStory,
          description: first.description,
          acceptanceCriteria: first.acceptanceCriteria,
          testCases: tcsFor(first),
        });
        logEvent(orig, `split into ${r.parts.length} issues with Claude`);
        rest.forEach((part: Any, k: number) => {
          const nt = newTicket({
            epicId: orig.epicId,
            sprintId: orig.sprintId,
            assignee: orig.assignee,
            status: orig.status,
            labels: [...(orig.labels || [])],
            ...(orig.layer ? { layer: orig.layer } : {}),
            title: part.title,
            type: part.type,
            storyPoints: part.storyPoints,
            userStory: part.userStory,
            description: part.description,
            acceptanceCriteria: part.acceptanceCriteria,
            testCases: tcsFor(part),
          });
          logEvent(nt, `split from ${orig.key} with Claude`);
          pp.tickets.splice(i + 1 + k, 0, nt);
          addLink(orig, 'relates to', nt);
          made++;
        });
      }
    });
    closeModal();
    toast(
      `${chosen.length} issue${chosen.length === 1 ? '' : 's'} split into ${chosen.length + made} smaller ones. The first part of each keeps its key; the rest are linked to it. ⌘Z undoes this.`,
      'ok',
      { title: 'Issues split' },
    );
  };
  return (
    <Modal
      title="Review the splits"
      wide
      persistent
      actions={[
        { label: 'Cancel' },
        {
          label: chosen.length
            ? `Split ${chosen.length} issue${chosen.length === 1 ? '' : 's'}`
            : 'Nothing to split',
          kind: 'primary',
          disabled: !chosen.length,
          onClick: apply,
        },
      ]}
    >
      <div className="sync-sum">
        <span>
          <b>{splits.length}</b> to split into {splits.reduce((n, r) => n + r.parts.length, 0)}{' '}
          smaller issues
        </span>
        <span>{kept.length} fine as they are</span>
      </div>
      <div className="sync-pane">
        {splits.map((r) => {
          const t = p.tickets.find((x: Any) => x.id === r.ticketId);
          const o = open[r.ticketId] ?? splits.length <= 3;
          return (
            <div key={r.ticketId} className={`pt-page ${pick[r.ticketId] ? '' : 'off'}`}>
              <div className="pt-head">
                <CB
                  checked={Boolean(pick[r.ticketId])}
                  onChange={() => setPick({ ...pick, [r.ticketId]: !pick[r.ticketId] })}
                  aria-label={`Split ${r.key}`}
                />
                <button
                  type="button"
                  className={`as-h ${o ? '' : 'closed'}`}
                  style={{ flex: 1, width: 'auto' }}
                  onClick={() => setOpen({ ...open, [r.ticketId]: !o })}
                >
                  <Ico svg={I.chevron} />
                  <span className="key">{r.key}</span>
                  <b className="split-title">{t?.title}</b>
                  <span className="muted small">
                    {t?.storyPoints ?? '–'} pts → {r.parts.length} issues · {pts(r.parts)} pts
                  </span>
                </button>
              </div>
              {r.reason && <p className="muted small fm-desc">{r.reason}</p>}
              {o && (
                <ol className="split-parts">
                  {r.parts.map((part: Any, k: number) => (
                    <li key={k}>
                      <div>
                        <span className="sp" title="Story points">
                          {part.storyPoints ?? '–'}
                        </span>{' '}
                        <b>{part.title}</b>{' '}
                        {k === 0 ? (
                          <span className="pg-badge">keeps {r.key}</span>
                        ) : (
                          <span className="pg-badge dyn">new</span>
                        )}
                      </div>
                      {part.userStory && (
                        <div className="small" style={{ fontStyle: 'italic' }}>
                          {part.userStory}
                        </div>
                      )}
                      <ul className="small split-ac">
                        {part.acceptanceCriteria.map((a: string, i: number) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                      {part.testCaseIds.length > 0 ? (
                        <div className="muted small">
                          {part.testCaseIds.length} test case
                          {part.testCaseIds.length > 1 ? 's' : ''}:{' '}
                          {part.testCaseIds
                            .slice(0, 4)
                            .map((id: string) => tcTitle(t, id))
                            .filter(Boolean)
                            .join(' · ')}
                          {part.testCaseIds.length > 4 ? ' …' : ''}
                        </div>
                      ) : (
                        <div className="warn-text small">
                          No test cases yet: none of {r.key}’s test cases cover this. Write them
                          after splitting.
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
        {kept.length > 0 && (
          <>
            <h4 className="sync-h">Fine as they are</h4>
            <ul className="split-kept small">
              {kept.map((r) => (
                <li key={r.ticketId}>
                  <span className="key">{r.key}</span>{' '}
                  {p.tickets.find((x: Any) => x.id === r.ticketId)?.title}{' '}
                  <span className={r.action === 'error' ? 'warn-text' : 'muted'}>— {r.reason}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
void S;
void can;
void Spinner;
