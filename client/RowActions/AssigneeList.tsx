'use client';
import { useState, type KeyboardEvent as RKeyboardEvent, useEffect } from 'react';
import {
  ticket,
  allowedStatuses,
  statusNames,
  type Any,
  canMove,
  sCls,
  peopleNames,
  S,
  PRIORITIES,
  P,
  epic,
  isSub,
  releases,
  release,
  mutate,
  setField,
  toast,
  undo,
} from '../core';
import { Ico, I, Avatar, PriorityIcon, Swatch } from '../ui';
import {
  closePop,
  setStatusFor,
  assignTo,
  setPoints,
  plural,
  POINTS,
  setPriority,
  setEpic,
} from './move-to';

// ---------------------------------------------------------------- the popup
function useListKeys(n: number, pick: (i: number) => void) {
  const [active, setActive] = useState(-1);
  const onKeyDown = (e: RKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % Math.max(n, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a <= 0 ? n - 1 : a - 1));
    } else if (e.key === 'Enter' && active >= 0 && active < n) {
      e.preventDefault();
      pick(active);
    }
  };
  return { active, setActive, onKeyDown };
}
export function StatusList({ ids }: { ids: string[] }) {
  const list = ids.map(ticket).filter(Boolean);
  const one = list.length === 1 ? list[0] : null;
  const names: string[] = one ? allowedStatuses(one) : statusNames();
  const pick = (n: string) => {
    closePop();
    setStatusFor(ids, n);
  };
  const keys = useListKeys(names.length, (i) => pick(names[i]));
  return (
    <div
      className="pop-list"
      role="listbox"
      aria-label="Status"
      tabIndex={-1}
      onKeyDown={keys.onKeyDown}
      ref={(el) => el?.focus({ preventScroll: true })}
    >
      {names.map((n, i) => {
        const blocked = !one && list.every((t: Any) => !canMove(t, n));
        return (
          <button
            key={n}
            role="option"
            aria-selected={one?.status === n}
            className={`${i === keys.active ? 'on' : ''}`}
            disabled={blocked}
            title={blocked ? 'The workflow doesn’t allow these issues to move here' : ''}
            onMouseEnter={() => keys.setActive(i)}
            onClick={() => pick(n)}
          >
            <span className={`loz ${sCls(n)}`}>{n}</span>
            {one?.status === n && <Ico svg={I.check} className="pop-tick" />}
          </button>
        );
      })}
      {one && names.length < statusNames().length && (
        <p className="pop-note">
          Only the statuses this issue can move to are shown (Project settings → Workflow).
        </p>
      )}
    </div>
  );
}
export function AssigneeList({ ids }: { ids: string[] }) {
  const [q, setQ] = useState('');
  const one = ids.length === 1 ? ticket(ids[0]) : null;
  const cur = one?.assignee || '';
  const people = peopleNames();
  const mine = S.user?.name || '';
  const qq = q.trim().toLowerCase();
  const opts: [string, string][] = [];
  if (
    mine &&
    cur !== mine &&
    (!qq || 'assign to me'.includes(qq) || mine.toLowerCase().includes(qq))
  )
    opts.push([mine, 'Assign to me']);
  if (!qq || 'unassigned'.includes(qq)) opts.push(['', 'Unassigned']);
  for (const n of people
    .filter((n) => !qq || n.toLowerCase().includes(qq))
    .sort((a, b) => a.localeCompare(b)))
    opts.push([n, n]);
  const pick = (v: string) => {
    closePop();
    assignTo(ids, v);
  };
  const keys = useListKeys(opts.length, (i) => pick(opts[i][0]));
  useEffect(() => {
    keys.setActive(qq ? 0 : -1);
  }, [qq]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pop-list" role="listbox" aria-label="Assignee" onKeyDown={keys.onKeyDown}>
      <input
        className="pop-search"
        autoFocus
        placeholder="Search people"
        aria-label="Search people"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="pop-scroll">
        {opts.map(([v, label], i) => (
          <button
            key={`${label}|${v}`}
            role="option"
            aria-selected={one ? cur === v && label !== 'Assign to me' : false}
            className={i === keys.active ? 'on' : ''}
            onMouseEnter={() => keys.setActive(i)}
            onClick={() => pick(v)}
          >
            {label === 'Assign to me' ? (
              <>
                <Avatar name={mine} size={20} />
                <span>Assign to me</span>
              </>
            ) : (
              <>
                <Avatar name={v} size={20} />
                <span>{label}</span>
              </>
            )}
            {one && cur === v && label !== 'Assign to me' && (
              <Ico svg={I.check} className="pop-tick" />
            )}
          </button>
        ))}
        {!opts.length && <p className="pop-note">No one matches “{q}”.</p>}
      </div>
    </div>
  );
}
export function PointsEditor({ ids }: { ids: string[] }) {
  const one = ids.length === 1 ? ticket(ids[0]) : null;
  const [v, setV] = useState(one?.storyPoints != null ? String(one.storyPoints) : '');
  // Any positive number (a free value, not a fixed scale). A text box, so a wrong entry can be
  // shown and explained.
  const t = v.trim();
  const bad = t !== '' && !(/^\d+(\.\d+)?$/.test(t) && Number(t) > 0);
  const n = t === '' || bad ? null : Number(t);
  const save = (x: number | null) => {
    closePop();
    setPoints(ids, x);
  };
  return (
    <div className="pop-points">
      <label className="pop-h" htmlFor="pop-sp">
        Story point estimate{ids.length > 1 ? ` · ${plural(ids.length, 'issue')}` : ''}
      </label>
      <div className="row" style={{ gap: 6 }}>
        <input
          id="pop-sp"
          className="pop-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          value={v}
          placeholder="None"
          onFocus={(e) => e.target.select()}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (!bad) save(n);
            }
          }}
          aria-invalid={bad}
          aria-describedby={bad ? 'pop-sp-err' : undefined}
        />
        <button className="btn sm primary" disabled={bad} onClick={() => save(n)}>
          Save
        </button>
      </div>
      {bad && (
        <p id="pop-sp-err" className="pop-note err" role="alert">
          Enter a positive number, for example 13.
        </p>
      )}
      <div className="sp-quick" role="group" aria-label="Common estimates">
        {POINTS.map((p) => (
          <button key={p} className={one?.storyPoints === p ? 'on' : ''} onClick={() => save(p)}>
            {p}
          </button>
        ))}
      </div>
      {(one ? one.storyPoints != null : true) && (
        <button className="btn sm subtle" style={{ marginTop: 6 }} onClick={() => save(null)}>
          Clear estimate
        </button>
      )}
    </div>
  );
}
export function PriorityList({ ids }: { ids: string[] }) {
  const one = ids.length === 1 ? ticket(ids[0]) : null;
  const pick = (p: string) => {
    closePop();
    setPriority(ids, p);
  };
  const keys = useListKeys(PRIORITIES.length, (i) => pick(PRIORITIES[i]));
  return (
    <div
      className="pop-list"
      role="listbox"
      aria-label="Priority"
      tabIndex={-1}
      onKeyDown={keys.onKeyDown}
      ref={(el) => el?.focus({ preventScroll: true })}
    >
      {PRIORITIES.map((p, i) => (
        <button
          key={p}
          role="option"
          aria-selected={one?.priority === p}
          className={i === keys.active ? 'on' : ''}
          onMouseEnter={() => keys.setActive(i)}
          onClick={() => pick(p)}
        >
          <PriorityIcon p={p} />
          <span>{p}</span>
          {one?.priority === p && <Ico svg={I.check} className="pop-tick" />}
        </button>
      ))}
    </div>
  );
}
export function EpicList({ ids }: { ids: string[] }) {
  const one = ids.length === 1 ? ticket(ids[0]) : null;
  const [q, setQ] = useState('');
  const qq = q.trim().toLowerCase();
  const list = P().epics.filter(
    (e: Any) => !qq || `${e.key} ${e.title}`.toLowerCase().includes(qq),
  );
  const pick = (id: string | null) => {
    closePop();
    setEpic(ids, id);
  };
  return (
    <div className="pop-list" role="listbox" aria-label="Epic">
      {P().epics.length > 8 && (
        <input
          className="pop-search"
          autoFocus
          placeholder="Search epics"
          aria-label="Search epics"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      <div className="pop-scroll">
        {list.map((e: Any) => (
          <button
            key={e.id}
            role="option"
            aria-selected={one?.epicId === e.id}
            onClick={() => pick(e.id)}
          >
            <Swatch color={e.color} />
            <span>{e.title}</span>
            {one?.epicId === e.id && <Ico svg={I.check} className="pop-tick" />}
          </button>
        ))}
        <button
          role="option"
          aria-selected={one ? !epic(one.epicId) : false}
          onClick={() => pick(null)}
        >
          <span className="muted">No epic</span>
        </button>
      </div>
    </div>
  );
}
/**
 * Fix versions: tick to add, untick to remove (for several issues: added to or removed from all of
 * them).
 */
export function VersionList({ ids }: { ids: string[] }) {
  const list = ids.map(ticket).filter((t: Any) => t && !isSub(t));
  const rel = releases().filter((r: Any) => r.status !== 'archived');
  const has = (rid: string) =>
    list.length > 0 && list.every((t: Any) => (t.fixVersions || []).includes(rid));
  const toggle = (rid: string) => {
    const on = !has(rid);
    const name = release(rid)?.name;
    mutate(() =>
      list.forEach((t: Any) => {
        const cur = t.fixVersions || [];
        const next = on ? [...new Set([...cur, rid])] : cur.filter((v: string) => v !== rid);
        if (JSON.stringify(next) !== JSON.stringify(cur)) setField(t, 'fixVersions', next);
      }),
    );
    if (list.length > 1)
      toast(
        `${plural(list.length, 'issue')} ${on ? `added to ${name}` : `removed from ${name}`}`,
        'ok',
        {
          action: { label: 'Undo', onClick: undo },
        },
      );
  };
  return (
    <div className="pop-list" role="listbox" aria-label="Fix versions" aria-multiselectable>
      <div className="pop-h">Fix versions</div>
      {rel.length ? (
        rel.map((r: Any) => (
          <button key={r.id} role="option" aria-selected={has(r.id)} onClick={() => toggle(r.id)}>
            <span className="radio-box">{has(r.id) && <Ico svg={I.check} />}</span>
            <span>{r.name}</span>
            {r.status === 'released' && <small>Released</small>}
          </button>
        ))
      ) : (
        <p className="pop-note">No versions yet. Create one on the Releases page.</p>
      )}
    </div>
  );
}
