'use client';
// Releases (Jira "versions"): plan what ships together. Each version has a name, dates and a description; issues get
// it as their Fix version. The list shows each version's progress, the detail its issues, what still blocks the
// release (open issues, open pull requests, failing tests) and release notes. Releasing a version asks where its
// unfinished issues go.
import { useState } from 'react';
import {
  P,
  useStore,
  mutate,
  setField,
  uid,
  toast,
  openModal,
  closeModal,
  catOf,
  isDone,
  isSub,
  spSum,
  fmtDate,
  ago,
  can,
  nowIso,
  copyText,
  saveBlob,
  releases,
  release,
  type Any,
} from './core';
import { Ico, I, Modal, EmptyState, TypeIcon, PriorityIcon, Avatar, StatusLoz, Confirm } from './ui';
import { TF, TA, SF, MenuItem, DateF, CB } from './fields';
import { openDrawer } from './actions';
import { Header } from './views';

const today = () => new Date().toISOString().slice(0, 10);
const STATUS_LABEL: Record<string, string> = { unreleased: 'Unreleased', released: 'Released', archived: 'Archived' };
const canRelease = () => can('sprint.manage') || can('project.settings');
/** Issues (not sub-tasks) with this fix version. */
export const releaseIssues = (id: string) => P().tickets.filter((t: Any) => !isSub(t) && (t.fixVersions || []).includes(id));
const overdue = (r: Any) => r.status === 'unreleased' && r.releaseDate && r.releaseDate < today();

function Progress({ items }: { items: Any[] }) {
  const n = items.length || 1;
  const c = (cat: string) => items.filter((t) => catOf(t.status) === cat).length;
  const [done, prog, todo] = [c('done'), c('inprogress'), c('todo')];
  return (
    <div className="rel-prog" title={`${done} done · ${prog} in progress · ${todo} to do`}>
      <div className="prog">
        {done > 0 && <i className="p-done" style={{ width: `${(done / n) * 100}%` }} />}
        {prog > 0 && <i className="p-prog" style={{ width: `${(prog / n) * 100}%` }} />}
      </div>
      <span className="muted small">{items.length ? `${done} of ${items.length} done` : 'No issues'}</span>
    </div>
  );
}
const RelLoz = ({ r }: { r: Any }) => (
  <span className={`loz ${r.status === 'released' ? 't-pass' : r.status === 'archived' ? '' : overdue(r) ? 't-fail' : 's-inprogress'}`}>
    {overdue(r) ? 'Overdue' : STATUS_LABEL[r.status] || r.status}
  </span>
);

/** Create or edit a version. */
export function ReleaseModal({ r }: { r?: Any }) {
  const [f, setF] = useState<Any>(() => ({
    name: r?.name || '',
    description: r?.description || '',
    startDate: r?.startDate || '',
    releaseDate: r?.releaseDate || '',
  }));
  const set = (k: string, v: Any) => setF((x: Any) => ({ ...x, [k]: v }));
  const taken = releases().some((x: Any) => x.id !== r?.id && x.name.trim().toLowerCase() === f.name.trim().toLowerCase());
  const badDates = f.startDate && f.releaseDate && f.releaseDate < f.startDate;
  const ok = f.name.trim() && !taken && !badDates;
  const save = () => {
    mutate((p) => {
      p.releases ??= [];
      if (r)
        Object.assign(
          p.releases.find((x: Any) => x.id === r.id),
          { ...f, name: f.name.trim() },
        );
      else p.releases.push({ id: uid(), ...f, name: f.name.trim(), status: 'unreleased', createdAt: nowIso() });
    });
    closeModal();
    toast(r ? `Saved ${f.name.trim()}` : `Created version ${f.name.trim()}`);
  };
  return (
    <Modal
      title={r ? `Edit ${r.name}` : 'Create version'}
      actions={[{ label: 'Cancel' }, { label: r ? 'Save' : 'Create', kind: 'primary', disabled: !ok, onClick: save }]}
    >
      <label className="field">
        <span>Name</span>
        <TF autoFocus value={f.name} placeholder="e.g. 1.4.0 or Payroll Q4" onChange={(e) => set('name', e.target.value)} />
        {taken && <span className="field-warn">A version with this name already exists.</span>}
      </label>
      <div className="grid2">
        <label className="field">
          <span>Start date</span>
          <DateF value={f.startDate} onChange={(v) => set('startDate', v)} />
        </label>
        <label className="field">
          <span>Release date</span>
          <DateF value={f.releaseDate} onChange={(v) => set('releaseDate', v)} />
        </label>
      </div>
      {badDates && <p className="field-warn">The release date is before the start date.</p>}
      <label className="field">
        <span>Description</span>
        <TA rows={3} value={f.description} placeholder="What this release is about" onChange={(e) => set('description', e.target.value)} />
      </label>
    </Modal>
  );
}

