'use client';
import { useState } from 'react';
import {
  type Any,
  withBusy,
  api,
  aiBody,
  P,
  toast,
  openModal,
  applyAi,
  mutate,
  logEvent,
  closeModal,
  newTicket,
  addLink,
  isSub,
  uid,
  COLORS,
  setField,
  S,
  ticket,
} from '../core';
import { askFirst } from '../Clarify';
import { TypeIcon, PriorityIcon, Modal } from '../ui';
import { TA } from '../fields';
import { aiTicket } from './CreateIssueModal';

// ---------------------------------------------------------------- Claude on an issue
const AI_LABEL: Record<string, string> = {
  enhance: 'Claude is enhancing the issue…',
  ac: 'Claude is improving acceptance criteria…',
  tests: 'Claude is writing test cases…',
  split: 'Claude is splitting the issue…',
  custom: 'Claude is applying your instruction…',
};
const AI_DONE: Record<string, string> = {
  enhance: 'enhanced the issue with Claude',
  ac: 'improved acceptance criteria with Claude',
  tests: 'regenerated test cases with Claude',
  custom: 'updated the issue with Claude',
};
const ASK_SUBJECT: Record<string, string> = {
  enhance: 'the enhanced issue',
  ac: 'the acceptance criteria',
  tests: 'the test cases',
  split: 'the smaller issues',
  custom: 'the change',
};
export async function runTicketAi(t: Any, op: string, instruction?: string) {
  const answers = await askFirst({
    kind: op,
    subject: `${ASK_SUBJECT[op] || 'the issue'} for ${t.key}`,
    ticket: t,
    instructions: instruction,
  });
  if (answers === null) return;
  const res = await withBusy(AI_LABEL[op], () =>
    api('/api/ai/ticket', {
      method: 'POST',
      body: aiBody({ action: op, ticket: aiTicket(t), projectId: P().id, instruction, answers }),
    }),
  );
  if (!res) return;
  if (op === 'split') {
    if (!res.tickets?.length) return toast('Claude did not return any issues.', 'err');
    openModal(<ReviewSplit orig={t} parts={res.tickets} />);
    return;
  }
  openModal(<ReviewTicket before={t} after={applyAi(t, res.ticket)} op={op} />);
}
function TicketSummary({ t, other }: { t: Any; other?: Any }) {
  const oldAc = new Set(other?.acceptanceCriteria || []);
  return (
    <>
      <div className="row" style={{ gap: 6, marginBottom: 6 }}>
        <TypeIcon type={t.type} />
        <PriorityIcon p={t.priority} />
        <span className="sp">{t.storyPoints ?? '–'}</span>
        {t.labels?.map((l: string) => (
          <span key={l} className="label-chip">
            {l}
          </span>
        ))}
      </div>
      <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{t.title}</p>
      {t.userStory && (
        <p style={{ margin: '0 0 8px', fontStyle: 'italic', color: 'var(--text-subtle)' }}>
          {t.userStory}
        </p>
      )}
      <h5>Acceptance criteria ({t.acceptanceCriteria.length})</h5>
      <ol className="small">
        {t.acceptanceCriteria.map((a: string, i: number) => (
          <li key={i} className={other && !oldAc.has(a) ? 'new' : ''}>
            {a}
          </li>
        ))}
      </ol>
      <h5>Test cases ({(t.testCases || []).length})</h5>
      <ol className="small">
        {(t.testCases || []).map((tc: Any, i: number) => (
          <li key={i}>{tc.title}</li>
        ))}
      </ol>
    </>
  );
}
function ReviewTicket({ before, after, op }: { before: Any; after: Any; op: string }) {
  return (
    <Modal
      title="Review Claude’s suggestion"
      wide
      actions={[
        { label: 'Discard' },
        {
          label: 'Accept changes',
          kind: 'primary',
          onClick: () => {
            mutate((p) => {
              const i = p.tickets.findIndex((x: Any) => x.id === before.id);
              p.tickets[i] = after;
              logEvent(after, AI_DONE[op] || 'updated the issue with Claude');
            });
            closeModal();
            toast('Changes applied');
          },
        },
      ]}
    >
      <div className="cmp">
        <div>
          <h5>Current</h5>
          <TicketSummary t={before} />
        </div>
        <div>
          <h5>Suggested</h5>
          <TicketSummary t={after} other={before} />
        </div>
      </div>
      <p className="small muted" style={{ margin: '12px 0 0' }}>
        Highlighted criteria are new or reworded. You can keep editing after accepting, and ⌘Z
        undoes it.
      </p>
    </Modal>
  );
}
function ReviewSplit({ orig, parts }: { orig: Any; parts: Any[] }) {
  return (
    <Modal
      title={`Split ${orig.key} into ${parts.length} issues`}
      wide
      actions={[
        { label: 'Discard' },
        {
          label: 'Replace with these issues',
          kind: 'primary',
          onClick: () => {
            mutate((p) => {
              const i = p.tickets.findIndex((x: Any) => x.id === orig.id);
              const first = applyAi(orig, parts[0]);
              logEvent(first, `split into ${parts.length} issues with Claude`);
              p.tickets.splice(i, 1, first);
              parts.slice(1).forEach((pt, k) => {
                const r = applyAi(
                  newTicket({
                    epicId: orig.epicId,
                    sprintId: orig.sprintId,
                    assignee: orig.assignee,
                  }),
                  pt,
                );
                p.tickets.splice(i + 1 + k, 0, r);
                addLink(first, 'relates to', r);
              });
            });
            closeModal();
            toast(`Split into ${parts.length} issues`);
          },
        },
      ]}
    >
      {parts.map((t, i) => (
        <div key={i} className="card" style={{ marginBottom: 12, padding: 14 }}>
          <TicketSummary t={t} />
        </div>
      ))}
    </Modal>
  );
}
const ASK_SUGGESTIONS = [
  'Add security and permission criteria',
  'Add accessibility (WCAG) criteria',
  'Add performance criteria',
  'Make it more technical for developers',
  'Rewrite in plain language for stakeholders',
  'Add API contract details',
  'Re-estimate the story points',
];
export function AskModal({ t }: { t: Any }) {
  const [v, setV] = useState('');
  return (
    <Modal
      title="Ask Claude to change this issue"
      actions={[
        { label: 'Cancel' },
        {
          label: 'Apply',
          kind: 'primary',
          disabled: !v.trim(),
          onClick: () => {
            closeModal();
            runTicketAi(t, 'custom', v.trim());
          },
        },
      ]}
    >
      <label className="field">
        <span>Instruction</span>
        <TA
          autoFocus
          style={{ minHeight: 96 }}
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="e.g. Add criteria for offline mode and a test case for slow networks"
        />
      </label>
      <div className="row">
        {ASK_SUGGESTIONS.map((s) => (
          <button key={s} className="btn sm" onClick={() => setV(s)}>
            {s}
          </button>
        ))}
      </div>
    </Modal>
  );
}
export function RegroupModal() {
  const [v, setV] = useState('');
  return (
    <Modal
      title="Re-organize issues into epics"
      actions={[
        { label: 'Cancel' },
        {
          label: 'Propose epics',
          kind: 'primary',
          onClick: async () => {
            closeModal();
            const proj = { ...P(), tickets: P().tickets.filter((x: Any) => !isSub(x)) };
            const res = await withBusy('Claude is re-organizing epics…', () =>
              api('/api/ai/regroup', {
                method: 'POST',
                body: aiBody({ project: proj, instruction: v.trim() }),
              }),
            );
            if (res) openModal(<ReviewRegroup proposed={res.epics} />);
          },
        },
      ]}
    >
      <p style={{ marginTop: 0 }}>
        Claude proposes a new set of epics and assigns every issue to one. You review the result
        before anything changes.
      </p>
      <label className="field">
        <span>Guidance (optional)</span>
        <TA
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="e.g. Group by user journey: onboarding, browsing, checkout, admin"
        />
      </label>
    </Modal>
  );
}
function ReviewRegroup({ proposed }: { proposed: Any[] }) {
  return (
    <Modal
      title={`Proposed epics (${proposed.length})`}
      wide
      actions={[
        { label: 'Discard' },
        {
          label: 'Apply new epics',
          kind: 'primary',
          onClick: () => {
            mutate((pp) => {
              const byTitle = new Map(pp.epics.map((e: Any) => [e.title.toLowerCase(), e]));
              const next = proposed.map((pe, i) => {
                const old: Any = byTitle.get(pe.title.toLowerCase());
                return {
                  id: old?.id || uid(),
                  key: `${pp.key}-E${i + 1}`,
                  title: pe.title,
                  description: pe.description || old?.description || '',
                  color: old?.color || COLORS[i % COLORS.length],
                  ticketIds: pe.ticketIds,
                };
              });
              pp.epics = next.map(({ ticketIds, ...e }) => e);
              for (const e of next)
                for (const id of e.ticketIds) {
                  const t = pp.tickets.find((x: Any) => x.id === id);
                  if (t) setField(t, 'epicId', e.id);
                }
              pp.tickets.sort(
                (a: Any, b: Any) =>
                  pp.epics.findIndex((e: Any) => e.id === a.epicId) -
                  pp.epics.findIndex((e: Any) => e.id === b.epicId),
              );
            });
            S.drawer = null;
            closeModal();
            toast('Epics re-organized — ⌘Z to undo');
          },
        },
      ]}
    >
      {proposed.map((e, i) => (
        <div key={i} style={{ marginBottom: 16 }}>
          <div className="row" style={{ gap: 6 }}>
            <TypeIcon type="Epic" />
            <b>{e.title}</b>
            <span className="muted small">{e.ticketIds.length} issues</span>
          </div>
          <div className="small muted" style={{ margin: '2px 0 6px 22px' }}>
            {e.description}
          </div>
          <div className="rows" style={{ marginLeft: 22 }}>
            {e.ticketIds
              .map((id: string) => ticket(id))
              .filter(Boolean)
              .map((t: Any) => (
                <div key={t.id} className="irow" style={{ cursor: 'default', minHeight: 32 }}>
                  <TypeIcon type={t.type} />
                  <span className="key">{t.key}</span>
                  <span className="sum">{t.title}</span>
                </div>
              ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}
