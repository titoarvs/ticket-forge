'use client';
// The test's own fields: title, type, folder, priority, labels and preconditions.
import { type Any, P } from '../../core';
import { TF, SF, MenuItem, TA } from '../../fields';
import { repo, TEST_TYPES } from '../run-status';
import type { Draft } from './draft';

type FieldsProps = { draft: Draft; ed: boolean; isNew: boolean };

type ChoiceProps = {
  value: string;
  list: readonly string[];
  ed: boolean;
  onChange: (v: string) => void;
};

function Choice({ value, list, ed, onChange }: ChoiceProps) {
  return (
    <SF disabled={!ed} value={value} onChange={(e) => onChange(e.target.value)}>
      {list.map((x) => (
        <MenuItem key={x} value={x}>
          {x}
        </MenuItem>
      ))}
    </SF>
  );
}

export function TestFields({ draft, ed, isNew }: FieldsProps) {
  const { d, set } = draft;
  const folders = repo(P()).folders;
  const setLabels = (text: string) =>
    set(
      'labels',
      text
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    );
  return (
    <div className="grid2">
      <label className="field" style={{ gridColumn: '1 / -1' }}>
        <span>Title</span>
        <TF
          autoFocus={isNew}
          disabled={!ed}
          value={d.title}
          placeholder="e.g. Approve a salary proposal as the assigned approver"
          onChange={(e) => set('title', e.target.value)}
        />
      </label>
      <label className="field">
        <span>Type</span>
        <Choice value={d.type} list={TEST_TYPES} ed={ed} onChange={(v) => set('type', v)} />
      </label>
      <label className="field">
        <span>Folder</span>
        <SF
          disabled={!ed}
          value={d.folderId || ''}
          onChange={(e) => set('folderId', e.target.value || null)}
        >
          <MenuItem value="">Not in a folder</MenuItem>
          {folders.map((f: Any) => (
            <MenuItem key={f.id} value={f.id}>
              {f.name}
            </MenuItem>
          ))}
        </SF>
      </label>
      <label className="field">
        <span>Priority</span>
        <Choice
          value={d.priority}
          list={['High', 'Medium', 'Low']}
          ed={ed}
          onChange={(v) => set('priority', v)}
        />
      </label>
      <label className="field">
        <span>Labels</span>
        <TF
          disabled={!ed}
          value={(d.labels || []).join(', ')}
          placeholder="e.g. regression, smoke"
          onChange={(e) => setLabels(e.target.value)}
        />
      </label>
      <label className="field" style={{ gridColumn: '1 / -1' }}>
        <span>Preconditions</span>
        <TA
          disabled={!ed}
          rows={2}
          value={d.preconditions}
          placeholder="e.g. Signed in as HR; a pending proposal exists"
          onChange={(e) => set('preconditions', e.target.value)}
        />
      </label>
    </div>
  );
}