/** Release a version: when, and where its unfinished issues go. */
function ReleaseNowModal({ r }: { r: Any }) {
  const open = releaseIssues(r.id).filter((t: Any) => !isDone(t));
  const others = releases().filter((x: Any) => x.id !== r.id && x.status === 'unreleased');
  const [date, setDate] = useState(today());
  const [to, setTo] = useState(others[0]?.id || '');
  const go = () => {
    mutate((p) => {
      for (const t of open) {
        const next = (t.fixVersions || []).filter((v: string) => v !== r.id);
        if (to && !next.includes(to)) next.push(to);
        setField(t, 'fixVersions', next);
      }
      Object.assign(
        p.releases.find((x: Any) => x.id === r.id),
        { status: 'released', releaseDate: date, releasedAt: nowIso() },
      );
    });
    closeModal();
    toast(
      `Released ${r.name}${open.length ? `; ${open.length} unfinished issue${open.length === 1 ? '' : 's'} ${to ? `moved to ${release(to)?.name}` : 'removed from it'}` : ''}`,
    );
  };
  return (
    <Modal title={`Release ${r.name}`} actions={[{ label: 'Cancel' }, { label: 'Release', kind: 'primary', onClick: go }]}>
      <label className="field">
        <span>Release date</span>
        <DateF value={date} onChange={setDate} />
      </label>
      {open.length > 0 ? (
        <>
          <p className="warn-text small">
            {open.length} issue{open.length === 1 ? ' isn’t' : 's aren’t'} done yet.
          </p>
          <label className="field">
            <span>Move unfinished issues to</span>
            <SF value={to} onChange={(e) => setTo(e.target.value)}>
              {others.map((x: Any) => (
                <MenuItem key={x.id} value={x.id}>
                  {x.name}
                </MenuItem>
              ))}
              <MenuItem value="">No version (remove them from {r.name})</MenuItem>
            </SF>
          </label>
        </>
      ) : (
        <p className="muted small">Every issue in this version is done.</p>
      )}
    </Modal>
  );
}

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
        { label: picked.size ? `Add ${picked.size}` : 'Add', kind: 'primary', disabled: !picked.size, onClick: add },
      ]}
    >
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <TF search autoFocus value={q} placeholder="Search issues by key or summary" onChange={(e) => setQ(e.target.value)} />
        <CB label="Include done" checked={showDone} onChange={(e: Any) => setShowDone(e.target.checked)} />
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
    return l.length ? `## ${title}\n${l.map((t: Any) => `- ${t.title} (${t.key})`).join('\n')}\n` : '';
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

