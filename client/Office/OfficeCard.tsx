'use client';
// Agent Office: the roster down the right (every desk with what it's doing) and the card for the
// selected desk (its status and progress, where to send it, and the caller's own actions).
import type { ReactNode } from 'react';
import { type Any, toast } from '../core';
import type { OfficeApi, BotSnap } from './engine';
import type { FloorItem } from './bots';
import { SPOTS } from './layout';

/** A desk as the page gives it: the floor item plus what its card shows. */
export type OfficeDesk = FloorItem & {
  icon?: string;
  /** The card's second line (phase · team, project · branch…). */
  sub?: string;
  /** The roster's tag after the name. */
  tag?: string;
  /** The label over the task line. */
  taskLabel?: string;
  /** Shown instead of the task and progress when the bot is off. */
  offNote?: string;
  actions?: ReactNode;
};

export function Roster(p: {
  title: string;
  desks: OfficeDesk[];
  snap: BotSnap[];
  sel: string | null;
  api: OfficeApi | null;
}) {
  return (
    <aside className="of-roster of-panel" aria-label={p.title}>
      <h2>{p.title}</h2>
      {p.desks.map((d) => {
        const s = p.snap.find((x) => x.id === d.id);
        return (
          <button
            key={d.id}
            className={`of-ag ${p.sel === d.id ? 'on' : ''} ${s?.state === 'off' ? 'off' : ''}`}
            style={{ '--c': s?.color } as Any}
            onClick={() => p.api?.select(d.id)}
          >
            <span className="of-av">
              <i />
            </span>
            <span>
              <b>
                {d.name} {d.tag && <small>· {d.tag}</small>}
              </b>
              <span className="of-st">{s?.status}</span>
            </span>
          </button>
        );
      })}
    </aside>
  );
}

function Progress({ d, s }: { d: OfficeDesk; s: BotSnap }) {
  if (s.prog == null) return null;
  const pct = Math.max(0, Math.min(100, s.prog)).toFixed(0);
  const away = s.state === 'walk' || s.state === 'stay';
  return (
    <>
      <div className="of-bar">
        <i style={{ width: pct + '%' }} />
      </div>
      <p className="of-pct">
        {d.live ? `${pct}% of the plan done` : `${pct}% done${away ? ' · paused while away' : ''}`}
      </p>
    </>
  );
}

function SendTo({ api }: { api: OfficeApi }) {
  const send = (k: string) => {
    if (!api.sendTo(k)) toast(`${SPOTS[k].chip} is full right now`);
  };
  return (
    <div className="of-chips">
      <p>Send to</p>
      {Object.entries(SPOTS).map(([k, S]) => (
        <button key={k} className="of-chip" onClick={() => send(k)}>
          {S.chip}
        </button>
      ))}
      <button className="of-chip" onClick={() => api.goDesk()}>
        Desk
      </button>
    </div>
  );
}

export function DeskCard(p: {
  d: OfficeDesk;
  s: BotSnap;
  api: OfficeApi;
  follow: boolean;
  setFollow: (v: boolean) => void;
}) {
  const { d, s, api } = p;
  const off = s.state === 'off';
  return (
    <section className="of-card of-panel" style={{ '--c': s.color } as Any} aria-live="polite">
      <div className="of-ch">
        <span className="of-av">
          <i />
        </span>
        <div>
          <h2>
            {d.icon} {d.name}
          </h2>
          {d.sub && <p>{d.sub}</p>}
        </div>
        <button className="of-x" aria-label="Close card" onClick={() => api.select(null)}>
          ×
        </button>
      </div>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{s.status}</dd>
        </div>
        {!off && s.task && (
          <div>
            <dt>{d.taskLabel || 'At its desk'}</dt>
            <dd>{s.task}</dd>
          </div>
        )}
      </dl>
      {off && d.offNote && <p className="of-pct">{d.offNote}</p>}
      {!off && <Progress d={d} s={s} />}
      {!off && d.wander !== false && <SendTo api={api} />}
      {d.actions && <div className="of-acts">{d.actions}</div>}
      <label className="of-follow">
        <input
          type="checkbox"
          checked={p.follow}
          onChange={(e) => {
            p.setFollow(e.target.checked);
            api.setFollow(e.target.checked);
          }}
        />
        Camera follows this desk
      </label>
    </section>
  );
}
