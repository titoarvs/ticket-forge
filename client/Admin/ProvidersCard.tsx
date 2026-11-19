'use client';
import { useState } from 'react';
import { type Any, toast, openModal } from '../core';
import { Confirm, Ico, I, Spinner, EmptyState } from '../ui';
import { patchAiSettings, aiAction, getAiSettings, removeAiEntry } from '../api/admin';
import { CB } from '../fields';
import { applyAi, ProviderModal, join, MISSING, TestResult } from './ProviderModal';

/**
 * The AI APIs in priority order, with their health and the controls to reorder, switch and test
 * them.
 */
export function ProvidersCard({ c }: { c: Any }) {
  const [busy, setBusy] = useState('');
  const [tests, setTests] = useState<Record<string, Any>>({});
  const list: Any[] = c.apis || [];
  const panel = list.filter((x) => x.source === 'panel');
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const patch = (b: Any) => patchAiSettings(b).then(applyAi);
  const move = (id: string, to: number) =>
    run(`move:${id}`, async () => {
      const ids = panel.map((x) => x.entryId).filter((x) => x !== id);
      ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id);
      await patch({ order: ids });
    });
  const test = (x: Any) =>
    run(`test:${x.entryId}`, async () => {
      const r = await aiAction({ action: 'test', id: x.entryId });
      setTests((t) => ({ ...t, [x.entryId]: r }));
      applyAi(await getAiSettings());
    });
  const reset = (id?: string) =>
    run(`reset:${id || 'all'}`, async () => applyAi(await aiAction({ action: 'reset', id })));
  const remove = (x: Any) =>
    openModal(
      <Confirm
        title={`Remove ${x.label}?`}
        label="Remove"
        text={
          <>
            {x.label}
            {x.model ? ` (${x.model})` : ''} and its saved API key are deleted.{' '}
            {list.length > 1 ? 'TicketForge keeps using the other providers.' : ''}
          </>
        }
        onYes={() =>
          run(`remove:${x.entryId}`, async () => {
            applyAi(await removeAiEntry(x.entryId));
            toast(`${x.label} removed`);
          })
        }
      />,
    );
  const chip = (x: Any) => {
    if (!x.enabled) return <span className="loz">Off</span>;
    if (!x.configured)
      return (
        <span className="loz t-fail" title={x.error || ''}>
          Incomplete
        </span>
      );
    if (x.cooldown)
      return (
        <span className="loz t-blocked" title={x.cooldown.message}>
          {x.cooldown.kind === 'credits'
            ? 'Out of credits'
            : x.cooldown.kind === 'auth'
              ? 'Key rejected'
              : 'Limited'}{' '}
          · retry{' '}
          {new Date(x.cooldown.until).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </span>
      );
    if (x.active) return <span className="loz t-pass">In use</span>;
    return <span className="loz">Backup</span>;
  };
  const anyCooling = list.some((x) => x.cooldown) || c.account?.cooldown;
  return (
    <div className="card wide">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>AI providers</h3>
          <p className="sub" style={{ marginBottom: 12 }}>
            TicketForge uses the first provider that’s available. When one hits a rate limit, runs
            out of credits or fails, it switches to the next one automatically and tries the first
            again later. Keys are stored encrypted and never shown again.
          </p>
        </div>
        <button className="btn primary" onClick={() => openModal(<ProviderModal c={c} />)}>
          <Ico svg={I.plus} />
          Add provider
        </button>
      </div>

      {list.length ? (
        <div className="prov-list">
          {list.map((x, i) => {
            const isPanel = x.source === 'panel';
            const pi = panel.findIndex((y) => y.entryId === x.entryId);
            const t = tests[x.entryId];
            return (
              <div
                key={x.entryId}
                className={`prov ${x.active ? 'active' : ''} ${x.enabled ? '' : 'off'}`}
              >
                <div className="prov-main">
                  <span className="prov-n" title="Priority">
                    {i + 1}
                  </span>
                  <div className="prov-info">
                    <div className="row" style={{ gap: 8 }}>
                      <b>{x.label}</b>
                      {x.model && <code>{x.model}</code>}
                      {chip(x)}
                    </div>
                    <div className="muted small">
                      {isPanel ? 'Set up in this panel' : 'From environment variables'}
                      {x.kind === 'openai' && x.baseUrl ? ` · ${x.baseUrl}` : ''}
                      {isPanel &&
                        (c.settings?.providers?.find((y: Any) => y.id === x.entryId)?.keyHint
                          ? ` · key ends with ${c.settings.providers.find((y: Any) => y.id === x.entryId).keyHint}`
                          : x.keySet
                            ? ''
                            : ' · no key')}
                      {!x.configured && x.missing?.length
                        ? ` · missing ${join(x.missing.map((m: string) => MISSING[m]))}`
                        : ''}
                      {x.cooldown && <> · {x.cooldown.reason}</>}
                    </div>
                  </div>
                  <div className="prov-actions">
                    {x.cooldown && (
                      <button
                        className="btn sm"
                        disabled={!!busy}
                        onClick={() => reset(x.entryId)}
                        title="Clear the cooldown and use it again now"
                      >
                        Retry now
                      </button>
                    )}
                    <button
                      className="btn sm subtle"
                      disabled={!!busy || !x.configured}
                      onClick={() => test(x)}
                    >
                      {busy === `test:${x.entryId}` ? (
                        <>
                          <Spinner />
                          Testing
                        </>
                      ) : (
                        'Test'
                      )}
                    </button>
                    {isPanel && (
                      <>
                        {pi > 0 && (
                          <button
                            className="btn sm subtle"
                            disabled={!!busy}
                            onClick={() => move(x.entryId, 0)}
                            title="Make this the provider TicketForge tries first"
                          >
                            Use first
                          </button>
                        )}
                        <button
                          className="icon-btn"
                          disabled={!!busy || pi <= 0}
                          onClick={() => move(x.entryId, pi - 1)}
                          aria-label="Move up"
                          title="Move up"
                        >
                          <Ico svg={I.up} />
                        </button>
                        <button
                          className="icon-btn"
                          disabled={!!busy || pi >= panel.length - 1}
                          onClick={() => move(x.entryId, pi + 1)}
                          aria-label="Move down"
                          title="Move down"
                        >
                          <Ico svg={I.down} />
                        </button>
                        <label className="check small" title={x.enabled ? 'Turn off' : 'Turn on'}>
                          <CB
                            checked={x.enabled}
                            disabled={!!busy}
                            onChange={(e: Any) =>
                              run(`toggle:${x.entryId}`, () =>
                                patch({ id: x.entryId, enabled: e.target.checked }),
                              )
                            }
                          />
                          On
                        </label>
                        <button
                          className="btn sm subtle"
                          disabled={!!busy}
                          onClick={() => openModal(<ProviderModal c={c} entry={x} />)}
                        >
                          Edit
                        </button>
                        <button
                          className="icon-btn"
                          disabled={!!busy}
                          onClick={() => remove(x)}
                          aria-label={`Remove ${x.label}`}
                          title="Remove"
                        >
                          <Ico svg={I.trash} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {t && (
                  <div style={{ margin: '8px 0 0 36px' }}>
                    <TestResult t={t} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          compact
          icon={I.sparkle}
          title="No AI providers yet"
          actions={
            <button className="btn primary" onClick={() => openModal(<ProviderModal c={c} />)}>
              <Ico svg={I.plus} />
              Add provider
            </button>
          }
        >
          <p>
            Add one or more AI APIs. With two or more, TicketForge switches automatically when one
            is limited.
          </p>
        </EmptyState>
      )}

      <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
        <label className="check small" style={{ maxWidth: 620 }}>
          <CB
            checked={c.accountFallback !== false}
            disabled={!!busy}
            onChange={(e: Any) =>
              run('fallback', () => patch({ accountFallback: e.target.checked }))
            }
          />
          On your own computer, use these providers when the local AI can’t: not installed, not
          signed in, sign-in expired, or usage limit reached
        </label>
        {anyCooling && (
          <button className="btn sm subtle" disabled={!!busy} onClick={() => reset()}>
            Clear all cooldowns
          </button>
        )}
      </div>
    </div>
  );
}
