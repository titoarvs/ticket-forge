'use client';
// Agent Office: the panel a wall board opens, and the maximize button panels share. The big board
// lists every desk by group (phase, job status), the team board by team (team, project); picking
// one selects its bot. Maximized, it fills the office and each desk shows what it's doing.
import { type Any } from '../core';
import type { BotSnap } from './engine';
import type { OfficeDesk } from './OfficeCard';

type Props = {
  by: 'board' | 'teams';
  title: string;
  groups: string[];
  desks: OfficeDesk[];
  snap: BotSnap[];
  sel: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
  max?: boolean;
  onMax?: () => void;
};

/** Maximize / restore: two arrows out, or two arrows in. */
export function MaxButton({
  max,
  onClick,
  what,
}: {
  max: boolean;
  onClick: () => void;
  what: string;
}) {
  return (
    <button
      className="of-x sm of-maxb"
      aria-label={max ? `Restore ${what}` : `Maximize ${what}`}
      title={max ? 'Restore' : 'Full view'}
      aria-pressed={max}
      onClick={onClick}
    >
      <svg viewBox="0 0 16 16" aria-hidden>
        {max ? (
          <path d="M6.5 2.5v4h-4M9.5 13.5v-4h4M6.5 6.5L2 2M9.5 9.5L14 14" />
        ) : (
          <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9" />
        )}
      </svg>
    </button>
  );
}

function grouped(p: Props): [string, OfficeDesk[]][] {
  const keyOf = (d: OfficeDesk) => (p.by === 'board' ? d.group : d.team || 'General');
  const seen = [...new Set(p.desks.map(keyOf))];
  const order =
    p.by === 'board'
      ? [...p.groups.filter((g) => seen.includes(g)), ...seen.filter((g) => !p.groups.includes(g))]
      : seen.sort();
  return order.map((g) => [g, p.desks.filter((d) => keyOf(d) === g)]);
}

export function BoardPanel(p: Props) {
  return (
    <section className={`of-boardp of-panel ${p.max ? 'of-maxed' : ''}`} aria-label={p.title}>
      <header>
        <b>{p.title}</b>
        <span className="of-mute">{p.desks.length} on the floor</span>
        {p.onMax && <MaxButton max={!!p.max} onClick={p.onMax} what="board" />}
        <button className="of-x sm" aria-label="Close board" onClick={p.onClose}>
          ×
        </button>
      </header>
      <div className="of-boardp-cols">
        {grouped(p).map(([g, list]) => (
          <div key={g} className="of-boardp-col">
            <h3>
              {g} <span>{list.length}</span>
            </h3>
            {list.map((d) => {
              const s = p.snap.find((x) => x.id === d.id);
              return (
                <button
                  key={d.id}
                  className={`of-boardp-item ${p.sel === d.id ? 'on' : ''}`}
                  style={{ '--c': s?.color } as Any}
                  onClick={() => p.onPick(d.id)}
                >
                  <i />
                  <span>
                    <b>{d.name}</b>
                    <small>{s?.status}</small>
                    {p.max && s?.task && <small className="of-task">{s.task}</small>}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
