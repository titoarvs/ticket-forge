'use client';
// What a document produced: its summary, epics and issues, and its assumptions and open questions.
import Link from 'next/link';
import { type Any, P, S, can } from '../../core';
import { Swatch, TypeIcon, StatusLoz } from '../../ui';
import { openDrawer } from '../../actions';
import { ItemText } from '../../ListEditor';

function EpicChips({ epics }: { epics: Any[] }) {
  return (
    <div className="row" style={{ gap: 6, marginBottom: 6 }}>
      <span className="muted small">Epics</span>
      {epics.map((e: Any) => (
        <button key={e.id} className="src-chip" onClick={() => openDrawer('epic', e.id)}>
          <Swatch color={e.color} />
          {e.title}
        </button>
      ))}
    </div>
  );
}

/** The issues it produced (open when there are only a few). */
function IssueList({ issues }: { issues: Any[] }) {
  return (
    <details className="src-issues" open={issues.length <= 6}>
      <summary className="small">
        <b>
          {issues.length} issue{issues.length === 1 ? '' : 's'}
        </b>{' '}
        created from this document
      </summary>
      <div className="rows">
        {issues.map((t: Any) => (
          <div key={t.id} className="irow" onClick={() => openDrawer('issue', t.id)}>
            <TypeIcon type={t.type} />
            <span className="key">{t.key}</span>
            <span className="sum">{t.title}</span>
            <span className="right">
              <StatusLoz s={t.status} />
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

/** Assumptions or open questions; those of the original document are edited in Project settings. */
function NumberedList({ label, list, sel }: { label: string; list: string[]; sel: Any }) {
  const editable = sel.kind === 'original' && can('project.settings');
  return (
    <details className="src-lists">
      <summary className="small">
        <b>
          {list.length} {label.toLowerCase()}
        </b>
        {editable && (
          <>
            {' '}
            ·{' '}
            <Link
              href={`/p/${P().id}/settings`}
              onClick={() => {
                S.setTab = 'details';
              }}
            >
              Edit
            </Link>
          </>
        )}
      </summary>
      <ol className="li-list read">
        {list.map((x: string, i: number) => (
          <li key={i}>
            <span className="li-n">{i + 1}</span>
            <div className="li-body">
              <ItemText s={x} />
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function DocWork({ sel, issues, epics }: { sel: Any; issues: Any[]; epics: Any[] }) {
  const lists: [string, string[]][] = [
    ['Assumptions', sel.assumptions || []],
    ['Open questions', sel.openQuestions || []],
  ];
  const deleted = (sel.issueIds || []).length - issues.length;
  const anything = sel.summary || epics.length || issues.length || lists.some(([, l]) => l.length);
  if (!anything) return null;
  return (
    <div className="src-work">
      {sel.summary && <p style={{ margin: '0 0 8px' }}>{sel.summary}</p>}
      {epics.length > 0 && <EpicChips epics={epics} />}
      {issues.length > 0 && <IssueList issues={issues} />}
      {deleted > 0 && (
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          {deleted} issue(s) from this document were deleted since.
        </p>
      )}
      {lists.map(
        ([label, list]) =>
          list.length > 0 && <NumberedList key={label} label={label} list={list} sel={sel} />,
      )}
    </div>
  );
}
