'use client';
// Administration → AI → Model routing: which model each kind of AI work uses. Tasks get a tier (High, Standard, Light);
// each tier maps to a model on every AI (Claude account, GitHub Copilot, each AI API). Cheap, routine work (epic
// outlines, questions, failure notes) runs on lighter models, saving usage and credits for the work that needs the best.
import { useState } from 'react';
import { api, toast, openModal, type Any } from './core';
import { Ico, I, Spinner, Confirm } from './ui';
import { CB, SF, MenuItem, PeopleF } from './fields';
import { UsageReport } from './AiUsage';

const TIER_LABEL: Record<string, string> = { high: 'High', standard: 'Standard', light: 'Light' };
const TIER_HINT: Record<string, string> = {
  high: 'Best quality, most usage',
  standard: 'Good quality, moderate usage',
  light: 'Fast and cheap',
};
const CLAUDE_OPTIONS = ['opus', 'sonnet', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'];

/** One-click starting points. */
const PRESETS: { key: string; label: string; desc: string; tiers: (t: Any) => string; escalate?: boolean }[] = [
  { key: 'quality', label: 'Best quality', desc: 'Every task on the High tier. Uses the most.', tiers: () => 'high' },
  {
    key: 'balanced',
    label: 'Balanced',
    desc: 'The defaults: High for tickets, documents and scripts; lighter models for routine work.',
    tiers: (t) => t.tier,
  },
  {
    key: 'smart',
    label: 'Smart savings',
    desc: 'Documents and scripts on Standard; tickets and tests try Standard first and step up to High only when needed; coding and review stay High.',
    tiers: (t) => (['automation'].includes(t.id) ? 'standard' : t.tier),
    escalate: true,
  },
  {
    key: 'economy',
    label: 'Economy',
    desc: 'Light for most work; Standard for tickets, documents, scripts and coding agents.',
    tiers: (t) => (['tickets', 'docs', 'automation', 'code', 'agent-tests', 'review'].includes(t.id) ? 'standard' : 'light'),
  },
];

type Part = 'routing' | 'models' | 'usage' | 'savings';
/**
 * One part of the AI page's model routing settings (they share one draft and one Save bar):
 * routing (presets, tier per task) · models (the model behind each tier) · usage (report and suggestions) ·
 * savings (reused answers, try Standard first, budget, prices).
 */
export function RoutingSection({
  c,
  onSaved,
  part = 'routing',
  go,
}: {
  c: Any;
  onSaved: (st: Any) => void;
  part?: Part;
  go?: (k: string) => void;
}) {
  const saved = c.settings?.routing;
  const [r, setR] = useState<Any>(() => structuredClone(saved));
  const [busy, setBusy] = useState('');
  if (!saved || !r) return null;
  const tasks: Any[] = c.tasks || [];
  const tiers: string[] = c.tiers || ['high', 'standard', 'light'];
  const dirty = JSON.stringify(r) !== JSON.stringify(saved);
  const preset = PRESETS.find((p) => tasks.every((t) => r.tiers[t.id] === p.tiers(t)) && (!p.escalate || r.escalate))?.key;
  const setTier = (id: string, v: string) => setR((x: Any) => ({ ...x, tiers: { ...x.tiers, [id]: v } }));
  const setModel = (ai: string, tier: string, v: string, entry?: string) =>
    setR((x: Any) => {
      const n = structuredClone(x);
      if (entry) {
        n.api[entry] = { high: '', standard: '', light: '', ...(n.api[entry] || {}), [tier]: v };
      } else n[ai][tier] = v;
      return n;
    });
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const patch = (routing: Any) => api('/api/admin/ai', { method: 'PATCH', body: { routing } });
  const save = () =>
    run('save', async () => {
      const st = await patch(r);
      onSaved(st);
      setR(structuredClone(st.settings.routing));
      toast('Model routing saved. New AI work uses it right away.');
    });
  const reset = () =>
    openModal(
      <Confirm
        title="Reset model routing?"
        label="Reset"
        text="Every task goes back to its default tier, and every tier to its default model."
        onYes={() =>
          run('reset', async () => {
            const st = await patch(null);
            onSaved(st);
            setR(structuredClone(st.settings.routing));
            toast('Model routing reset to the defaults');
          })
        }
      />,
    );
  // One-click changes from the usage report (suggestions, budget, prices): saved at once, on top of what's saved.
  const apply = async (change: Any, msg: string) => {
    const st = await patch({ ...saved, ...change });
    onSaved(st);
    setR((x: Any) => ({ ...x, ...change }));
    toast(msg);
  };

  // The AIs a tier maps to: your Claude account and Copilot on this computer, then each AI API.
  const apis: Any[] = (c.apis || []).filter((x: Any) => x.entryId);
  const modelFor = (tier: string, agent = false) => {
    if (agent) return r.claude[tier] || c.claudeTiers?.[tier];
    if (c.mode === 'account') {
      if (c.localEngine === 'copilot') return r.copilot[tier] || c.copilotModel || 'Copilot default';
      return r.claude[tier] || c.claudeTiers?.[tier];
    }
    const a = apis.find((x) => x.active) || apis[0];
    return a ? r.api[a.entryId]?.[tier] || a.model : '';
  };
  const off = !r.enabled;
  let lastGroup = '';

  return (
    <div className="cards">
      {part === 'routing' && (
        <div className="card wide">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3>Model routing</h3>
              <p className="sub" style={{ marginBottom: 10 }}>
                Each kind of AI work uses a tier: <b>High</b> for work that needs the best model, <b>Standard</b> for everyday work and{' '}
                <b>Light</b> for small, frequent jobs. Lighter tiers answer faster and use less of your Claude plan or API credits.
              </p>
            </div>
          </div>
          <CB
            label={
              <>
                <b>Use a model per task</b>{' '}
                <span className="muted">— off: everything uses the main model (or the model each person picks on this computer)</span>
              </>
            }
            checked={r.enabled}
            onChange={(e: Any) => setR({ ...r, enabled: e.target.checked })}
          />
          <div className={off ? 'rt-off' : ''}>
            <div className="rt-presets" role="radiogroup" aria-label="Preset">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="radio"
                  aria-checked={preset === p.key}
                  className={preset === p.key ? 'on' : ''}
                  disabled={off}
                  onClick={() =>
                    setR({ ...r, tiers: Object.fromEntries(tasks.map((t) => [t.id, p.tiers(t)])), escalate: Boolean(p.escalate) })
                  }
                >
                  <b>{p.label}</b>
                  <span className="muted small">{p.desc}</span>
                </button>
              ))}
            </div>
            <div className="rt-scroll">
              <table className="rt-tbl">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th className="rt-desc">What it covers</th>
                    <th>Tier</th>
                    <th>Model now</th>
                    <th>Used</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => {
                    const g = t.group !== lastGroup ? t.group : '';
                    lastGroup = t.group;
                    const u = c.usage?.tasks?.[t.id];
                    return [
                      g && (
                        <tr key={`g-${g}`} className="rt-group">
                          <td colSpan={5}>{g}</td>
                        </tr>
                      ),
                      <tr key={t.id}>
                        <td>
                          <b>{t.label}</b>
                          {r.tiers[t.id] !== t.tier && <div className="muted small">default {TIER_LABEL[t.tier]}</div>}
                        </td>
                        <td className="rt-desc muted small">
                          {t.desc}
                          {t.agent && <div>Runs in Claude Code. A model picked on the agent in Agents wins.</div>}
                        </td>
                        <td>
                          <div className="rt-tier" role="radiogroup" aria-label={`${t.label} tier`}>
                            {tiers.map((k) => (
                              <button
                                key={k}
                                type="button"
                                role="radio"
                                aria-checked={r.tiers[t.id] === k}
                                title={TIER_HINT[k]}
                                disabled={off}
                                className={`${r.tiers[t.id] === k ? 'on' : ''} t-${k}`}
                                onClick={() => setTier(t.id, k)}
                              >
                                {TIER_LABEL[k]}
                              </button>
                            ))}
                          </div>
                          {(c.settings?.configs || []).length > 0 && (
                            <select
                              className="rt-cfg"
                              aria-label={`${t.label}: custom configuration`}
                              disabled={off}
                              value={String(r.tiers[t.id]).startsWith('cfg:') ? r.tiers[t.id] : ''}
                              onChange={(e) => setTier(t.id, e.target.value || t.tier)}
                            >
                              <option value="">or a configuration…</option>
                              {c.settings.configs.map((x: Any) => (
                                <option key={x.id} value={`cfg:${x.id}`}>
                                  {x.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td>
                          <code className="rt-model">
                            {off
                              ? '—'
                              : String(r.tiers[t.id]).startsWith('cfg:')
                                ? (c.settings?.configs || []).find((x: Any) => `cfg:${x.id}` === r.tiers[t.id])?.name || '—'
                                : modelFor(r.tiers[t.id], t.agent) || '—'}
                          </code>
                        </td>
                        <td
                          className="rt-use"
                          title={
                            u
                              ? Object.entries(u.models)
                                  .map(([m, n]) => `${m}: ${n}`)
                                  .join('\n')
                              : ''
                          }
                        >
                          {u ? `${u.calls} call${u.calls === 1 ? '' : 's'}` : '—'}
                        </td>
                      </tr>,
                    ];
                  })}
                </tbody>
              </table>
            </div>
            <CB
              label="Light tasks never use extended thinking (fastest and cheapest)"
              checked={r.lightFast}
              disabled={off}
              onChange={(e: Any) => setR({ ...r, lightFast: e.target.checked })}
            />
            {go && (
              <p className="muted small rt-next">
                Which model a tier means on each AI:{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    go('models');
                  }}
                >
                  Models per tier
                </a>
                . How much each task uses:{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    go('usage');
                  }}
                >
                  Usage & suggestions
                </a>
                .
              </p>
            )}
          </div>
        </div>
      )}

      {part === 'models' && (
        <div className={`card wide ${off ? 'rt-off' : ''}`}>
          <h3>Models for each tier</h3>
          <p className="sub">Which model each AI uses for a tier. A blank API field uses that provider’s own model.</p>
          <div className="rt-scroll rt-models">
            <table className="rt-tbl">
              <thead>
                <tr>
                  <th>AI</th>
                  {tiers.map((k) => (
                    <th key={k}>{TIER_LABEL[k]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.mode === 'account' && (
                  <tr>
                    <td className="rt-ai">
                      <b>Claude account</b>
                      <span>Claude Code on this computer</span>
                    </td>
                    {tiers.map((k) => (
                      <td key={k}>
                        <PeopleF
                          avatars={false}
                          disabled={off}
                          value={r.claude[k]}
                          onChange={(v) => setModel('claude', k, v.trim())}
                          options={CLAUDE_OPTIONS}
                          placeholder={c.claudeTiers?.[k]}
                        />
                      </td>
                    ))}
                  </tr>
                )}
                {c.copilot?.available && (
                  <tr>
                    <td className="rt-ai">
                      <b>GitHub Copilot</b>
                      <span>{c.localEngine === 'copilot' ? 'Your local AI' : 'Backup for your Claude account'}</span>
                    </td>
                    {tiers.map((k) => (
                      <td key={k}>
                        <SF value={r.copilot[k]} disabled={off} onChange={(e) => setModel('copilot', k, e.target.value)}>
                          {(c.copilot.models || ['']).map((m: string) => (
                            <MenuItem key={m || 'd'} value={m}>
                              {m || `Same as Local AI (${c.copilotModel || 'default'})`}
                            </MenuItem>
                          ))}
                        </SF>
                      </td>
                    ))}
                  </tr>
                )}
                {apis.map((x) => {
                  const hint = c.tierHints?.[x.id] || {};
                  return (
                    <tr key={x.entryId}>
                      <td className="rt-ai">
                        <b>{x.label}</b>
                        <span>
                          {x.model ? `Own model: ${x.model}` : 'API'}
                          {x.source === 'env' ? ' · environment' : ''}
                        </span>
                      </td>
                      {tiers.map((k) => (
                        <td key={k}>
                          <PeopleF
                            avatars={false}
                            disabled={off}
                            value={r.api[x.entryId]?.[k] || ''}
                            onChange={(v) => setModel('api', k, v.trim(), x.entryId)}
                            options={[...new Set([hint[k], x.model].filter(Boolean))] as string[]}
                            placeholder={x.model || hint[k] || 'Provider’s model'}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {c.mode !== 'account' && !apis.length && (
                  <tr>
                    <td colSpan={4} className="muted small">
                      No AI APIs yet: add one under Providers.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {c.mode !== 'account' && (
            <p className="muted small" style={{ marginBottom: 0 }}>
              Your Claude account and GitHub Copilot rows show when TicketForge is opened on your own computer (localhost).
            </p>
          )}
          {off && (
            <p className="warn-text small" style={{ marginBottom: 0 }}>
              Model routing is off, so these aren’t used. Turn it on in{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  go?.('routing');
                }}
              >
                Model routing
              </a>
              .
            </p>
          )}
        </div>
      )}

      {part === 'savings' && (
        <div className="card wide">
          <h3>Reuse answers</h3>
          <p className="sub">
            Besides model routing, two things keep AI costs down: <b>prompt caching</b> (the stable part of every prompt, such as rules and
            the project’s App context, is cached by the AI API and re-read at about a tenth of the price; always on), and{' '}
            <b>reusing answers</b> to identical requests.
          </p>
          <CB
            label={
              <>
                <b>Reuse answers to identical requests</b>{' '}
                <span className="muted">
                  — the same task, choice of model and input within the days below gets the stored answer, at no AI cost. “Again” and
                  “Rewrite” always ask fresh.
                </span>
              </>
            }
            checked={r.cache}
            onChange={(e: Any) => setR({ ...r, cache: e.target.checked })}
          />
          <div
            className={`row ${r.cache ? '' : 'rt-off'}`}
            style={{ gap: 12, alignItems: 'center', margin: '6px 0 4px 32px', flexWrap: 'wrap' }}
          >
            <label className="small">
              Keep answers for{' '}
              <input
                className="rt-days"
                type="number"
                min={1}
                max={90}
                value={r.cacheDays}
                disabled={!r.cache}
                onChange={(e) => setR({ ...r, cacheDays: Number(e.target.value) || 14 })}
              />{' '}
              days
            </label>
            <span className="small muted">for:</span>
            {tasks.map((t) => (
              <CB
                key={t.id}
                label={t.label}
                disabled={!r.cache}
                checked={r.cacheTasks.includes(t.id)}
                onChange={(e: Any) =>
                  setR({ ...r, cacheTasks: e.target.checked ? [...r.cacheTasks, t.id] : r.cacheTasks.filter((x: string) => x !== t.id) })
                }
              />
            ))}
          </div>
          <div className="rt-saved small">
            <span>
              <b>{c.cacheStore?.hits || 0}</b> reused answers
              {c.cacheStore?.savedChars ? <> · ~{Math.round(c.cacheStore.savedChars / 4 / 1000)}k tokens not sent</> : ''} ·{' '}
              {c.cacheStore?.entries || 0} stored
            </span>
            {c.usage?.tokens && (
              <span>
                Prompt caching: <b>{Math.round((c.usage.tokens.cacheRead || 0) / 1000)}k</b> tokens read from cache vs{' '}
                {Math.round((c.usage.tokens.input || 0) / 1000)}k sent fresh
              </span>
            )}
            {(c.cacheStore?.entries || 0) > 0 && (
              <button
                className="btn sm subtle"
                disabled={!!busy}
                onClick={() =>
                  run('cclear', async () => onSaved(await api('/api/admin/ai', { method: 'POST', body: { action: 'cache-clear' } })))
                }
              >
                Clear stored answers
              </button>
            )}
          </div>
        </div>
      )}

      {part === 'usage' && <UsageReport routing={saved} apply={apply} view="usage" go={go} />}
      {part === 'savings' && <UsageReport routing={saved} apply={apply} view="limits" go={go} />}

      {part !== 'usage' && (
        <div className={`gen-bar ${dirty ? 'dirty' : ''}`}>
          <span className="muted small">
            {dirty
              ? 'Unsaved changes'
              : part === 'savings'
                ? 'Reuse answers: saved'
                : saved.enabled
                  ? 'Model routing is on'
                  : 'Model routing is off'}
          </span>
          <div className="spacer" />
          <button className="btn subtle" disabled={!!busy} onClick={reset}>
            <Ico svg={I.undo} />
            Reset to defaults
          </button>
          {dirty && (
            <button className="btn" disabled={!!busy} onClick={() => setR(structuredClone(saved))}>
              Discard
            </button>
          )}
          <button className="btn primary" disabled={!dirty || !!busy} onClick={save}>
            {busy === 'save' ? (
              <>
                <Spinner />
                Saving…
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
