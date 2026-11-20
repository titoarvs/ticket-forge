'use client';
// The "Already built" tab: issues the code shows are delivered, and delivered features the backlog
// doesn't have yet.
import { type Any, P } from '../../core';
import { Ico, I } from '../../ui';
import { doneStatus } from '../RepoSyncCard';
import { KEY } from './keys';
import { Item, Warn, type Picks } from './parts';

function NewIssue({ ps, ni }: { ps: Picks; ni: Any }) {
  const epic = ni.epicId ? P().epics.find((e: Any) => e.id === ni.epicId)?.title || '' : '';
  const ac = ni.acceptanceCriteria.length;
  return (
    <Item ps={ps} k={KEY.new(ni)}>
      <div>
        <b>{ni.title}</b>{' '}
        <span className="muted small">
          · {ni.type}
          {ni.epicId ? ` · ${epic}` : ' · no epic'}
          {ac ? ` · ${ac} acceptance criteria` : ''}
        </span>
      </div>
      {ni.userStory && (
        <div className="small" style={{ fontStyle: 'italic' }}>
          {ni.userStory}
        </div>
      )}
      <div className="muted small">
        <Ico svg={I.pr} /> {ni.evidence}
        {ni.pages.length ? ` · ${ni.pages.join(', ')}` : ''}
      </div>
    </Item>
  );
}

export function BacklogPane({ r, ps }: { r: Any; ps: Picks }) {
  const { done: delivered, newIssues, error } = r.built;
  const done = doneStatus();
  return (
    <div className="sync-pane">
      <Warn text={error && `Couldn’t match the history with the backlog: ${error}`} />
      {!delivered.length && !newIssues.length && !error && (
        <p className="muted small">The backlog already matches what’s been built.</p>
      )}
      {delivered.length > 0 && (
        <h4 className="sync-h">
          Mark {ps.n('done:')} issue{delivered.length > 1 ? 's' : ''} as {done}: delivered in the
          code
        </h4>
      )}
      {delivered.map((d: Any) => (
        <Item key={d.ticketId} ps={ps} k={KEY.done(d)}>
          <div>
            <span className="key">{d.key}</span> <b>{d.title}</b>{' '}
            <span className="muted small">
              {d.status} → {done}
            </span>
          </div>
          <div className="muted small">
            <Ico svg={I.pr} /> {d.evidence}
          </div>
        </Item>
      ))}
      {newIssues.length > 0 && (
        <h4 className="sync-h">
          Add {ps.n('new:')} delivered feature{newIssues.length > 1 ? 's' : ''} to the backlog as{' '}
          {done}
        </h4>
      )}
      {newIssues.map((ni: Any) => (
        <NewIssue key={ni.title} ps={ps} ni={ni} />
      ))}
    </div>
  );
}
