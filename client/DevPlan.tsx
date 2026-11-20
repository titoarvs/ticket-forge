'use client';
// Planning development work with Jev (lib/devorder.ts, lib/parallel.ts):
// - Development order: the order to build an epic's or sprint's issues, with a reason per issue,
//   applied to the backlog.
// - Parallel check: before code jobs start on several issues, which of them touch the same code and
//   should wait.
// Jev (Administration → AI → Decisions) makes the small decisions when it is on; otherwise the AI,
// or the rules.
import { useEffect, useState } from 'react';
import {
  P,
  api,
  aiBody,
  can,
  feat,
  isDone,
  toast,
  mutate,
  closeModal,
  openModal,
  type Any,
} from './core';
import { BulkCodeModal, codeReady, openCode } from './DevCode';
import { finishedCode } from './codeStatus';
import { Ico, I, Modal, Spinner, LayerChip, PriorityIcon } from './ui';
import { CB } from './fields';
import { applyOrder } from '@/lib/reorder';

const ENGINE: Record<string, string> = {
  jev: 'Jev',
  ai: 'the AI',
  'jev+ai': 'Jev and the AI',
  rules: 'the rules (links, priority, layer, size)',
};
const engineNote = (d: Any) =>
  d.engine === 'rules'
    ? 'Decided by the rules only.'
    : `Hints from ${ENGINE[d.engine]}${d.byJev ? ` · Jev answered ${d.byJev}` : ''}${d.byAi ? ` · the AI answered ${d.byAi}` : ''}.`;

/** Whether this person can start code jobs here (Write code with AI). */
export const canWriteCode = () => feat('code') && can('ai.use') && can('issue.edit') && codeReady();
/**
 * Write code for many issues at once, in development order, with the conflict check
 * (BulkCodeModal).
 */
export const openBulkCode = (ids: string[]) => openModal(<BulkCodeModal ids={ids} />);
/** The open issues of an epic, top level, for "Write code for the epic". */
export const epicCodeIds = (epicId: string) =>
  P()
    .tickets.filter(
      (t: Any) => t.epicId === epicId && !t.parentId && !finishedCode(t) && !isDone(t),
    )
    .map((t: Any) => t.id);

/** Opens the Development order dialog of an epic or a sprint. */
export const openDevOrder = (scope: { epicId?: string; sprintId?: string; title: string }) =>
  openModal(<DevOrderModal scope={scope} />);

