'use client';
import { useState } from 'react';
import {
  P,
  type Any,
  uid,
  nextEpicKey,
  COLORS,
  mutate,
  newTicket,
  addMember,
  toast,
  closeModal,
  can,
  TYPES,
  openSprints,
  PRIORITIES,
  peopleNames,
  me,
  S,
  openModal,
  withBusy,
  api,
  aiBody,
  applyAi,
} from '../core';
import { askFirst } from '../Clarify';
import { Modal } from '../ui';
import { CB, TF, SF, opts, MenuItem, PeopleF, TA } from '../fields';
import { type RichValue, RichTextField } from '../CommentEditor';
import { openDrawer } from './move-ticket';

// ---------------------------------------------------------------- create issue
// Tickets are created only in Ticket Forge. A linked GitHub repository is import-only, so no GitHub
// issue is filed for a new ticket (lib/github-sync.ts).

export function CreateIssueModal({ epicId = '' }: { epicId?: string }) {
  const p = P();
  const [rich, setRich] = useState<RichValue | null>(null);
  const [n, setN] = useState(0); // remounts the description editor after "Create another"
  const [f, setF] = useState({
    type: 'Story',
    title: '',
    description: '',
    epicId,
    sprintId: '',
    priority: 'Medium',
    storyPoints: '',
    assignee: '',
    another: false,
  });
  const set = (k: string) => (e: Any) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const isEpic = f.type === 'Epic';
  const fields = () => ({
    title: f.title.trim(),
    type: f.type,
    description: f.description.trim(),
    ...(rich?.text && rich.text === f.description.trim() && { descriptionRich: rich }),
    epicId: f.epicId || null,
    sprintId: f.sprintId || null,
    priority: f.priority,
    storyPoints: f.storyPoints === '' ? null : Number(f.storyPoints),
    assignee: f.assignee.trim(),
  });
  const create = () => {
    if (!f.title.trim()) return;
    let created: Any;
    if (isEpic) {
      created = {
        id: uid(),
        key: nextEpicKey(),
        title: f.title.trim(),
        description: f.description.trim(),
        color: COLORS[P().epics.length % COLORS.length],
      };
      mutate((pp) => pp.epics.push(created));
    } else {
      created = newTicket(fields());
      mutate((pp) => {
        pp.tickets.push(created);
        addMember(f.assignee);
      });
    }
    toast(`Created ${created.key}`);
    if (f.another) {
      setF({ ...f, title: '', description: '' });
      setRich(null);
      setN((x) => x + 1);
      return;
    }
    closeModal();
    openDrawer(isEpic ? 'epic' : 'issue', created.id);
  };
  const withClaude = () => {
    const idea = [f.title.trim(), f.description.trim()].filter(Boolean).join('\n');
    if (!idea) return toast('Write a summary or description for Claude to work from.', 'err');
    closeModal();
    writeWithClaude({
      idea,
      fields: {
        epicId: f.epicId || null,
        sprintId: f.sprintId || null,
        assignee: f.assignee.trim(),
      },
      type: f.type === 'Story' ? null : f.type,
    });
  };
  return (
    <Modal
      title="Create issue"
      left={
        <label className="check small">
          <CB checked={f.another} onChange={set('another')} /> Create another
        </label>
      }
      actions={[
        { label: 'Cancel' },
        {
          label: 'Write with Claude',
          kind: 'ai',
          onClick: withClaude,
          hidden: isEpic || !can('ai.use'),
        },
        {
          label: 'Create',
          kind: 'primary',
          onClick: create,
          disabled: !f.title.trim(),
        },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Required fields are marked with an asterisk{' '}
        <span style={{ color: 'var(--danger)' }}>*</span>
      </p>
      <div className="grid2">
        <label className="field">
          <span>Project</span>
          <TF value={`${p.name} (${p.key})`} disabled />
        </label>
        <label className="field">
          <span>
            Issue type <span className="req">*</span>
          </span>
          <SF value={f.type} onChange={set('type')}>
            {opts([...TYPES, ...(can('epic.manage') ? ['Epic'] : [])])}
          </SF>
        </label>
      </div>
      <label className="field">
        <span>
          Summary <span className="req">*</span>
        </span>
        <TF
          autoFocus
          value={f.title}
          onChange={set('title')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              create();
            }
          }}
        />
      </label>
      <div className="field">
        <span>Description</span>
        <RichTextField
          key={n}
          text={f.description}
          rich={rich}
          ariaLabel="Description"
          placeholder="Describe the work. Claude can turn this into a full issue with acceptance criteria and test cases."
          onChange={(v) => {
            setRich(v);
            setF((x) => ({ ...x, description: v.text }));
          }}
        />
      </div>
      {!isEpic && (
        <div className="grid2">
          <label className="field">
            <span>Epic</span>
            <SF value={f.epicId} onChange={set('epicId')}>
              <MenuItem value="">None</MenuItem>
              {p.epics.map((e: Any) => (
                <MenuItem key={e.id} value={e.id}>
                  {e.title}
                </MenuItem>
              ))}
            </SF>
          </label>
          <label className="field">
            <span>Sprint</span>
            <SF value={f.sprintId} onChange={set('sprintId')}>
              <MenuItem value="">Backlog</MenuItem>
              {openSprints().map((s: Any) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                  {s.state === 'active' ? ' (active)' : ''}
                </MenuItem>
              ))}
            </SF>
          </label>
          <label className="field">
            <span>Priority</span>
            <SF value={f.priority} onChange={set('priority')}>
              {opts(PRIORITIES)}
            </SF>
          </label>
          <label className="field">
            <span>Story points</span>
            <TF type="number" min={0} value={f.storyPoints} onChange={set('storyPoints')} />
          </label>
          <label className="field">
            <span>Assignee</span>
            <PeopleF
              placeholder="Unassigned"
              value={f.assignee}
              onChange={(v) => setF({ ...f, assignee: v })}
              options={peopleNames()}
            />
          </label>
          <label className="field">
            <span>Reporter</span>
            <TF value={me()} disabled />
          </label>
        </div>
      )}
    </Modal>
  );
}
/**
 * An issue as AI requests need it: no history, comments, scripts or run results (smaller requests).
 */
