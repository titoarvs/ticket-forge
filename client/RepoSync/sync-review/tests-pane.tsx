'use client';
// The "Test cases" tab: test cases to rewrite to match the code (with before / after), and new
// ones for new behaviour.
import type { Any } from '../../core';
import { stepsOf } from '../RepoSyncCard';
import { KEY } from './keys';
import { Item, Warn, type Picks } from './parts';

function StepsDiff({ u }: { u: Any }) {
  const before = stepsOf(u.before.steps);
  return (
    <div className="sync-diff">
      <div>
        <h5>Before</h5>
        <ol>
          {before.map((s: string, i: number) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <p>
          <b>Expected:</b> {u.before.expected}
        </p>
      </div>
      <div>
        <h5>After</h5>
        <ol>
          {u.after.steps.map((s: string, i: number) => (
            <li key={i} className={before.includes(s) ? '' : 'new'}>
              {s}
            </li>
          ))}
        </ol>
        <p>
          <b>Expected:</b> {u.after.expected}
        </p>
      </div>
    </div>
  );
}

function Update({
  ps,
  u,
  open,
  setOpen,
}: {
  ps: Picks;
  u: Any;
  open: boolean;
  setOpen: (o: boolean) => void;
}) {
  return (
    <Item ps={ps} k={KEY.upd(u)}>
      <div>
        <span className="key">{u.ref}</span> <b>{u.after.title}</b>{' '}
        <span className="muted small">· {u.ticketKey}</span>
      </div>
      <div className="muted small">{u.why}</div>
      <button className="link-btn small" onClick={() => setOpen(!open)}>
        {open ? 'Hide changes' : 'Show changes'}
      </button>
      {open && <StepsDiff u={u} />}
    </Item>
  );
}

type PaneProps = {
  r: Any;
  ps: Picks;
  changed: number;
  /** The test case whose before / after is shown (kept when switching tabs). */
  open: string | null;
  setOpen: (id: string | null) => void;
};

export function TestsPane({ r, ps, changed, open, setOpen }: PaneProps) {
  const { updates, additions, error } = r.tests;
  return (
    <div className="sync-pane">
      <Warn text={error && `Couldn’t check the test cases: ${error}`} />
      {!updates.length && !additions.length && !error && (
        <p className="muted small">
          {changed
            ? 'The changes don’t affect any test case.'
            : 'No page changed since the last sync.'}
        </p>
      )}
      {updates.length > 0 && (
        <h4 className="sync-h">
          Update {ps.n('upd:')} of {updates.length} test cases to match the code
        </h4>
      )}
      {updates.map((u: Any) => (
        <Update
          key={u.tcId}
          ps={ps}
          u={u}
          open={open === u.tcId}
          setOpen={(o) => setOpen(o ? u.tcId : null)}
        />
      ))}
      {additions.length > 0 && (
        <h4 className="sync-h">
          Add {ps.n('add:')} new test case{additions.length > 1 ? 's' : ''} for new behaviour
        </h4>
      )}
      {additions.map((ad: Any) => (
        <Item key={KEY.add(ad)} ps={ps} k={KEY.add(ad)}>
          <div>
            <span className="loz">{ad.tc.type}</span> <b>{ad.tc.title}</b>{' '}
            <span className="muted small">· {ad.ticketKey}</span>
          </div>
          <div className="muted small">{ad.why}</div>
        </Item>
      ))}
    </div>
  );
}