function DevOrderModal({
  scope,
}: {
  scope: { epicId?: string; sprintId?: string; title: string };
}) {
  const [smart, setSmart] = useState(can('ai.use'));
  const [d, setD] = useState<Any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async (useSmart = smart) => {
    setBusy(true);
    setError('');
    try {
      setD(
        await api(`/api/projects/${P().id}/devorder`, {
          method: 'POST',
          body: aiBody({ epicId: scope.epicId, sprintId: scope.sprintId, smart: useSmart }),
        }),
      );
    } catch (e: Any) {
      setError(e.message);
      setD(null);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const canApply = can('issue.edit') || can('sprint.manage') || can('epic.manage');
  const codeOk = canWriteCode();
  const toCode = (d?.order || [])
    .map((o: Any) => P().tickets.find((x: Any) => x.id === o.ticketId))
    .filter((t: Any) => t && !finishedCode(t))
    .map((t: Any) => t.id);
  const apply = () => {
    const ids = d.order.map((o: Any) => o.ticketId);
    mutate((pp: Any) => {
      const byId = new Map(pp.tickets.map((t: Any) => [t.id, t]));
      pp.tickets = applyOrder(
        pp.tickets.map((t: Any) => t.id),
        ids,
      ).map((id) => byId.get(id));
    });
    closeModal();
    toast(`${ids.length} issues of ${scope.title} are now in the suggested order.`, 'ok', {
      title: 'Backlog reordered',
    });
  };
  return (
    <Modal
      title={`Development order · ${scope.title}`}
      wide
      actions={[
        { label: 'Close' },
        {
          label: `Write code for all ${toCode.length}`,
          kind: 'ai',
          hidden: !codeOk || toCode.length < 1,
          disabled: busy,
          onClick: () => openBulkCode(toCode),
        },
        {
          label: 'Apply to backlog order',
          kind: 'primary',
          disabled: !d?.order?.length || busy || !canApply,
          onClick: apply,
        },
      ]}
      left={
        <CB
          label="Use Jev / AI hints"
          disabled={busy || !can('ai.use')}
          checked={smart}
          onChange={(e: Any) => {
            setSmart(e.target.checked);
            load(e.target.checked);
          }}
        />
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        The order to build these issues in: blocked issues come after their blockers, then priority,
        what other issues need first, backend before the screens that use it, and smaller issues
        first. Applying it moves only these issues within the places they hold in the backlog.
      </p>
      {busy && (
        <div className="muted">
          <Spinner /> Working out the order…
        </div>
      )}
      {error && (
        <div className="warn-banner danger">
          <Ico svg={I.warn} />
          <span>{error}</span>
        </div>
      )}
      {d && !busy && (
        <>
          <div className="ok-banner" style={{ marginBottom: 10 }}>
            <Ico svg={I.check} />
            <span>
              {d.summary} <span className="muted">{engineNote(d)}</span>
            </span>
          </div>
          {d.note && <p className="muted small">Fell back: {d.note}</p>}
          {d.loops?.length > 0 && (
            <div className="warn-banner">
              <Ico svg={I.warn} />
              <span>
                These issues block each other:{' '}
                {d.loops.map((l: string[]) => l.join(' ↔ ')).join('; ')}. Check their links.
              </span>
            </div>
          )}
          <ol className="dev-order">
            {d.order.map((o: Any) => (
              <li key={o.ticketId}>
                <span className="do-n">{o.position}</span>
                <div className="do-main">
                  <div className="do-l1">
                    <code>{o.key}</code>
                    <span className="do-title">{o.title}</span>
                    <LayerChip layer={o.layer} short />
                    <span className="do-meta" title={`${o.priority} priority`}>
                      <PriorityIcon p={o.priority} />
                      {o.storyPoints != null ? `${o.storyPoints} pts` : ''}
                    </span>
                  </div>
                  <div className="do-why muted small">{o.reason}</div>
                </div>
                {codeOk &&
                  (() => {
                    const t = P().tickets.find((x: Any) => x.id === o.ticketId);
                    if (!t) return null;
                    return finishedCode(t) ? (
                      <button
                        className="btn sm subtle"
                        title="Review the code, approve it and merge the pull request"
                        onClick={() => openCode(t)}
                      >
                        <Ico svg={I.pr} />
                        View code
                      </button>
                    ) : (
                      <button
                        className="btn sm ai"
                        title={`Write the code for ${o.key} with AI`}
                        onClick={() => openCode(t)}
                      >
                        <Ico svg={I.sparkle} />
                        Write code
                      </button>
                    );
                  })()}
              </li>
            ))}
          </ol>
          {d.done?.length > 0 && (
            <p className="muted small">
              Already done, left out: {d.done.map((x: Any) => x.key).join(', ')}.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

/**
 * The parallel check inside "Write code for N issues": conflicts and rounds, with the choice to
 * start round 1 only or everything. `onStart(ids)` starts the jobs.
 */
export function ParallelCheck({
  ids,
  busy,
  onStart,
}: {
  ids: string[];
  busy: boolean;
  onStart: (ids: string[]) => void;
}) {
  const [d, setD] = useState<Any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const run = async (smart: boolean) => {
    setLoading(true);
    setError('');
    try {
      setD(
        await api(`/api/projects/${P().id}/code`, {
          method: 'POST',
          body: aiBody({ action: 'plan-parallel', ticketIds: ids, smart }),
        }),
      );
    } catch (e: Any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (ids.length > 1) run(can('ai.use'));
  }, [ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (ids.length < 2) return null;
  if (loading)
    return (
      <div className="muted small par-check">
        <Spinner /> Checking which issues touch the same code…
      </div>
    );
  if (error)
    return (
      <div className="warn-banner par-check">
        <Ico svg={I.warn} />
        <span>Couldn’t check for conflicts: {error}</span>
        <button className="btn sm subtle" onClick={() => run(false)}>
          Check with rules only
        </button>
      </div>
    );
  if (!d) return null;
  const shown = d.conflicts.filter((c: Any) => !c.cleared);
  const cleared = d.conflicts.filter((c: Any) => c.cleared);
  return (
    <div className="par-check">
      <div className={d.wait.length ? 'warn-banner' : 'ok-banner'}>
        <Ico svg={d.wait.length ? I.warn : I.check} />
        <span>
          {d.summary} <span className="muted">{engineNote(d)}</span>
        </span>
      </div>
      {d.note && <p className="muted small">Fell back: {d.note}</p>}
      {d.rounds.length > 1 && (
        <ol className="par-rounds">
          {d.rounds.map((r: Any[], i: number) => (
            <li key={i}>
              <b>{i === 0 ? 'Now, together' : `Round ${i + 1}: after round ${i}`}</b>
              <span>
                {r.map((x: Any) => (
                  <code key={x.ticketId} title={x.why.join('; ') || x.title}>
                    {x.key}
                  </code>
                ))}
              </span>
            </li>
          ))}
        </ol>
      )}
      {shown.length > 0 && (
        <details className="par-conflicts" open={shown.length <= 6}>
          <summary className="small">
            {shown.length} conflict{shown.length === 1 ? '' : 's'}
          </summary>
          <ul className="small">
            {shown.map((c: Any, i: number) => (
              <li key={i}>
                <span className={`par-kind k-${c.kind}`}>
                  {
                    {
                      file: 'Same file',
                      module: 'Same module',
                      likely: 'Likely',
                      job: 'Busy',
                      blocked: 'Blocked',
                    }[c.kind as 'file']
                  }
                </span>
                {c.kind === 'file' || c.kind === 'module' ? (
                  <>
                    {c.keys.join(', ')} both touch <code>{c.target}</code>
                  </>
                ) : (
                  c.why
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {cleared.length > 0 && (
        <p className="muted small">
          Same module but separate files ({ENGINE[d.engine] || 'checked'}):{' '}
          {cleared.map((c: Any) => `${c.keys.join(' + ')} in ${c.target}`).join('; ')}.
        </p>
      )}
      {d.noSpec.length > 0 && (
        <p className="muted small">
          No coding spec (files unknown): {d.noSpec.join(', ')}. Generate coding specs on the epic
          for a precise check.
        </p>
      )}
      {d.alreadyRunning.length > 0 && (
        <p className="muted small">Already being coded: {d.alreadyRunning.join(', ')}.</p>
      )}
      {d.wait.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button
            className="btn ai"
            disabled={busy || !d.runNow.length}
            onClick={() => onStart(d.runNow)}
          >
            <Ico svg={I.sparkle} />
            Start the {d.runNow.length} safe now
          </button>
          <span className="muted small" style={{ alignSelf: 'center' }}>
            {d.wait
              .map((w: Any) => `${w.key}${w.after.length ? ` after ${w.after.join(', ')}` : ''}`)
              .join(' · ')}
          </span>
        </div>
      )}
    </div>
  );
}
