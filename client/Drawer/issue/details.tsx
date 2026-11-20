'use client';
// The Details sidebar: people, labels, estimate, layer, planning, and summaries of code and tests.
import {
  type Any,
  mutate,
  setField,
  S,
  feat,
  ago,
  saveUi,
  me,
  peopleNames,
  addMember,
  PRIORITIES,
} from '../../core';
import { Ico, I, Avatar, PriorityIcon } from '../../ui';
import { TF, SF, opts, MenuItem, PeopleF } from '../../fields';
import { prCls } from '../Drawer';
import { type IssueProps, setIssueField, showForm } from './edit';
import { SprintField, FixVersionsField, PlacementFields } from './planning-fields';

const assignToMe = (ev: React.MouseEvent, t: Any) => {
  ev.preventDefault();
  mutate(() => {
    addMember(me());
    setField(t, 'assignee', me());
  });
};

function PeopleRows({ t, edit }: IssueProps) {
  return (
    <>
      <span className="label">Assignee</span>
      <div>
        <span className="with-icon">
          <Avatar name={t.assignee} />
          <PeopleF
            ghost
            disabled={!edit}
            value={t.assignee || ''}
            placeholder="Unassigned"
            options={peopleNames()}
            onChange={(v) => setIssueField(t, 'assignee', v)}
            onCommit={(v) => v.trim() && mutate(() => addMember(v))}
          />
        </span>
        {edit && t.assignee !== me() && (
          <a
            href="#"
            className="small"
            style={{ marginLeft: 34 }}
            onClick={(ev) => assignToMe(ev, t)}
          >
            Assign to me
          </a>
        )}
      </div>
      <span className="label">Reporter</span>
      <span className="with-icon">
        <Avatar name={t.reporter} />
        <PeopleF
          ghost
          disabled={!edit}
          value={t.reporter || ''}
          placeholder="None"
          options={peopleNames()}
          onChange={(v) => setIssueField(t, 'reporter', v)}
        />
      </span>
    </>
  );
}

/** Labels (comma separated, saved on blur), priority, story points and implementation layer. */
function WorkRows({ t, edit }: IssueProps) {
  const saveLabels = (text: string) =>
    setIssueField(
      t,
      'labels',
      text
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  return (
    <>
      <span className="label">Labels</span>
      <TF
        disabled={!edit}
        key={t.labels.join(',')}
        defaultValue={t.labels.join(', ')}
        placeholder="None"
        onBlur={(ev) => saveLabels(ev.target.value)}
      />
      <span className="label">Priority</span>
      <span className="with-icon">
        <PriorityIcon p={t.priority} />
        <SF
          disabled={!edit}
          value={t.priority}
          onChange={(ev) => setIssueField(t, 'priority', ev.target.value)}
        >
          {opts(PRIORITIES)}
        </SF>
      </span>
      <span className="label">Story points</span>
      <TF
        type="number"
        min={0}
        disabled={!edit}
        value={t.storyPoints ?? ''}
        placeholder="None"
        onChange={(ev) =>
          setIssueField(t, 'storyPoints', ev.target.value === '' ? null : Number(ev.target.value))
        }
      />
      <span className="label">Implementation</span>
      <SF
        disabled={!edit}
        value={t.layer || ''}
        onChange={(ev) => setIssueField(t, 'layer', ev.target.value || undefined)}
        aria-label="Implementation"
      >
        <MenuItem value="">Not set</MenuItem>
        <MenuItem value="frontend">Frontend</MenuItem>
        <MenuItem value="backend">Backend</MenuItem>
        <MenuItem value="both">Frontend + Backend</MenuItem>
      </SF>
    </>
  );
}

function DevSummary({ t, edit }: IssueProps) {
  if (t.prs.length)
    return (
      <>
        <Ico svg={I.pr} /> {t.prs.length} pull request{t.prs.length > 1 ? 's' : ''}{' '}
        {[...new Set(t.prs.map((r: Any) => r.status))].map((s: Any) => (
          <span key={s} className={`loz ${prCls(s)}`}>
            {s}
          </span>
        ))}
      </>
    );
  if (!edit || !feat('prs')) return <span className="muted">None</span>;
  return (
    <a
      href="#"
      className="small"
      onClick={(ev) => {
        ev.preventDefault();
        showForm('prForm', true);
      }}
    >
      Link pull request
    </a>
  );
}

function TestSummary({ t }: { t: Any }) {
  const all = t.testCases;
  if (!all.length) return <span className="muted">None</span>;
  const passing = all.filter((x: Any) => x.status === 'Pass').length;
  const automated = all.filter((x: Any) => x.script).length;
  return <>{`${passing}/${all.length} passing · ${automated} automated`}</>;
}

export function IssueDetails({ t, edit, e }: IssueProps & { e: Any }) {
  return (
    <div className="dr-side">
      <details
        className="details"
        open={S.detailsOpen}
        onToggle={(ev) => {
          S.detailsOpen = (ev.target as HTMLDetailsElement).open;
          saveUi();
        }}
      >
        <summary>
          Details <Ico svg={I.chevron} />
        </summary>
        <div className="dgrid">
          <PeopleRows t={t} edit={edit} />
          <WorkRows t={t} edit={edit} />
          <span className="label">Sprint</span>
          <SprintField t={t} edit={edit} />
          <FixVersionsField t={t} edit={edit} />
          <PlacementFields t={t} edit={edit} e={e} />
          <span className="label">Development</span>
          <span className="dev-sum">
            <DevSummary t={t} edit={edit} />
          </span>
          <span className="label">Tests</span>
          <span className="dev-sum">
            <TestSummary t={t} />
          </span>
        </div>
        <div className="dfoot muted small">
          Created {ago(t.createdAt)} · Updated {ago(t.updatedAt)}
        </div>
      </details>
    </div>
  );
}
