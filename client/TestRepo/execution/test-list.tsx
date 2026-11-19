'use client';
// The tests in the execution: their result, who runs them and whether automation set the result;
// tick them to change several at once.
import type { Any } from '../../core';
import { RunLoz } from '../TestManagement';

type ListProps = {
  e: Any;
  tests: Any[];
  ed: boolean;
  cur: string | null;
  setCur: (id: string) => void;
  picked: string[];
  setPicked: (ids: string[]) => void;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

function TestItem({ t, rr, onPick }: { t: Any; rr: Any; onPick: () => void }) {
  return (
    <button onClick={onPick}>
      <RunLoz s={rr.status || 'TODO'} />
      <span className="key">{t.key}</span>
      <span className="split-title">{t.title}</span>
      {rr.assignee && (
        <span className="xr-who" title={`Assigned to ${rr.assignee}`}>
          {initials(rr.assignee)}
        </span>
      )}
      {rr.automated && (
        <span className="xr-auto" title="Result from automation">
          ⚙
        </span>
      )}
    </button>
  );
}

export function TestList({ e, tests, ed, cur, setCur, picked, setPicked }: ListProps) {
  const toggle = (tid: string) =>
    setPicked(picked.includes(tid) ? picked.filter((x) => x !== tid) : [...picked, tid]);
  const all = picked.length === e.testIds.length;
  return (
    <ul className="xr-exec-list">
      {e.testIds.map((tid: string) => {
        const t = tests.find((x: Any) => x.id === tid);
        if (!t) return null;
        return (
          <li key={tid} className={cur === tid ? 'on' : ''}>
            {ed && (
              <input
                type="checkbox"
                aria-label={`Select ${t.key}`}
                checked={picked.includes(tid)}
                onChange={() => toggle(tid)}
              />
            )}
            <TestItem t={t} rr={e.runs?.[tid] || {}} onPick={() => setCur(tid)} />
          </li>
        );
      })}
      {ed && e.testIds.length > 1 && (
        <li className="xr-selall">
          <button onClick={() => setPicked(all ? [] : [...e.testIds])}>
            {all ? 'Select none' : 'Select all'}
          </button>
        </li>
      )}
    </ul>
  );
}
