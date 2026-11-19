'use client';
import { useState } from 'react';
import {
  type Any,
  P,
  isSub,
  isDone,
  mutate,
  setField,
  closeModal,
  toast,
  release,
  can,
  openModal,
  fmtDate,
  spSum,
  copyText,
  saveBlob,
  catOf,
} from '../core';
import { Modal, TypeIcon, StatusLoz, Ico, I, EmptyState, Avatar, PriorityIcon } from '../ui';
import { TF, CB } from '../fields';
import { openDrawer } from '../actions';
import {
  releaseIssues,
  canRelease,
  RelLoz,
  ReleaseNowModal,
  ReleaseModal,
  Progress,
} from './ReleaseModal';

/** Add issues to a version: search and tick. */
function AddIssuesModal({ r }: { r: Any }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);
  const qq = q.trim().toLowerCase();
  const list = P()
    .tickets.filter(
      (t: Any) =>
        !isSub(t) &&
        !(t.fixVersions || []).includes(r.id) &&
        (showDone || !isDone(t)) &&
        (!qq || `${t.key} ${t.title}`.toLowerCase().includes(qq)),
    )
    .slice(0, 200);
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const add = () => {
    mutate(() => {
      for (const id of picked) {
        const t = P().tickets.find((x: Any) => x.id === id);
        if (t) setField(t, 'fixVersions', [...(t.fixVersions || []), r.id]);
      }
    });
    closeModal();
    toast(`Added ${picked.size} issue${picked.size === 1 ? '' : 's'} to ${r.name}`);
  };
  return (
    <Modal
      title={`Add issues to ${r.name}`}
      wide
      actions={[
        { label: 'Cancel' },
        {
          label: picked.size ? `Add ${picked.size}` : 'Add',
          kind: 'primary',
          disabled: !picked.size,
          onClick: add,
        },
      ]}
    >
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <TF
          search
          autoFocus
          value={q}
          placeholder="Search issues by key or summary"
          onChange={(e) => setQ(e.target.value)}
        />
        <CB
          label="Include done"
          checked={showDone}
          onChange={(e: Any) => setShowDone(e.target.checked)}
        />
      </div>
      <div className="rel-pick">
        {list.length ? (
          list.map((t: Any) => (
            <label key={t.id} className={`rel-pick-row ${picked.has(t.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} />
              <TypeIcon type={t.type} />
              <span className="key">{t.key}</span>
              <span className="sum">{t.title}</span>
              {(t.fixVersions || [])
                .filter((v: string) => release(v))
                .map((v: string) => (
                  <span key={v} className="label-chip">
                    {release(v).name}
                  </span>
                ))}
              <StatusLoz s={t.status} />
            </label>
          ))
        ) : (
          <p className="muted small">No issues match.</p>
        )}
      </div>
    </Modal>
  );
}
/** Release notes as Markdown: features, improvements and fixes from the version's done issues. */
export function releaseNotes(r: Any) {
  const done = releaseIssues(r.id).filter(isDone);
  const sec = (title: string, types: string[]) => {
    const l = done.filter((t: Any) => types.includes(t.type));
    return l.length
      ? `## ${title}\n${l.map((t: Any) => `- ${t.title} (${t.key})`).join('\n')}\n`
      : '';
  };
  const date = r.releaseDate
    ? ` (${new Date(`${r.releaseDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })})`
    : '';
  return [
    `# ${P().name} ${r.name}${date}`,
    r.description ? `\n${r.description}\n` : '',
    sec('New features', ['Story']),
    sec('Improvements', ['Task', 'Spike']),
    sec('Bug fixes', ['Bug']),
    done.length ? '' : '_No finished issues yet._\n',
  ]
    .filter(Boolean)
    .join('\n');
}
export function ReleaseDetail({ r, back }: { r: Any; back: () => void }) {
  const items = releaseIssues(r.id);
  const manage = canRelease();
  const edit = can('issue.edit') || manage;
  const open = items.filter((t: Any) => !isDone(t));
  const openPrs = items.flatMap((t: Any) =>
    (t.prs || [])
      .filter((x: Any) => ['Open', 'Draft'].includes(x.status))
      .map((x: Any) => ({ t, x })),
  );
  const failing = items.flatMap((t: Any) =>
    t.testCases.filter((tc: Any) => tc.status === 'Fail').map((tc: Any) => ({ t, tc })),
  );
  const [tab, setTab] = useState<'issues' | 'notes'>('issues');
  const remove = (t: Any) =>
    mutate(() =>
      setField(
        t,
        'fixVersions',
        (t.fixVersions || []).filter((v: string) => v !== r.id),
      ),
    );
  const notes = releaseNotes(r);
  const cats: [string, string][] = [
    ['todo', 'To do'],
    ['inprogress', 'In progress'],
    ['done', 'Done'],
  ];
  return (
    <>
      <div className="crumbs">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            back();
          }}
        >
          Releases
        </a>
        <span>/</span>
        <span>{r.name}</span>
      </div>
      <div className="page-h">
        <h1>{r.name}</h1>
        <RelLoz r={r} />
        <div className="spacer" />
        {manage && r.status === 'unreleased' && (
          <button className="btn primary" onClick={() => openModal(<ReleaseNowModal r={r} />)}>
            <Ico svg={I.check} />
            Release
          </button>
        )}
        {manage && (
          <button className="btn" onClick={() => openModal(<ReleaseModal r={r} />)}>
            <Ico svg={I.pencil} />
            Edit
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: -6 }}>
        {r.startDate ? `${fmtDate(r.startDate)} – ` : ''}
        {r.releaseDate
          ? `${r.status === 'released' ? 'Released' : 'Release'} ${fmtDate(r.releaseDate)}`
          : 'No release date'}
        {r.description ? ` · ${r.description}` : ''}
      </p>
      <div className="rel-cards">
        <div className="card">
          <h3>Progress</h3>
          <Progress items={items} />
          <p className="muted small" style={{ margin: '6px 0 0' }}>
            {spSum(items.filter(isDone))} of {spSum(items)} story points done
          </p>
        </div>
        <div className={`card ${open.length ? 'warn' : ''}`}>
          <h3>
            {open.length} unfinished issue{open.length === 1 ? '' : 's'}
          </h3>
          <p className="muted small">
            {open.length
              ? 'Moved to another version (or out of this one) when you release.'
              : 'Everything in this version is done.'}
          </p>
        </div>
        <div className={`card ${openPrs.length ? 'warn' : ''}`}>
          <h3>
            {openPrs.length} open pull request{openPrs.length === 1 ? '' : 's'}
          </h3>
          <p className="muted small">
            {openPrs.length
              ? openPrs
                  .slice(0, 3)
                  .map(({ x }: Any) => x.title)
                  .join(' · ')
              : 'Nothing waiting to merge.'}
          </p>
        </div>
        <div className={`card ${failing.length ? 'bad' : ''}`}>
          <h3>
            {failing.length} failing test{failing.length === 1 ? '' : 's'}
          </h3>
          <p className="muted small">
            {failing.length
              ? [...new Set(failing.map(({ t }: Any) => t.key))].slice(0, 6).join(', ')
              : 'No failing tests on these issues.'}
          </p>
        </div>
      </div>
      <div className="tabbar rel-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'issues'}
          className={`tab ${tab === 'issues' ? 'active' : ''}`}
          onClick={() => setTab('issues')}
        >
          Issues <span className="count">{items.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'notes'}
          className={`tab ${tab === 'notes' ? 'active' : ''}`}
          onClick={() => setTab('notes')}
        >
          Release notes
        </button>
        <div className="spacer" />
        {tab === 'issues' && edit && (
          <button className="btn sm" onClick={() => openModal(<AddIssuesModal r={r} />)}>
            <Ico svg={I.plus} />
            Add issues
          </button>
        )}
        {tab === 'notes' && (
          <>
            <button className="btn sm" onClick={() => copyText(notes)}>
              <Ico svg={I.copy} />
              Copy
            </button>
            <button
              className="btn sm"
              onClick={() =>
                saveBlob(
                  new Blob([notes], { type: 'text/markdown' }),
                  `${P().key}-${r.name.replace(/[^\w.-]+/g, '-')}-release-notes.md`,
                )
              }
            >
              <Ico svg={I.download} />
              Download .md
            </button>
          </>
        )}
      </div>
      {tab === 'notes' ? (
        <pre className="rel-notes">{notes}</pre>
      ) : !items.length ? (
        <EmptyState
          compact
          icon={I.backlog}
          tone="neutral"
          title="No issues in this version"
          actions={
            edit && (
              <button className="btn primary" onClick={() => openModal(<AddIssuesModal r={r} />)}>
                <Ico svg={I.plus} />
                Add issues
              </button>
            )
          }
        >
          <p>
            Add issues here, or set the Fix version on an issue, from the row menu or the selection
            bar in the backlog.
          </p>
        </EmptyState>
      ) : (
        cats.map(([cat, label]) => {
          const l = items.filter((t: Any) => catOf(t.status) === cat);
          return !l.length ? null : (
            <div key={cat} className="rel-group">
              <h4>
                {label} <span className="count">{l.length}</span>
              </h4>
              <div className="rows">
                {l.map((t: Any) => (
                  <div key={t.id} className="irow" onClick={() => openDrawer('issue', t.id)}>
                    <TypeIcon type={t.type} />
                    <span className="key">{t.key}</span>
                    <span className="sum">{t.title}</span>
                    <span className="right">
                      {(t.prs || []).some((x: Any) => ['Open', 'Draft'].includes(x.status)) && (
                        <span className="mini" title="Open pull request">
                          <Ico svg={I.pr} />
                        </span>
                      )}
                      <StatusLoz s={t.status} />
                      <Avatar name={t.assignee} />
                      <span className="sp">{t.storyPoints ?? '–'}</span>
                      <PriorityIcon p={t.priority} />
                      {edit && (
                        <button
                          className="icon-btn"
                          title={`Remove from ${r.name}`}
                          aria-label={`Remove ${t.key} from ${r.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            remove(t);
                          }}
                        >
                          <Ico svg={I.close} />
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
