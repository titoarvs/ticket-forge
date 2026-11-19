'use client';
// Child issues (sub-tasks): progress, the list, and the inline "Add child issue" form.
import { useState } from 'react';
import { type Any, can, childrenOf, S, catOf, isDone } from '../../core';
import { Ico, I, TypeIcon, Avatar, StatusLoz } from '../../ui';
import { openDrawer, createSubtask } from '../../actions';
import { ProgBar } from '../../views';
import { TF } from '../../fields';
import { showForm } from './edit';

/** An issue in a list; clicking it opens it. `right` is what shows at the end of the row. */
export function IssueRow({ o, right }: { o: Any; right: React.ReactNode }) {
  return (
    <div className="irow" onClick={() => openDrawer('issue', o.id)}>
      <TypeIcon type={o.type} />
      <span className="key">{o.key}</span>
      <span className="sum">{o.title}</span>
      <span className="right">{right}</span>
    </div>
  );
}

function Progress({ kids }: { kids: Any[] }) {
  const done = kids.filter(isDone).length;
  return (
    <div className="row small muted" style={{ marginBottom: 6, flexWrap: 'nowrap' }}>
      <ProgBar
        done={done}
        prog={kids.filter((k: Any) => catOf(k.status) === 'inprogress').length}
        total={kids.length}
      />
      <span style={{ whiteSpace: 'nowrap' }}>{Math.round((done / kids.length) * 100)}% done</span>
    </div>
  );
}

function NewChildForm({ t }: { t: Any }) {
  const [title, setTitle] = useState('');
  const create = () => {
    createSubtask(t, title);
    setTitle('');
  };
  return (
    <div className="inline-form">
      <span style={{ padding: '0 4px' }}>
        <TypeIcon type="Sub-task" />
      </span>
      <TF
        bare
        autoFocus
        placeholder="What needs to be done?"
        autoComplete="off"
        value={title}
        onChange={(ev) => setTitle(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            create();
          }
          if (ev.key === 'Escape') showForm('subForm', false);
        }}
      />
      <button className="btn sm primary" onClick={create}>
        Create
      </button>
      <button className="btn sm subtle" onClick={() => showForm('subForm', false)}>
        Cancel
      </button>
    </div>
  );
}

export function ChildIssues({ t }: { t: Any }) {
  const kids = childrenOf(t);
  return (
    <div className="sec">
      <div className="sec-title">
        <Ico svg={I.subtask} />
        <h3>Child issues</h3>
        <span className="count">{kids.length}</span>
        {can('issue.create') && (
          <div className="tools">
            <button className="btn sm subtle" onClick={() => showForm('subForm', true)}>
              <Ico svg={I.plus} />
              Add child issue
            </button>
          </div>
        )}
      </div>
      {kids.length > 0 && (
        <>
          <Progress kids={kids} />
          <div className="rows">
            {kids.map((k: Any) => (
              <IssueRow
                key={k.id}
                o={k}
                right={
                  <>
                    <Avatar name={k.assignee} />
                    <StatusLoz s={k.status} />
                  </>
                }
              />
            ))}
          </div>
        </>
      )}
      {S.subForm && <NewChildForm t={t} />}
      {!kids.length && !S.subForm && (
        <p className="muted small">Break this issue into smaller pieces of work.</p>
      )}
    </div>
  );
}
