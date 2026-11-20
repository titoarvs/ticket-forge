'use client';
// The issue draft under an assistant reply: every field can be edited, and Create sends the edited
// fields. Nothing is an issue until Create (off while the title is empty or without permission).
import { useState } from 'react';
import { can, TYPES, PRIORITIES, type Any } from '../core';

const POINTS = [1, 2, 3, 5, 8, 13, 21];

type FieldsProps = { d: Any; set: (k: string, v: Any) => void };

function Pick({ label, value, options, onChange }: Any) {
  return (
    <label className="pchat-f">
      <span>{label}</span>
      <select
        className="select compact"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      >
        {options.map((o: Any) => (
          <option key={o.value ?? o} value={o.value ?? o}>
            {o.label ?? o}
          </option>
        ))}
      </select>
    </label>
  );
}

function DraftFields({ d, set }: FieldsProps) {
  const title = String(d.title || '').trim();
  const points = [...new Set([...POINTS, d.storyPoints].filter(Boolean))];
  return (
    <>
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
        <Pick
          label="Type"
          value={d.type}
          options={TYPES}
          onChange={(v: string) => set('type', v)}
        />
        <Pick
          label="Priority"
          value={d.priority}
          options={PRIORITIES}
          onChange={(v: string) => set('priority', v)}
        />
        <Pick
          label="Story points"
          value={d.storyPoints ?? ''}
          options={[{ value: '', label: '–' }, ...points]}
          onChange={(v: string) => set('storyPoints', v ? Number(v) : null)}
        />
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
    </>
  );
}

type PreviewProps = {
  msg: Any;
  onCreate: (d: Any) => Promise<void>;
  onDiscard: () => Promise<void>;
};

export function DraftPreview({ msg, onCreate, onDiscard }: PreviewProps) {
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
  const why = !mayCreate
    ? 'You don’t have permission to create issues'
    : !title
      ? 'Add a title first'
      : 'Create this issue in the backlog';
  return (
    <div className="pchat-draft" aria-label="Draft preview">
      <span className="loz t-blocked" title="A draft isn’t in the backlog until you click Create">
        Draft
      </span>
      <DraftFields d={d} set={set} />
      <div className="pchat-actions">
        <button
          className="btn sm primary"
          onClick={create}
          disabled={!title || busy || !mayCreate}
          title={why}
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
