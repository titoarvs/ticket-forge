'use client';
// The planning rows of the Details sidebar: sprint, fix versions, and parent or epic and type.
import {
  type Any,
  P,
  can,
  isSub,
  ticket,
  mutate,
  setField,
  sprint,
  releases,
  release,
  TYPES,
} from '../../core';
import { TypeIcon, Swatch } from '../../ui';
import { SF, opts, MenuItem } from '../../fields';
import { type IssueProps, setIssueField } from './edit';

const sprintSuffix = (s: Any) =>
  s.state === 'active' ? ' (active)' : s.state === 'closed' ? ' (closed)' : '';

/** A sub-task follows its parent's sprint; other issues choose an open sprint (or keep a closed one). */
export function SprintField({ t, edit }: IssueProps) {
  if (isSub(t))
    return (
      <span className="muted" style={{ padding: '6px 8px' }}>
        {sprint(t.sprintId)?.name || 'None'} <span className="small">(from parent)</span>
      </span>
    );
  const sprints = P().sprints.filter((s: Any) => s.state !== 'closed' || s.id === t.sprintId);
  return (
    <SF
      disabled={!edit && !can('sprint.manage')}
      value={t.sprintId || ''}
      onChange={(ev) => setIssueField(t, 'sprintId', ev.target.value || null)}
    >
      <MenuItem value="">None</MenuItem>
      {sprints.map((s: Any) => (
        <MenuItem key={s.id} value={s.id}>
          {s.name}
          {sprintSuffix(s)}
        </MenuItem>
      ))}
    </SF>
  );
}

function VersionChips({ ids }: { ids: string[] }) {
  if (!ids.length) return <span className="muted">None</span>;
  return (
    <span className="fixv">
      {ids.map((id: string) => (
        <span
          key={id}
          className={`label-chip ${release(id)?.status === 'released' ? 'rel-done' : ''}`}
        >
          {release(id)?.name}
        </span>
      ))}
    </span>
  );
}

export function FixVersionsField({ t, edit }: IssueProps) {
  const mine: string[] = t.fixVersions || [];
  if (isSub(t) || (!releases().length && !mine.length)) return null;
  const choices = releases().filter((r: Any) => r.status !== 'archived' || mine.includes(r.id));
  return (
    <>
      <span className="label">Fix versions</span>
      <SF
        multiple
        disabled={!edit && !can('sprint.manage')}
        aria-label="Fix versions"
        value={mine.filter((v: string) => release(v))}
        renderValue={(v: Any) => <VersionChips ids={v} />}
        onChange={(ev: Any) => setIssueField(t, 'fixVersions', ev.target.value)}
      >
        {choices.map((r: Any) => (
          <MenuItem key={r.id} value={r.id}>
            {r.name}
            {r.status !== 'unreleased' ? ` (${r.status})` : ''}
          </MenuItem>
        ))}
      </SF>
    </>
  );
}

/** Moving a sub-task to another parent also moves it to that parent's epic and sprint. */
const setParent = (t: Any, id: string) =>
  mutate(() => {
    const par = ticket(id);
    setField(t, 'parentId', id);
    if (par) {
      t.epicId = par.epicId;
      t.sprintId = par.sprintId;
    }
  });

function ParentField({ t, edit }: IssueProps) {
  return (
    <>
      <span className="label">Parent</span>
      <SF disabled={!edit} value={t.parentId} onChange={(ev) => setParent(t, ev.target.value)}>
        {P()
          .tickets.filter((x: Any) => !isSub(x))
          .map((x: Any) => (
            <MenuItem key={x.id} value={x.id}>
              {x.key} — {x.title.slice(0, 40)}
            </MenuItem>
          ))}
      </SF>
    </>
  );
}

function EpicAndTypeFields({ t, edit, e }: IssueProps & { e: Any }) {
  return (
    <>
      <span className="label">Epic</span>
      <span className="with-icon" title={e?.title || undefined}>
        {e && <Swatch color={e.color} style={{ marginLeft: 4 }} />}
        <SF
          disabled={!edit && !can('epic.manage')}
          value={t.epicId || ''}
          onChange={(ev) => setIssueField(t, 'epicId', ev.target.value || null)}
        >
          <MenuItem value="">None</MenuItem>
          {P().epics.map((x: Any) => (
            <MenuItem key={x.id} value={x.id}>
              {x.title}
            </MenuItem>
          ))}
        </SF>
      </span>
      <span className="label">Issue type</span>
      <span className="with-icon">
        <TypeIcon type={t.type} />
        <SF
          disabled={!edit}
          value={t.type}
          onChange={(ev) => setIssueField(t, 'type', ev.target.value)}
        >
          {opts(TYPES)}
        </SF>
      </span>
    </>
  );
}

/** A sub-task shows its parent; any other issue its epic and type. */
export function PlacementFields({ t, edit, e }: IssueProps & { e: Any }) {
  return isSub(t) ? (
    <ParentField t={t} edit={edit} />
  ) : (
    <EpicAndTypeFields t={t} edit={edit} e={e} />
  );
}