function ReleaseDetail({ r, back }: { r: Any; back: () => void }) {
  const items = releaseIssues(r.id);
  const manage = canRelease();
  const edit = can('issue.edit') || manage;
  const open = items.filter((t: Any) => !isDone(t));
  const openPrs = items.flatMap((t: Any) =>
    (t.prs || []).filter((x: Any) => ['Open', 'Draft'].includes(x.status)).map((x: Any) => ({ t, x })),
  );
  const failing = items.flatMap((t: Any) => t.testCases.filter((tc: Any) => tc.status === 'Fail').map((tc: Any) => ({ t, tc })));
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
        {r.releaseDate ? `${r.status === 'released' ? 'Released' : 'Release'} ${fmtDate(r.releaseDate)}` : 'No release date'}
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
            {open.length ? 'Moved to another version (or out of this one) when you release.' : 'Everything in this version is done.'}
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
            {failing.length ? [...new Set(failing.map(({ t }: Any) => t.key))].slice(0, 6).join(', ') : 'No failing tests on these issues.'}
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
                saveBlob(new Blob([notes], { type: 'text/markdown' }), `${P().key}-${r.name.replace(/[^\w.-]+/g, '-')}-release-notes.md`)
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
          <p>Add issues here, or set the Fix version on an issue, from the row menu or the selection bar in the backlog.</p>
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

export function Releases() {
  useStore();
  const [sel, setSel] = useState<string | null>(null);
  const [show, setShow] = useState('unreleased');
  const manage = canRelease();
  const all = releases();
  const r = sel ? release(sel) : null;
  if (r) return <ReleaseDetail r={r} back={() => setSel(null)} />;
  const list = all
    .filter((x: Any) => show === 'all' || x.status === show)
    .sort(
      (a: Any, b: Any) =>
        (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999') || a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
  const n = (s: string) => all.filter((x: Any) => x.status === s).length;
  const setStatus = (x: Any, status: string) =>
    mutate((p) => {
      Object.assign(
        p.releases.find((y: Any) => y.id === x.id),
        { status, ...(status === 'unreleased' ? { releasedAt: null } : {}) },
      );
    });
  const del = (x: Any) => {
    const used = P().tickets.filter((t: Any) => (t.fixVersions || []).includes(x.id));
    openModal(
      <Confirm
        title={`Delete ${x.name}?`}
        label="Delete"
        text={
          used.length
            ? `${used.length} issue${used.length === 1 ? ' has' : 's have'} it as Fix version; it’s removed from them. Undo with ⌘Z.`
            : 'No issues use it. Undo with ⌘Z.'
        }
        onYes={() =>
          mutate((p) => {
            for (const t of used)
              setField(
                t,
                'fixVersions',
                t.fixVersions.filter((v: string) => v !== x.id),
              );
            p.releases = p.releases.filter((y: Any) => y.id !== x.id);
          })
        }
      />,
    );
  };
  return (
    <>
      <Header
        title="Releases"
        right={
          manage && (
            <button className="btn primary" onClick={() => openModal(<ReleaseModal />)}>
              <Ico svg={I.plus} />
              Create version
            </button>
          )
        }
      />
      <p className="muted" style={{ marginTop: -6 }}>
        Plan what ships together: give issues a Fix version, follow each version’s progress, release it and share the release notes.
      </p>
      <div className="tabbar rel-tabs" role="tablist">
        {[
          ['unreleased', 'Unreleased', n('unreleased')],
          ['released', 'Released', n('released')],
          ['archived', 'Archived', n('archived')],
          ['all', 'All', all.length],
        ].map(([k, l, c]) => (
          <button
            key={k as string}
            role="tab"
            aria-selected={show === k}
            className={`tab ${show === k ? 'active' : ''}`}
            onClick={() => setShow(k as string)}
          >
            {l} <span className="count">{c}</span>
          </button>
        ))}
      </div>
      {!all.length ? (
        <EmptyState
          icon={I.calendar}
          title="No versions yet"
          actions={
            manage && (
              <button className="btn primary" onClick={() => openModal(<ReleaseModal />)}>
                <Ico svg={I.plus} />
                Create version
              </button>
            )
          }
        >
          <p>
            Create a version (for example 1.0 or “Payroll Q4”), then add issues to it. Releasing it records what shipped and gives you
            release notes.
          </p>
        </EmptyState>
      ) : !list.length ? (
        <p className="muted">No {show} versions.</p>
      ) : (
        <div className="table-wrap">
          <table className="tbl rel-tbl">
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th style={{ width: '24%' }}>Progress</th>
                <th>Start</th>
                <th>Release</th>
                <th>Description</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((x: Any) => {
                const items = releaseIssues(x.id);
                return (
                  <tr key={x.id} className="click" onClick={() => setSel(x.id)}>
                    <td data-label="Version">
                      <b>{x.name}</b>
                    </td>
                    <td data-label="Status">
                      <RelLoz r={x} />
                    </td>
                    <td data-label="Progress">
                      <Progress items={items} />
                    </td>
                    <td data-label="Start" className="muted">
                      {x.startDate ? fmtDate(x.startDate) : '—'}
                    </td>
                    <td data-label="Release" className={overdue(x) ? 'danger-text' : 'muted'}>
                      {x.releaseDate ? fmtDate(x.releaseDate) : '—'}
                      {x.releasedAt ? <span className="small"> · {ago(x.releasedAt)}</span> : null}
                    </td>
                    <td data-label="Description" className="muted rel-desc">
                      {x.description || ''}
                    </td>
                    <td className="rel-acts" onClick={(e) => e.stopPropagation()}>
                      {manage && (
                        <>
                          {x.status === 'unreleased' && (
                            <button className="btn sm" onClick={() => openModal(<ReleaseNowModal r={x} />)}>
                              Release
                            </button>
                          )}
                          {x.status === 'released' && (
                            <button className="btn sm subtle" onClick={() => setStatus(x, 'archived')}>
                              Archive
                            </button>
                          )}
                          {x.status !== 'unreleased' && (
                            <button className="btn sm subtle" onClick={() => setStatus(x, 'unreleased')} title="Move back to unreleased">
                              Unrelease
                            </button>
                          )}
                          <button
                            className="icon-btn"
                            title="Edit"
                            aria-label={`Edit ${x.name}`}
                            onClick={() => openModal(<ReleaseModal r={x} />)}
                          >
                            <Ico svg={I.pencil} />
                          </button>
                          <button className="icon-btn" title="Delete" aria-label={`Delete ${x.name}`} onClick={() => del(x)}>
                            <Ico svg={I.trash} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