export const aiTicket = (t: Any) => ({
  ...t,
  history: [],
  comments: [],
  prs: [],
  testCases: (t.testCases || []).map(({ script: _s, lastRun: _l, healed: _h, ...tc }: Any) => tc),
});
export function openCreateIssue(epicId?: string) {
  if (!P() || !can('issue.create')) return;
  const cur =
    epicId ||
    (S.drawer?.kind === 'epic' ? S.drawer.id : '') ||
    (S.filter.epic && S.filter.epic !== 'none' ? S.filter.epic : '') ||
    '';
  openModal(<CreateIssueModal epicId={cur} />);
}
export async function writeWithClaude({
  idea,
  fields = {},
  type,
}: {
  idea: string;
  fields?: Any;
  type?: string | null;
}) {
  const answers = await askFirst({
    kind: 'new-ticket',
    subject: 'the new issue',
    epicId: fields.epicId,
    text: idea,
  });
  if (answers === null) return;
  const res = await withBusy('Claude is writing the issue…', () =>
    api('/api/ai/new-ticket', {
      method: 'POST',
      body: aiBody({ epicId: fields.epicId, idea, answers, projectId: P().id }),
    }),
  );
  if (!res) return;
  const nt = applyAi(newTicket({ ...fields }), res.ticket);
  if (type) nt.type = type;
  mutate((p) => {
    p.tickets.push(nt);
    addMember(fields.assignee);
  });
  openDrawer('issue', nt.id);
  toast(`Claude created ${nt.key}`);
}
export function NewWithClaudeModal({ epicId = '' }: { epicId?: string }) {
  const p = P();
  const [ep, setEp] = useState(epicId || p.epics[0]?.id || '');
  const [idea, setIdea] = useState('');
  return (
    <Modal
      title="Write an issue with Claude"
      actions={[
        { label: 'Cancel' },
        {
          label: 'Write issue',
          kind: 'primary',
          disabled: !idea.trim(),
          onClick: () => {
            closeModal();
            writeWithClaude({ idea: idea.trim(), fields: { epicId: ep || null } });
          },
        },
      ]}
    >
      <label className="field">
        <span>Epic</span>
        <SF value={ep} onChange={(e) => setEp(e.target.value)}>
          <MenuItem value="">None</MenuItem>
          {p.epics.map((e: Any) => (
            <MenuItem key={e.id} value={e.id}>
              {e.title}
            </MenuItem>
          ))}
        </SF>
      </label>
      <label className="field">
        <span>What should the issue cover?</span>
        <TA
          autoFocus
          style={{ minHeight: 100 }}
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="e.g. Customers can export their order history as a PDF"
        />
      </label>
      <p className="muted small">
        Claude writes the summary, user story, description, acceptance criteria and test cases.
      </p>
    </Modal>
  );
}
