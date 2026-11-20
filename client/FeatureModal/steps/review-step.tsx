'use client';
// Step 4: review the plan by epic, pick the issues to add (or save a new epic as a draft), then add
// them. Nothing changes before Add, and Add can be undone.
import { useState } from 'react';
import { type Any, P } from '../../core';
import { Modal, Ico, I, EmptyState, TypeIcon } from '../../ui';
import type { Feature } from './use-feature';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One planned issue: tick it to add it, click it to see its story, criteria and tests. */
function PlannedIssue({ t, f, drafted }: { t: Any; f: Feature; drafted: boolean }) {
  const [open, setOpen] = useState(false);
  const on = Boolean(f.pick[t.id]) && !drafted;
  return (
    <div className={`feat-row ${on ? '' : 'off'}`}>
      <input
        type="checkbox"
        disabled={drafted}
        checked={on}
        onChange={(ev) => f.setPick({ ...f.pick, [t.id]: ev.target.checked })}
        aria-label={`Add ${t.title}`}
      />
      <button
        type="button"
        className="feat-main"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <TypeIcon type={t.type} />
        <span className="feat-title">{t.title}</span>
        <span className="muted small">
          {t.storyPoints ?? '–'} pts · {t.acceptanceCriteria.length} AC · {t.testCases.length} tests
        </span>
        <Ico svg={I.chevron} className={open ? 'up' : ''} />
      </button>
      {open && (
        <div className="feat-detail small">
          {t.userStory && (
            <p>
              <i>{t.userStory}</i>
            </p>
          )}
          <ol>
            {t.acceptanceCriteria.map((a: string, i: number) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
          {t.testCases.length > 0 && (
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Tests: {t.testCases.map((x: Any) => x.title).join(' · ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Ticks every issue of the epic (half-ticked when only some are). */
function EpicHeader({ e, items, f }: { e: Any; items: Any[]; f: Feature }) {
  const picked = items.filter((t: Any) => f.pick[t.id]).length;
  const all = picked === items.length;
  return (
    <label className="feat-epic-h">
      <input
        type="checkbox"
        checked={all}
        ref={(el) => {
          if (el) el.indeterminate = !all && picked > 0;
        }}
        onChange={(ev) =>
          f.setPick({
            ...f.pick,
            ...Object.fromEntries(items.map((t: Any) => [t.id, ev.target.checked])),
          })
        }
      />
      <TypeIcon type="Epic" />
      <b>{e.title}</b>
      <span className={`loz ${e.existing ? '' : 't-pass'}`}>
        {e.existing ? 'Existing epic' : 'New epic'}
      </span>
      <span className="muted small" style={{ marginLeft: 'auto' }}>
        {picked} of {items.length}
      </span>
    </label>
  );
}

function SaveAsDraft({ e, items, f }: { e: Any; items: Any[]; f: Feature }) {
  const done = f.drafted[e.id];
  return (
    <div className="row" style={{ margin: '4px 0' }}>
      {done ? (
        <span className="loz t-blocked">Saved as draft</span>
      ) : (
        <button
          className="btn sm"
          title="Keep this epic as a draft in the epic list, to review and publish later"
          onClick={() => f.draft(e, items)}
        >
          Save as draft
        </button>
      )}
      {done && <span className="muted small">Find it in the Epics list, with a Draft badge.</span>}
    </div>
  );
}

function EpicGroup({ e, items, f }: { e: Any; items: Any[]; f: Feature }) {
  return (
    <div className="feat-epic">
      <EpicHeader e={e} items={items} f={f} />
      {!e.existing && e.description && <p className="muted small feat-desc">{e.description}</p>}
      {!e.existing && f.canEpic && <SaveAsDraft e={e} items={items} f={f} />}
      {items.map((t: Any) => (
        <PlannedIssue key={t.id} t={t} f={f} drafted={Boolean(f.drafted[e.id])} />
      ))}
    </div>
  );
}

function OpenQuestions({ list }: { list: string[] }) {
  return (
    <details className="feat-q">
      <summary className="small">{plural(list.length, 'open question')} to raise</summary>
      <ul className="small">
        {list.map((q: string, i: number) => (
          <li key={i}>{q}</li>
        ))}
      </ul>
    </details>
  );
}

function addLabel(f: Feature) {
  const n = f.chosen.length;
  if (!n) return 'Add';
  const epics = f.canEpic && f.newEpics.length ? ` and ${plural(f.newEpics.length, 'epic')}` : '';
  return `Add ${plural(n, 'issue')}${epics}`;
}

export function ReviewStep({ f, onAdd }: { f: Feature; onAdd: () => void }) {
  const result = f.result;
  const byEpic = result.epics
    .map((e: Any) => ({ e, items: result.tickets.filter((t: Any) => t.epicId === e.id) }))
    .filter((g: Any) => g.items.length);
  return (
    <Modal
      title="Review the new work"
      wide
      persistent
      left={
        <button className="btn subtle" onClick={() => f.setStep('input')}>
          Back
        </button>
      }
      actions={[
        { label: 'Cancel' },
        { label: addLabel(f), kind: 'primary', disabled: !f.chosen.length, onClick: onAdd },
      ]}
    >
      {result.summary && <p style={{ marginTop: 0 }}>{result.summary}</p>}
      {result.openQuestions?.length > 0 && <OpenQuestions list={result.openQuestions} />}
      {!result.tickets.length && (
        <EmptyState compact icon={I.search} tone="neutral" title="Nothing new to add">
          <p>The AI found that the project already covers this. Try describing what’s different.</p>
        </EmptyState>
      )}
      {!f.canEpic && result.epics.some((e: Any) => !e.existing) && (
        <div className="warn-banner">
          <Ico svg={I.warn} />
          <span>
            Your role can’t create epics, so issues planned for new epics are added without an epic.
          </span>
        </div>
      )}
      {byEpic.map(({ e, items }: Any) => (
        <EpicGroup key={e.id} e={e} items={items} f={f} />
      ))}
      <p className="muted small" style={{ marginBottom: 0 }}>
        New issues go to the backlog with the next keys ({P().key}-…). You can undo this with ⌘Z.
      </p>
    </Modal>
  );
}
