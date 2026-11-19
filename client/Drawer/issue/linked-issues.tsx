'use client';
// Linked issues grouped by link type (blocks, duplicates, relates to …), and the "Link issue" form.
import { useState } from 'react';
import { type Any, P, ticket, LINK_TYPES, mutate, S, toast, removeLink, addLink } from '../../core';
import { Ico, I, StatusLoz, PriorityIcon } from '../../ui';
import { SF, opts, MenuItem } from '../../fields';
import { type IssueProps, showForm } from './edit';
import { IssueRow } from './child-issues';

function LinkGroup({ t, edit, type, items }: IssueProps & { type: string; items: Any[] }) {
  const unlink = (ev: React.MouseEvent, id: string) => {
    ev.stopPropagation();
    mutate(() => removeLink(t, id));
  };
  return (
    <div>
      <div className="link-type">{type}</div>
      <div className="rows">
        {items.map((l: Any) => {
          const o = ticket(l.targetId);
          return (
            <IssueRow
              key={l.id}
              o={o}
              right={
                <>
                  <StatusLoz s={o.status} />
                  <PriorityIcon p={o.priority} />
                  {edit && (
                    <button
                      className="icon-btn"
                      title="Remove link"
                      onClick={(ev) => unlink(ev, l.id)}
                    >
                      <Ico svg={I.close} />
                    </button>
                  )}
                </>
              }
            />
          );
        })}
      </div>
    </div>
  );
}

function NewLinkForm({ t }: { t: Any }) {
  const [link, setLink] = useState({ type: 'blocks', target: '' });
  const save = () => {
    const target = ticket(link.target);
    if (!target) return toast('Choose an issue to link.', 'err');
    let ok = false;
    mutate(() => {
      ok = addLink(t, link.type, target);
    });
    showForm('linkForm', false);
    toast(
      ok ? `${t.key} ${link.type} ${target.key}` : 'That link already exists.',
      ok ? 'ok' : 'err',
    );
  };
  return (
    <div className="inline-form" style={{ flexWrap: 'wrap' }}>
      <SF
        bare
        aria-label="Link type"
        value={link.type}
        onChange={(ev) => setLink({ ...link, type: ev.target.value })}
      >
        {opts(Object.keys(LINK_TYPES))}
      </SF>
      <SF
        bare
        aria-label="Issue"
        style={{ flex: 1, minWidth: 200 }}
        value={link.target}
        onChange={(ev) => setLink({ ...link, target: ev.target.value })}
      >
        <MenuItem value="">Choose an issue…</MenuItem>
        {P()
          .tickets.filter((x: Any) => x.id !== t.id)
          .map((o: Any) => (
            <MenuItem key={o.id} value={o.id}>
              {o.key} — {o.title.slice(0, 70)}
            </MenuItem>
          ))}
      </SF>
      <button className="btn sm primary" onClick={save}>
        Link
      </button>
      <button className="btn sm subtle" onClick={() => showForm('linkForm', false)}>
        Cancel
      </button>
    </div>
  );
}

export function LinkedIssues({ t, edit }: IssueProps) {
  const groups = Object.keys(LINK_TYPES)
    .map((type) => ({
      type,
      items: t.links.filter((l: Any) => l.type === type && ticket(l.targetId)),
    }))
    .filter((g) => g.items.length);
  return (
    <div className="sec">
      <div className="sec-title">
        <Ico svg={I.link} />
        <h3>Linked issues</h3>
        <span className="count">{t.links.length}</span>
        {edit && (
          <div className="tools">
            <button className="btn sm subtle" onClick={() => showForm('linkForm', true)}>
              <Ico svg={I.plus} />
              Link issue
            </button>
          </div>
        )}
      </div>
      {groups.map((g) => (
        <LinkGroup key={g.type} t={t} edit={edit} type={g.type} items={g.items} />
      ))}
      {S.linkForm && <NewLinkForm t={t} />}
      {!t.links.length && !S.linkForm && (
        <p className="muted small">Show which issues block, duplicate or relate to this one.</p>
      )}
    </div>
  );
}
