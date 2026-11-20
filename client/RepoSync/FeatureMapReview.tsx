'use client';
import { useState } from 'react';
import {
  type Any,
  isDone,
  P,
  mutate,
  uid,
  nextEpicKey,
  COLORS,
  setField,
  logEvent,
  newTicket,
  closeModal,
  toast,
  S,
} from '../core';
import { Modal, Ico, I } from '../ui';
import { CB } from '../fields';
import { doneStatus } from './RepoSyncCard';
import { TypeIconEpic } from './TypeIconEpic';

// ---------------------------------------------------------------- built features, by epic
export function FeatureMapReview({ r }: { r: Any }) {
  const done = doneStatus();
  const key = (ei: number, fi: number) => `${ei}:${fi}`;
  const isDoneF = (f: Any) =>
    f.alreadyDone ||
    (f.existingKey && f.existingStatus === done) ||
    (f.existingId && isDone(P().tickets.find((t: Any) => t.id === f.existingId) || {}));
  const cur = (f: Any) => P().tickets.find((t: Any) => t.id === f.existingId);
  // Done, already in an epic and already sized: nothing to change.
  const settled = (f: Any) =>
    isDoneF(f) &&
    (f.existingEpicId || cur(f)?.epicId) &&
    (cur(f)?.storyPoints != null || !f.storyPoints);
  const [pick, setPick] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      r.epics.flatMap((e: Any, ei: number) =>
        e.features.map((f: Any, fi: number) => [key(ei, fi), !settled(f)]),
      ),
    ),
  );
  const [open, setOpen] = useState<string | null>(null);
  const [closed, setClosed] = useState<Record<number, boolean>>({});
  const all = r.epics.flatMap((e: Any) => e.features);
  const chosen = Object.values(pick).filter(Boolean).length;
  const setEpic = (ei: number, v: boolean) =>
    setPick({
      ...pick,
      ...Object.fromEntries(
        r.epics[ei].features.map((f: Any, fi: number) => [key(ei, fi), v && !settled(f)]),
      ),
    });
  const apply = () => {
    let newEpics = 0,
      created = 0,
      marked = 0,
      moved = 0,
      sized = 0;
    mutate((pp: Any) => {
      r.epics.forEach((e: Any, ei: number) => {
        const feats = e.features.filter((f: Any, fi: number) => pick[key(ei, fi)] && !settled(f));
        if (!feats.length) return;
        let epicId = e.epicId;
        if (!epicId) {
          const ne = {
            id: uid(),
            key: nextEpicKey(),
            title: e.title,
            description: e.description || '',
            color: COLORS[pp.epics.length % COLORS.length],
          };
          pp.epics.push(ne);
          epicId = ne.id;
          newEpics++;
        }
        for (const f of feats) {
          if (f.existingId) {
            const t = pp.tickets.find((x: Any) => x.id === f.existingId);
            if (!t) continue;
            if (!t.epicId) {
              setField(t, 'epicId', epicId, 'Repository sync');
              moved++;
            }
            if (t.storyPoints == null && f.storyPoints) {
              setField(t, 'storyPoints', f.storyPoints, 'Repository sync');
              sized++;
            } // size issues that had none
            if (!isDoneF(f)) {
              setField(t, 'status', done, 'Repository sync');
              logEvent(
                t,
                `marked ${done}: already built (${f.sources.slice(0, 3).join(', ') || 'found in the code'})`,
                'Repository sync',
              );
              marked++;
            }
          } else {
            const t = newTicket({
              title: f.title,
              type: f.type,
              epicId,
              userStory: f.userStory,
              acceptanceCriteria: f.acceptanceCriteria,
              status: done,
              labels: ['delivered'],
              storyPoints: f.storyPoints ?? null,
              description: [
                f.description,
                f.pages.length && `Pages: ${f.pages.join(', ')}`,
                f.sources.length && `Sources: ${f.sources.join(', ')}`,
              ]
                .filter(Boolean)
                .join('\n\n'),
            });
            logEvent(t, 'added from the repository: already built', 'Repository sync');
            pp.tickets.push(t);
            created++;
          }
        }
      });
    });
    closeModal();
    toast(
      [
        `${created} small ticket${created === 1 ? '' : 's'} added as ${done}`,
        marked && `${marked} existing issue${marked > 1 ? 's' : ''} marked ${done}`,
        moved && `${moved} existing issue${moved > 1 ? 's' : ''} moved into their epic`,
        sized && `${sized} sized`,
        newEpics && `${newEpics} new epic${newEpics > 1 ? 's' : ''}`,
      ]
        .filter(Boolean)
        .join(' · ') + '.',
      'ok',
      {
        title: 'Backlog organized',
        action: { label: 'Open Epics', onClick: () => S.nav(`/p/${P().id}/epics`) },
      },
    );
  };
  return (
    <Modal
      title="Built features, by epic"
      wide
      persistent
      actions={[
        { label: 'Cancel' },
        {
          label: (() => {
            const sel = r.epics.flatMap((e: Any, ei: number) =>
              e.features.filter((_: Any, fi: number) => pick[key(ei, fi)]),
            );
            const nNew = sel.filter((f: Any) => !f.existingId).length;
            return nNew === sel.length
              ? `Add ${nNew} ticket${nNew === 1 ? '' : 's'}`
              : nNew
                ? `Add ${nNew}, update ${sel.length - nNew}`
                : `Apply ${sel.length} change${sel.length === 1 ? '' : 's'}`;
          })(),
          kind: 'primary',
          disabled: !chosen,
          onClick: apply,
        },
      ]}
    >
      <div className="sync-sum">
        <span>
          <Ico svg={I.pr} /> <b>{r.repo.branch}</b> at{' '}
          <code>{String(r.repo.head).slice(0, 7)}</code>
        </span>
        <span>
          {r.code ? (
            <>
              From the code: {r.code.pages} pages, {r.code.endpoints} endpoints, {r.code.models}{' '}
              data models
              {r.code.backend ? ' (with the backend)' : ''}
            </>
          ) : (
            <>Read {r.pages} pages</>
          )}{' '}
          · hints from {r.docs.length} .md file{r.docs.length === 1 ? '' : 's'} and {r.commits}{' '}
          commits
        </span>
        <span>
          {all.length} small tickets · {new Set(all.map((f: Any) => f.group || f.title)).size}{' '}
          features · {r.epics.length} epics ({r.epics.filter((e: Any) => e.isNew).length} new)
        </span>
      </div>
      <div className="sync-pane">
        {r.epics.map((e: Any, ei: number) => {
          const n = e.features.filter((f: Any, fi: number) => pick[key(ei, fi)]).length;
          const selectable = e.features.filter((f: Any) => !settled(f)).length;
          return (
            <div key={ei} className="pt-page fm-epic">
              <div className="pt-head">
                <CB
                  checked={n > 0 && n === selectable}
                  indeterminate={n > 0 && n < selectable}
                  disabled={!selectable}
                  onChange={(ev: Any) => setEpic(ei, ev.target.checked)}
                  aria-label={`All features of ${e.title}`}
                />
                <button
                  type="button"
                  className={`as-h ${closed[ei] ? 'closed' : ''}`}
                  style={{ flex: 1, width: 'auto' }}
                  onClick={() => setClosed({ ...closed, [ei]: !closed[ei] })}
                >
                  <Ico svg={I.chevron} />
                  <TypeIconEpic />
                  {e.epicKey && <span className="key">{e.epicKey}</span>}
                  <b>{e.title}</b>
                  <span className={`pg-badge ${e.isNew ? 'dyn' : ''}`}>
                    {e.isNew ? 'New epic' : 'Existing epic'}
                  </span>
                </button>
                <span className="muted small fm-sum">
                  {new Set(e.features.map((f: Any) => f.group || f.title)).size} features ·{' '}
                  {e.features.length} tickets ·{' '}
                  {e.features.reduce((x: number, f: Any) => x + (f.storyPoints || 0), 0)} pts · {n}{' '}
                  selected
                </span>
              </div>
              {e.description && !closed[ei] && (
                <p className="muted small fm-desc">{e.description}</p>
              )}
              {e.error && (
                <p className="warn-text small fm-desc">Couldn’t write the details: {e.error}</p>
              )}
              {!closed[ei] &&
                e.features.map((f: Any, fi: number) => {
                  const k = key(ei, fi);
                  const g = f.group || f.title;
                  const size = e.features.filter((x: Any) => (x.group || x.title) === g).length;
                  const head =
                    size > 1 &&
                    g !== (fi > 0 ? e.features[fi - 1].group || e.features[fi - 1].title : null);
                  return (
                    <div key={k}>
                      {head && (
                        <div className="fm-group small">
                          <Ico svg={I.chevron} /> {g}
                          <span className="muted"> · split into {size} tickets</span>
                        </div>
                      )}
                      <div
                        className={`sync-item pt-tc fm-ticket ${size > 1 ? 'in-group' : ''} ${pick[k] ? '' : 'off'}`}
                      >
                        <CB
                          checked={Boolean(pick[k])}
                          disabled={settled(f)}
                          onChange={() => setPick({ ...pick, [k]: !pick[k] })}
                          aria-label="Include"
                        />
                        <div className="sync-body">
                          <div>
                            <span className="sp" title="Story points">
                              {f.storyPoints ?? '–'}
                            </span>{' '}
                            <b>{f.title}</b>{' '}
                            {settled(f) ? (
                              <span className="pg-badge">
                                {f.existingKey} · already {f.existingStatus}
                              </span>
                            ) : isDoneF(f) ? (
                              <span className="pg-badge dyn">
                                {f.existingKey} ·{' '}
                                {[
                                  !(f.existingEpicId || cur(f)?.epicId) && 'move into this epic',
                                  cur(f)?.storyPoints == null &&
                                    f.storyPoints &&
                                    `size ${f.storyPoints} pts`,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            ) : f.existingKey ? (
                              <span className="pg-badge dyn">
                                {f.existingKey}: {f.existingStatus} → {done}
                              </span>
                            ) : (
                              <span className="pg-badge">New · {done}</span>
                            )}
                          </div>
                          {!f.existingKey && (
                            <button
                              className="link-btn small"
                              onClick={() => setOpen(open === k ? null : k)}
                            >
                              {open === k
                                ? 'Hide details'
                                : `${f.acceptanceCriteria.length} acceptance criteria`}
                            </button>
                          )}
                          {open === k && (
                            <div className="pt-steps small">
                              {f.userStory && (
                                <p>
                                  <i>{f.userStory}</i>
                                </p>
                              )}
                              {f.description && <p>{f.description}</p>}
                              <ol>
                                {f.acceptanceCriteria.map((a: string, i: number) => (
                                  <li key={i}>{a}</li>
                                ))}
                              </ol>
                              {(f.pages.length > 0 || f.sources.length > 0) && (
                                <p className="muted">
                                  {[
                                    f.pages.length && `Pages: ${f.pages.join(', ')}`,
                                    f.sources.length && `Code and hints: ${f.sources.join(', ')}`,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          );
        })}
        {!r.epics.length && <p className="muted small">Nothing built was found in the code.</p>}
        {r.unverified?.length > 0 && (
          <details className="fm-unverified">
            <summary className="small">
              <b>{r.unverified.length} not found in the code</b>{' '}
              <span className="muted">· mentioned only in documents or history, so not added</span>
            </summary>
            <ul className="small">
              {r.unverified.map((u: Any, i: number) => (
                <li key={i}>
                  <b>{u.title}</b>
                  {u.source && <span className="muted"> · {u.source}</span>}
                  <div className="muted">{u.why}</div>
                </li>
              ))}
            </ul>
            <p className="muted small" style={{ margin: 0 }}>
              If one is really built, it may live in a repository TicketForge doesn’t read: set the
              backend repository in Project settings → Code & GitHub, then run this again.
            </p>
          </details>
        )}
      </div>
    </Modal>
  );
}
