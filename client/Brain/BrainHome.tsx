'use client';
import { type Any, ago } from '../core';
import { EmptyState, I, Ico } from '../ui';
import { TF, SF, MenuItem } from '../fields';
import { TYPE_ORDER, TYPE_LABEL, type List } from './make-resolver';

export function Filters({ q, setQ, type, setType, tag, setTag, tags, counts }: Any) {
  return (
    <div className="brain-filters">
      <TF
        search
        size="small"
        placeholder="Search notes"
        value={q}
        onChange={(e: Any) => setQ(e.target.value)}
        aria-label="Search notes"
      />
      <div className="brain-filter-row">
        <SF
          filter
          size="small"
          value={type}
          onChange={(e: Any) => setType(e.target.value)}
          aria-label="Type"
        >
          <MenuItem value="">All types</MenuItem>
          {TYPE_ORDER.filter((t) => counts[t]).map((t) => (
            <MenuItem key={t} value={t}>
              <span className={`bn-dot t-${t}`} aria-hidden="true" />
              {TYPE_LABEL[t]} ({counts[t]})
            </MenuItem>
          ))}
        </SF>
        {tags.length > 0 && (
          <SF
            filter
            size="small"
            value={tag}
            onChange={(e: Any) => setTag(e.target.value)}
            aria-label="Tag"
          >
            <MenuItem value="">All tags</MenuItem>
            {tags.map((t: string) => (
              <MenuItem key={t} value={t}>
                #{t}
              </MenuItem>
            ))}
          </SF>
        )}
        {(type || tag || q) && (
          <button
            className="btn sm subtle"
            onClick={() => {
              setQ('');
              setType('');
              setTag('');
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
export function BrainHome({
  list,
  onOpen,
  onNew,
}: {
  list: List;
  onOpen: (id: string) => void;
  onNew: (() => void) | null;
}) {
  const idx = list.notes.find((n) => n.type === 'index');
  const recent = list.notes
    .filter((n) => n.kind === 'user')
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 6);
  return (
    <div className="brain-note brain-home">
      <EmptyState
        icon={I.brain}
        tone="ai"
        title="The project’s Obsidian vault"
        compact
        actions={
          <>
            {idx && (
              <button className="btn primary" onClick={() => onOpen(idx.id)}>
                Open the index
              </button>
            )}
            {onNew && (
              <button className="btn" onClick={onNew}>
                <Ico svg={I.plus} />
                New note
              </button>
            )}
          </>
        }
      >
        <p>
          Linked notes about everything in this project: epics, issues with their acceptance
          criteria and status, decisions, open questions, releases, documents, the app context and
          the repository profile. TicketForge keeps them up to date as the project changes.
        </p>
        <p>
          AI actions and code agents read the notes linked to their task before they start
          {list.useInAi ? '' : ' (switched off for this project in Obsidian settings)'}. Add your
          own notes for what isn’t written anywhere else, link them with <code>[[PRJ-12]]</code>,
          and TicketForge never overwrites them.
        </p>
      </EmptyState>
      {recent.length > 0 && (
        <>
          <h3 className="brain-h">The team’s latest notes</h3>
          <div className="brain-links-list">
            {recent.map((n) => (
              <button key={n.id} className="brain-link-item" onClick={() => onOpen(n.id)}>
                <span className={`bn-dot t-${n.type}`} />
                {n.title}
                <span className="muted small">
                  {' '}
                  · {ago(n.updatedAt)}
                  {n.updatedBy ? ` by ${n.updatedBy}` : ''}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
export function LinkList({
  title,
  items,
  onOpen,
  empty,
}: {
  title: string;
  items: Any[];
  onOpen: (id: string) => void;
  empty: string;
}) {
  return (
    <div className="brain-links">
      <h3 className="brain-h">
        {title} <span className="count">{items.length}</span>
      </h3>
      {items.length ? (
        <div className="brain-links-list">
          {items.map((x) => (
            <button
              key={x.id}
              className="brain-link-item"
              onClick={() => onOpen(x.id)}
              title={x.id}
            >
              <span className={`bn-dot t-${x.type}`} aria-hidden="true" />
              <span className="brain-link-text">
                {x.key && (x.type === 'issue' || x.type === 'epic') ? <b>{x.key} </b> : null}
                {x.title}
              </span>
              <span className="muted small">{TYPE_LABEL[x.type] || x.type}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          {empty}
        </p>
      )}
    </div>
  );
}
