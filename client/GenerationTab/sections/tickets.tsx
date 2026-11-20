'use client';
// Tickets: title length, acceptance criteria, points, priority, labels, description and types.
import type { Any } from '../../core';
import { TF, CB, SF, MenuItem } from '../../fields';
import { TYPES } from '../tm-presets';
import type { Rules } from './use-rules';
import { NumField, CheckField, RuleLabel, DefaultNote } from './rule-fields';

/** Typed as "1, 2, 3, 5"; saved when the field loses focus. */
function PointScale({ g }: { g: Rules }) {
  const text = (g.r.tickets.pointScale || []).join(', ');
  const save = (v: string) =>
    g.set(
      'tickets.pointScale',
      v
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => n > 0),
    );
  return (
    <label className="field">
      <RuleLabel g={g} path="tickets.pointScale">
        Story point scale
      </RuleLabel>
      <TF
        key={text}
        defaultValue={text}
        placeholder="1, 2, 3, 5, 8, 13"
        onBlur={(e) => save(e.target.value)}
      />
    </label>
  );
}

function Selects({ g }: { g: Rules }) {
  const t = g.r.tickets;
  return (
    <>
      <label className="field">
        <RuleLabel g={g} path="tickets.maxPoints">
          Split tickets bigger than
        </RuleLabel>
        <SF
          value={t.maxPoints}
          onChange={(e) => g.set('tickets.maxPoints', Number(e.target.value))}
        >
          {(t.pointScale || []).map((n: number) => (
            <MenuItem key={n} value={n}>
              {n} points
            </MenuItem>
          ))}
        </SF>
      </label>
      <label className="field">
        <RuleLabel g={g} path="tickets.defaultPriority">
          Default priority
        </RuleLabel>
        <SF
          value={t.defaultPriority}
          onChange={(e) => g.set('tickets.defaultPriority', e.target.value)}
        >
          {['Highest', 'High', 'Medium', 'Low'].map((p) => (
            <MenuItem key={p} value={p}>
              {p}
            </MenuItem>
          ))}
        </SF>
      </label>
    </>
  );
}

/** At least one type stays on; the order follows TYPES. */
function TicketTypes({ g }: { g: Rules }) {
  const types: string[] = g.r.tickets.types;
  const toggle = (t: string, on: boolean) =>
    g.set(
      'tickets.types',
      on ? TYPES.filter((x) => x === t || types.includes(x)) : types.filter((x) => x !== t),
    );
  return (
    <>
      <span className="small" style={{ fontWeight: 600, color: 'var(--text-subtle)' }}>
        Ticket types
        <DefaultNote g={g} path="tickets.types" />
      </span>
      {TYPES.map((t) => (
        <CB
          key={t}
          label={t}
          checked={types.includes(t)}
          disabled={types.length === 1 && types.includes(t)}
          onChange={(e: Any) => toggle(t, e.target.checked)}
        />
      ))}
    </>
  );
}

export function TicketsSection({ g }: { g: Rules }) {
  return (
    <div className="cards">
      <div className="card wide">
        <h3>Tickets</h3>
        <div className="gen-grid">
          <NumField
            g={g}
            path="tickets.titleMaxWords"
            label="Title: at most (words)"
            min={3}
            max={30}
          />
          <label className="field">
            <RuleLabel g={g} path="tickets.acFormat">
              Acceptance criteria format
            </RuleLabel>
            <SF
              value={g.r.tickets.acFormat}
              onChange={(e) => g.set('tickets.acFormat', e.target.value)}
            >
              <MenuItem value="gwt">Given / When / Then</MenuItem>
              <MenuItem value="checklist">Checklist of testable statements</MenuItem>
            </SF>
          </label>
          <NumField
            g={g}
            path="tickets.acMin"
            label="Acceptance criteria: at least"
            min={1}
            max={15}
          />
          <NumField
            g={g}
            path="tickets.acMax"
            label="Acceptance criteria: at most"
            min={1}
            max={20}
          />
          <PointScale g={g} />
          <Selects g={g} />
          <NumField g={g} path="tickets.maxLabels" label="Labels: at most" min={0} max={10} />
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            <RuleLabel g={g} path="tickets.descriptionSections">
              Description sections, in order
            </RuleLabel>
            <TF
              value={g.r.tickets.descriptionSections}
              placeholder="e.g. Context, Scope, Out of scope (leave empty for free text)"
              onChange={(e) => g.set('tickets.descriptionSections', e.target.value)}
            />
          </label>
        </div>
        <div className="row" style={{ gap: 18, marginTop: 4 }}>
          <CheckField
            g={g}
            path="tickets.userStory"
            label="Every story has “As a…, I want…, so that…”"
          />
          <TicketTypes g={g} />
        </div>
      </div>
    </div>
  );
}
