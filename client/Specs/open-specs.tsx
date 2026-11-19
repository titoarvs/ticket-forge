'use client';
import { useState, useCallback, useEffect } from 'react';
import { type Any, openModal, P, toast, mutate, S, can } from '../core';
import { listSpecs, listPeople, generateSpecs, markSpecsReady } from '../api/specs';
import { Loading, Sk, ErrorState, Ico, I, EmptyState, Spinner, Modal } from '../ui';
import { SF, MenuItem, CB } from '../fields';
import { SpecRow } from './SpecRow';

/** Opens the Coding specs dialog of an epic. */
export const openSpecs = (epic: Any) => openModal(<SpecsModal epic={epic} />);
/** "PR-2 and PR-3 both touch lib/store.ts": the tickets and the file or module they share. */
export function OverlapLine({ o }: { o: Any }) {
  const keys: string[] = o.specs.map((s: Any) => s.key || s.ticketId);
  const who =
    keys.length === 2
      ? `${keys[0]} and ${keys[1]} both`
      : `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]} all`;
  return (
    <li>
      {who} touch <code>{o.target}</code> ({o.kind}
      {o.crossEpic ? ', in different epics' : ''})
    </li>
  );
}
function SpecsModal({ epic }: { epic: Any }) {
  const pid = P()?.id;
  const [state, setState] = useState<{ loading: boolean; error: Any; data: Any }>({
    loading: true,
    error: null,
    data: null,
  });
  const [busy, setBusy] = useState('');
  const [people, setPeople] = useState<Any[]>([]);
  const [cfg, setCfg] = useState<Any>({ overlapMode: 'block', reviewers: [] });
  const tickets = P().tickets.filter((t: Any) => t.epicId === epic.id && !t.parentId);

  const load = useCallback(async () => {
    try {
      const d = await listSpecs(pid, epic.id);
      setState({ loading: false, error: null, data: d });
      setCfg(d.config);
    } catch (e: Any) {
      setState((s) => ({ ...s, loading: false, error: e }));
    }
  }, [pid, epic.id]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    listPeople(pid)
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [pid]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e: Any) {
      toast(e.message, 'err');
      await load();
    } finally {
      setBusy('');
    }
  };
  const generate = () =>
    run('generate', async () => {
      const d = await generateSpecs(pid, epic.id);
      setState({ loading: false, error: null, data: d });
      toast(
        `${d.specs.length} coding spec${d.specs.length === 1 ? '' : 's'} generated for ${epic.title}.`,
      );
    });
  const ready = (ids: string[]) =>
    run('ready', async () => {
      const r = await markSpecsReady(pid, ids);
      if (r.warnings?.length)
        toast(
          `Marked ready with ${r.warnings.length} overlap${r.warnings.length === 1 ? '' : 's'}: ${r.warnings.map((o: Any) => `${o.specs.map((s: Any) => s.key).join(' + ')} on ${o.target}`).join('; ')}`,
          'warn',
        );
      else
        toast(
          ids.length === 1
            ? 'Spec marked ready for coding.'
            : `${ids.length} specs marked ready for coding.`,
        );
      await load();
    });
  // Settings are a project section saved like the other project settings (Project settings
  // permission).
  const saveCfg = (next: Any) => {
    setCfg(next);
    mutate(
      (pp: Any) => {
        pp.specConfig = next;
      },
      { tag: 'specConfig' },
    );
  };

  const d = state.data;
  const specs: Any[] = d?.specs || [];
  const drafts = specs.filter((s) => s.status !== 'ready');
  const canEdit = Boolean(d?.canEdit);
  const body = state.loading ? (
    <Loading label="Loading coding specs…">
      <Sk w="60%" />
      <Sk w="40%" h={10} style={{ marginTop: 8 }} />
    </Loading>
  ) : state.error ? (
    <ErrorState compact title="Couldn’t load the coding specs" error={state.error} onRetry={load} />
  ) : (
    <>
      {d.overlaps.length > 0 && (
        <div className="warn-banner danger" role="alert">
          <Ico svg={I.warn} />
          <div>
            <b>
              {d.overlaps.length} overlap{d.overlaps.length === 1 ? '' : 's'} between specs
            </b>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {d.overlaps.map((o: Any) => (
                <OverlapLine key={`${o.kind}:${o.target}`} o={o} />
              ))}
            </ul>
            <div className="small" style={{ marginTop: 4 }}>
              {cfg.overlapMode === 'block'
                ? 'Specs with an overlap can’t be marked ready until it is resolved.'
                : 'You can still mark these specs ready: you will be warned.'}
            </div>
          </div>
        </div>
      )}
      {!specs.length ? (
        <EmptyState compact icon={I.doc} tone="neutral" title="No coding specs yet">
          <p>
            {tickets.length
              ? `Generate one coding prompt for each of the ${tickets.length} issue${tickets.length === 1 ? '' : 's'} in ${epic.title}.`
              : `${epic.title} has no issues yet.`}
          </p>
        </EmptyState>
      ) : (
        <>
          <div className="row" style={{ justifyContent: 'space-between', margin: '8px 0' }}>
            <span className="muted small">
              {specs.length} spec{specs.length === 1 ? '' : 's'} · {specs.length - drafts.length}{' '}
              ready
            </span>
            {canEdit && (
              <button
                className="btn sm"
                disabled={!drafts.length || !!busy}
                onClick={() => ready(drafts.map((s) => s.ticketId))}
              >
                {busy === 'ready' && <Spinner />}Mark all ready
              </button>
            )}
          </div>
          <ol className="ver-list" aria-label={`Coding specs of ${epic.title}`}>
            {specs.map((s) => (
              <SpecRow
                key={s.ticketId}
                s={s}
                canEdit={canEdit}
                isReviewer={Boolean(S.user?.id && cfg.reviewers.includes(S.user.id))}
                busy={!!busy}
                onReady={() => ready([s.ticketId])}
                reload={load}
              />
            ))}
          </ol>
        </>
      )}
      {can('project.settings') && (
        <details style={{ marginTop: 12 }}>
          <summary className="small">Settings: overlaps and required reviewers</summary>
          <label className="field">
            <span>When specs overlap</span>
            <SF
              value={cfg.overlapMode}
              onChange={(e: Any) => saveCfg({ ...cfg, overlapMode: e.target.value })}
            >
              <MenuItem value="block">Block: don’t allow marking them ready</MenuItem>
              <MenuItem value="warn">Warn: mark them ready and show the overlap</MenuItem>
            </SF>
          </label>
          <div className="field">
            <span>
              Required reviewers (one must approve before AI-produced changes are accepted)
            </span>
            {people.map((u) => (
              <CB
                key={u.id}
                size="small"
                label={`${u.name} (${u.role})`}
                checked={cfg.reviewers.includes(u.id)}
                onChange={(ev: Any) =>
                  saveCfg({
                    ...cfg,
                    reviewers: ev.target.checked
                      ? [...cfg.reviewers, u.id]
                      : cfg.reviewers.filter((x: string) => x !== u.id),
                  })
                }
              />
            ))}
            {!people.length && <span className="muted small">No people found.</span>}
          </div>
        </details>
      )}
    </>
  );
  return (
    <Modal
      wide
      title={`Coding specs · ${epic.title}`}
      actions={[
        { label: 'Close' },
        {
          label: specs.length ? 'Generate again' : 'Generate coding specs',
          kind: 'primary',
          hidden: !d?.canGenerate,
          busy: busy === 'generate',
          disabled: !!busy || !tickets.length,
          onClick: generate,
        },
      ]}
    >
      {body}
    </Modal>
  );
}
