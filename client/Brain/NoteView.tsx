'use client';
import type { ReactNode } from 'react';
import { type Any, ticket as ticketOf, epic as epicOf, openModal, ago } from '../core';
import { Ico, I } from '../ui';
import { MarkdownDoc } from '../markdown';
import { openDrawer } from '../actions';
import { TYPE_LABEL, base } from './make-resolver';
import { AiPreview } from './NoteEditor';
import { LinkList } from './BrainHome';

export function NoteView({
  note,
  list,
  resolve,
  byId,
  back: _back,
  onOpen,
  onBack,
  onEdit,
  onDelete,
  onCreate,
}: Any) {
  const mine = note.kind === 'user';
  const issue = note.kind === 'auto' && note.type === 'issue' ? ticketOf(note.ref) : null;
  const ep = note.kind === 'auto' && note.type === 'epic' ? epicOf(note.ref) : null;
  const wikilink = (target: string, label: string, key: string): ReactNode => {
    const id = resolve(target);
    const n = id && byId.get(id);
    if (n)
      return (
        <button
          key={key}
          type="button"
          className={`wikilink t-${n.type}`}
          onClick={() => onOpen(id)}
          title={`${TYPE_LABEL[n.type] || n.type}: ${n.title}`}
        >
          {label}
        </button>
      );
    return (
      <button
        key={key}
        type="button"
        className="wikilink missing"
        disabled={!list.can.write}
        onClick={() => onCreate(target, `# ${target}\n\n`)}
        title={
          list.can.write
            ? `No note called “${target}” yet. Click to create it.`
            : `No note called “${target}” yet`
        }
      >
        {label}
      </button>
    );
  };
  return (
    <article className="brain-note">
      <button className="btn sm subtle brain-back" onClick={onBack}>
        <Ico svg={I.chevron} />
        Notes
      </button>
      <div className="brain-note-head">
        <div className="brain-chips">
          <span className={`bn-chip t-${note.type}`}>
            <span className={`bn-dot t-${note.type}`} aria-hidden="true" />
            {TYPE_LABEL[note.type] || note.type}
          </span>
          {note.status && <span className="loz">{note.status}</span>}
          {(note.tags || [])
            .filter((t: string) => t !== note.type)
            .slice(0, 8)
            .map((t: string) => (
              <span key={t} className="label-chip">
                #{t}
              </span>
            ))}
        </div>
        <div className="brain-note-acts">
          {issue && (
            <button className="btn sm" onClick={() => openDrawer('issue', issue.id)}>
              <Ico svg={I.expand} />
              Open {issue.key}
            </button>
          )}
          {ep && (
            <button className="btn sm" onClick={() => openDrawer('epic', ep.id)}>
              <Ico svg={I.expand} />
              Open epic
            </button>
          )}
          {(issue || ep) && (
            <button
              className="btn sm ai"
              onClick={() =>
                openModal(
                  <AiPreview
                    issueId={issue?.id}
                    epicId={ep?.id}
                    title={note.title}
                    onOpen={onOpen}
                  />,
                )
              }
              title="The notes AI actions and code agents get for this"
            >
              <Ico svg={I.sparkle} />
              What the AI reads
            </button>
          )}
          {mine && list.can.write && (
            <>
              <button className="btn sm" onClick={onEdit}>
                <Ico svg={I.pencil} />
                Edit
              </button>
              <button
                className="icon-btn"
                onClick={onDelete}
                aria-label="Delete note"
                title="Delete"
              >
                <Ico svg={I.trash} />
              </button>
            </>
          )}
        </div>
      </div>
      <p className="muted small brain-note-meta">
        {mine
          ? `Team note${note.updatedBy ? ` by ${note.updatedBy}` : ''}`
          : 'Written by TicketForge from the project (read-only: refreshes replace it)'}{' '}
        · updated {ago(note.updatedAt)} · <code>{note.id}.md</code>
      </p>
      {!/^#\s/.test(String(note.body).trim()) && <h2 className="brain-note-title">{note.title}</h2>}
      <div className="md-doc brain-md">
        <MarkdownDoc text={note.body} baseLevel={2} wikilink={wikilink} />
      </div>
      {!mine && list.can.write && (
        <p className="muted small" style={{ marginTop: 16 }}>
          Something to add?{' '}
          <button
            className="link-btn"
            onClick={() => onCreate(`About ${base(note.id)}`, `Notes on [[${base(note.id)}]]\n\n`)}
          >
            Write a note that links here
          </button>
          .
        </p>
      )}
      {note.unresolved?.length > 0 && (
        <p className="muted small">
          Links without a note yet:{' '}
          {note.unresolved.slice(0, 12).map((t: string) => (
            <code key={t} style={{ marginRight: 6 }}>
              [[{t}]]
            </code>
          ))}
        </p>
      )}
      <div className="brain-link-cols">
        <LinkList
          title="Links to"
          items={note.out}
          onOpen={onOpen}
          empty="This note doesn’t link to other notes."
        />
        <LinkList
          title="Linked from"
          items={note.back}
          onOpen={onOpen}
          empty="No other note links here yet."
        />
      </div>
    </article>
  );
}
