'use client';
// The issue panel's header: where the issue sits (epic / parent / issue) and its ⋯ menu.
import { type Any, can, isSub, toast } from '../../core';
import { Ico, I } from '../../ui';
import { openDrawer, duplicateIssue, convertToSubtask, confirmDeleteIssue } from '../../actions';
import { setFlag } from '../../RowActions';
import { Head, Crumb } from '../Drawer';

function Crumbs({ t, e, parent }: { t: Any; e: Any; parent: Any }) {
  return (
    <>
      {e && (
        <>
          <Crumb type="Epic" keyText={e.key} onClick={() => openDrawer('epic', e.id)} />
          <span className="sep">/</span>
        </>
      )}
      {parent && (
        <>
          <Crumb
            type={parent.type}
            keyText={parent.key}
            onClick={() => openDrawer('issue', parent.id)}
          />
          <span className="sep">/</span>
        </>
      )}
      <Crumb type={t.type} keyText={t.key} />
    </>
  );
}

function IssueMenu({ t, edit }: { t: Any; edit: boolean }) {
  const copyKey = () => {
    navigator.clipboard?.writeText(t.key);
    toast(`Copied ${t.key}`);
  };
  return (
    <>
      {can('issue.create') && (
        <button onClick={() => duplicateIssue(t)}>
          <Ico svg={I.copy} />
          Duplicate
        </button>
      )}
      <button onClick={copyKey}>
        <Ico svg={I.copy} />
        Copy key
      </button>
      {edit && (
        <button onClick={() => setFlag([t.id], !t.flagged)}>
          <Ico svg={I.flag} />
          {t.flagged ? 'Remove flag' : 'Add flag'}
        </button>
      )}
      {edit && !isSub(t) && (
        <button onClick={() => convertToSubtask(t)}>
          <Ico svg={I.subtask} />
          Convert to sub-task…
        </button>
      )}
      {can('issue.delete') && (
        <>
          <hr />
          <button style={{ color: 'var(--danger)' }} onClick={() => confirmDeleteIssue(t)}>
            <Ico svg={I.trash} />
            Delete
          </button>
        </>
      )}
    </>
  );
}

export function IssueHead({ t, e, parent, edit }: { t: Any; e: Any; parent: Any; edit: boolean }) {
  return (
    <Head crumb={<Crumbs t={t} e={e} parent={parent} />} menu={<IssueMenu t={t} edit={edit} />} />
  );
}
