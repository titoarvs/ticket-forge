'use client';
import { useState, memo } from 'react';
import {
  S,
  emit,
  TYPES,
  idx,
  releases,
  openSprints,
  type Any,
  P,
  statusNames,
  peopleNames,
  mutate,
  ticket,
  setField,
  toast,
  undo,
  canMove,
  can,
  epic,
  PRIORITIES,
  feat,
  openModal,
  deleteIssues,
} from '../core';
import { openPop, setFlag } from '../RowActions';
import { Ico, I, Confirm } from '../ui';
import { inlineCreate, bulkTests, runTests } from '../actions';
import { SF, opts, TF, MenuItem } from '../fields';
import { codeReady, BulkCodeModal } from '../DevCode';

export function InlineCreate({ group }: { group: string }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('Story');
  if (S.inlineCreate !== group)
    return (
      <button
        className="inline-create"
        onClick={() => {
          S.inlineCreate = group;
          emit();
        }}
      >
        <Ico svg={I.plus} />
        Create issue
      </button>
    );
  const submit = () => {
    inlineCreate(group, title, type);
    setTitle('');
  };
  return (
    <div className="inline-form">
      <SF bare aria-label="Issue type" value={type} onChange={(e) => setType(e.target.value)}>
        {opts(TYPES)}
      </SF>
      <TF
        bare
        autoFocus
        placeholder="What needs to be done?"
        autoComplete="off"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') {
            S.inlineCreate = null;
            emit();
          }
        }}
      />
      <button className="btn sm primary" onClick={submit}>
        Create
      </button>
      <button
        className="btn sm subtle"
        onClick={() => {
          S.inlineCreate = null;
          emit();
        }}
      >
        Cancel
      </button>
    </div>
  );
}
/** The selection bar: redrawn only when the selection (or what its menus list) changes. */
export function BulkBar() {
  const { byId } = idx();
  const ids = [...S.checked].filter((id: string) => byId.has(id)) as string[];
  if (!ids.length) return null;
  const sig = [
    ids.join(),
    releases().length,
    ids.map((id) => (byId.get(id)?.flagged ? 1 : 0)).join(''),
    openSprints()
      .map((x: Any) => x.id + x.name)
      .join(),
    P()
      .epics.map((x: Any) => x.id + x.title)
      .join(),
    statusNames().join(),
    peopleNames().join(),
    S.user?.id,
    S.autoRun?.running,
  ].join('|');
  return <BulkBarView ids={ids} sig={sig} />;
}
const BulkBarView = memo(
  function BulkBarView({ ids }: { ids: string[]; sig: string }) {
    const p = P();
    const bulkSet = (field: string, value: Any, label: string) => {
      mutate(() =>
        ids.forEach((id) => {
          const t = ticket(id);
          if (t) setField(t, field, value);
        }),
      );
      S.checked.clear();
      emit();
      toast(`${ids.length} issues ${label}`, 'ok', { action: { label: 'Undo', onClick: undo } });
    };
    // With custom transitions, only issues allowed to move to that status change; the rest are
    // reported.
    const bulkStatus = (to: string) => {
      const ok = ids.filter((id) => canMove(ticket(id), to));
      const skipped = ids.length - ok.length;
      if (ok.length) mutate(() => ok.forEach((id) => setField(ticket(id), 'status', to)));
      S.checked.clear();
      emit();
      toast(
        skipped
          ? `${ok.length} issue${ok.length === 1 ? '' : 's'} set to ${to}. ${skipped} skipped: the workflow doesn’t allow moving ${skipped === 1 ? 'it' : 'them'} to ${to} from ${skipped === 1 ? 'its' : 'their'} current status.`
          : `${ok.length} issues set to ${to}`,
        skipped ? 'err' : undefined,
      );
    };
    return (
      <div className="bulk">
        {ids.length} selected
        {can('sprint.manage') && (
          <SF
            filter
            value=""
            onChange={(e) =>
              e.target.value &&
              bulkSet(
                'sprintId',
                e.target.value === '__none' ? null : e.target.value,
                `moved to ${p.sprints.find((s: Any) => s.id === e.target.value)?.name || 'the backlog'}`,
              )
            }
          >
            <MenuItem value="">Move to sprint…</MenuItem>
            {openSprints().map((s: Any) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
            <MenuItem value="__none">Backlog</MenuItem>
          </SF>
        )}
        {(can('epic.manage') || can('issue.edit')) && (
          <SF
            filter
            value=""
            onChange={(e) =>
              e.target.value &&
              bulkSet(
                'epicId',
                e.target.value === '__none' ? null : e.target.value,
                `moved to ${epic(e.target.value)?.title || 'No epic'}`,
              )
            }
          >
            <MenuItem value="">Move to epic…</MenuItem>
            {p.epics.map((x: Any) => (
              <MenuItem key={x.id} value={x.id}>
                {x.title}
              </MenuItem>
            ))}
            <MenuItem value="__none">No epic</MenuItem>
          </SF>
        )}
        {can('issue.edit') && (
          <>
            <SF filter value="" onChange={(e) => e.target.value && bulkStatus(e.target.value)}>
              <MenuItem value="">Set status…</MenuItem>
              {opts(statusNames())}
            </SF>
            <SF
              filter
              value=""
              onChange={(e) =>
                e.target.value &&
                bulkSet(
                  'assignee',
                  e.target.value === '__none' ? '' : e.target.value,
                  e.target.value === '__none' ? 'unassigned' : `assigned to ${e.target.value}`,
                )
              }
            >
              <MenuItem value="">Assign to…</MenuItem>
              {S.user?.name && <MenuItem value={S.user.name}>Assign to me</MenuItem>}
              {opts(peopleNames())}
              <MenuItem value="__none">Unassigned</MenuItem>
            </SF>
            <SF
              filter
              value=""
              onChange={(e) =>
                e.target.value &&
                bulkSet('priority', e.target.value, `set to ${e.target.value} priority`)
              }
            >
              <MenuItem value="">Priority…</MenuItem>
              {opts(PRIORITIES)}
            </SF>
            <button className="btn sm" onClick={(e) => openPop('points', ids, e.currentTarget)}>
              Story points…
            </button>
            {releases().some((r: Any) => r.status !== 'archived') && (
              <button className="btn sm" onClick={(e) => openPop('version', ids, e.currentTarget)}>
                Fix version…
              </button>
            )}
            <button
              className="btn sm"
              onClick={() => setFlag(ids, !ids.every((id) => ticket(id)?.flagged))}
            >
              <Ico svg={I.flag} />
              {ids.every((id) => ticket(id)?.flagged) ? 'Remove flag' : 'Add flag'}
            </button>
          </>
        )}
        {can('ai.use') && can('issue.edit') && (
          <button className="btn sm ai" onClick={() => bulkTests()}>
            <Ico svg={I.sparkle} />
            Write test cases
          </button>
        )}
        {can('ai.use') && can('issue.edit') && feat('code') && codeReady() && (
          <button className="btn sm ai" onClick={() => openModal(<BulkCodeModal ids={ids} />)}>
            <Ico svg={I.sparkle} />
            Write code with AI
          </button>
        )}
        {can('test.run') && (
          <button
            className="btn sm"
            onClick={() =>
              runTests(
                p.tickets
                  .filter((x: Any) => S.checked.has(x.id))
                  .flatMap((x: Any) => x.testCases.map((tc: Any) => ({ t: x, tc }))),
              )
            }
          >
            <Ico svg={I.play} />
            Run tests
          </button>
        )}
        {can('issue.delete') && (
          <button
            className="btn sm danger-subtle"
            onClick={() =>
              openModal(
                <Confirm
                  title={`Delete ${ids.length} issues?`}
                  label="Delete"
                  text="Their sub-tasks are deleted too. You can undo with ⌘Z."
                  onYes={() => {
                    let n = 0;
                    mutate(() => {
                      n = deleteIssues(ids);
                    });
                    S.checked.clear();
                    emit();
                    toast(`Deleted ${n} issues`);
                  }}
                />,
              )
            }
          >
            <Ico svg={I.trash} />
            Delete
          </button>
        )}
        <div className="spacer" />
        <button
          className="btn sm subtle"
          onClick={() => {
            S.checked.clear();
            emit();
          }}
        >
          Clear selection
        </button>
      </div>
    );
  },
  (a, b) => a.sig === b.sig,
);
