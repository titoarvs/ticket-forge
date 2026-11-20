'use client';
import { useState, useEffect } from 'react';
import { type Any, api, toast } from '../core';
import { Spinner, Ico, I, EmptyState } from '../ui';
import { SF, MenuItem, CB } from '../fields';
import { k, usd, Suggestions, Days, Breakdowns, ENGINE } from './Suggestions';

/**
 * view 'usage': suggestions and the usage report · 'limits': budget, try Standard first and prices.
 */
export function UsageReport({
  routing,
  apply,
  view = 'usage',
  go,
}: {
  routing: Any;
  apply: (change: Any, msg: string) => Promise<void>;
  view?: 'usage' | 'limits';
  go?: (k: string) => void;
}) {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<Any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [budget, setBudget] = useState(String(routing.budget?.monthlyUsd || ''));
  const [action, setAction] = useState(routing.budget?.action || 'downgrade');
  const [prices, setPrices] = useState<[string, string, string][]>(() =>
    Object.entries(routing.prices || {}).map(([m, p]: Any) => [m, String(p.in), String(p.out)]),
  );
  const load = () => {
    setErr('');
    api(`/api/admin/ai/usage?days=${days}`)
      .then(setD)
      .catch((e) => setErr(e.message));
  };
  useEffect(load, [days]);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      load();
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const doSuggestion = (s: Any) =>
    run(s.id, async () => {
      if (s.action === 'escalate')
        await apply({ escalate: true }, 'High work now tries Standard first');
      else if (s.action === 'cache') await apply({ cache: true }, 'Reusing answers is on');
      else if (s.action === 'cache-tasks')
        await apply(
          { cacheTasks: [...new Set([...routing.cacheTasks, ...s.tasks])] },
          'Answers are reused for those tasks too',
        );
      else if (s.action === 'light-fast')
        await apply({ lightFast: true }, 'Light tasks no longer use extended thinking');
    });
  const saveBudget = () =>
    run('budget', () =>
      apply(
        { budget: { monthlyUsd: Number(budget) || 0, action } },
        Number(budget) ? `Budget set to $${Number(budget)} a month` : 'Budget turned off',
      ),
    );
  const savePrices = () =>
    run('prices', () =>
      apply(
        {
          prices: Object.fromEntries(
            prices
              .filter(([m, i, o]) => m.trim() && i !== '' && o !== '')
              .map(([m, i, o]) => [m.trim(), { in: Number(i), out: Number(o) }]),
          ),
        },
        'Prices saved',
      ),
    );

  if (err)
    return (
      <div className="card wide">
        <h3>Usage</h3>
        <p className="warn-text small">Couldn’t load the usage report: {err}</p>
      </div>
    );
  if (!d)
    return (
      <div className="card wide">
        <h3>{view === 'usage' ? 'Usage' : 'Spending limits'}</h3>
        <p className="muted small">
          <Spinner /> Loading…
        </p>
      </div>
    );
  const t = d.totals;
  const b = d.budget;
  return (
    <>
      {view === 'usage' && (
        <div className="au-wrap">
          {/* 1. Period and export, for everything below */}
          <div className="au-toolbar">
            <div>
              <h3 style={{ margin: 0 }}>AI usage</h3>
              <span className="muted small">
                Every AI call in this workspace, with tokens and cost.
              </span>
            </div>
            <span className="spacer" />
            <SF
              filter
              value={String(days)}
              onChange={(e) => setDays(Number(e.target.value))}
              aria-label="Period"
            >
              {[7, 30, 90].map((n) => (
                <MenuItem key={n} value={String(n)}>
                  Last {n} days
                </MenuItem>
              ))}
            </SF>
            <a className="btn sm" href={`/api/admin/ai/usage?days=${days}&format=csv`}>
              <Ico svg={I.download} />
              Export CSV
            </a>
          </div>

          {!t.calls ? (
            <div className="card wide">
              <EmptyState compact icon={I.chart} tone="neutral" title="No AI calls in this period">
                <p>Calls are recorded from now on, with their tokens and cost.</p>
              </EmptyState>
            </div>
          ) : (
            <>
              {/* 2. The headline numbers */}
              <div className="au-kpis">
                <div>
                  <span>AI calls</span>
                  <b>{t.calls.toLocaleString()}</b>
                  <small>
                    {[
                      t.errors ? `${t.errors} failed` : '',
                      t.escalated ? `${t.escalated} stepped up to High` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'all answered'}
                  </small>
                </div>
                <div>
                  <span>Tokens</span>
                  <b>{k(t.input + t.cacheRead + t.output)}</b>
                  <small>
                    {k(t.input + t.cacheRead)} in · {k(t.output)} out
                    {t.cacheRead
                      ? ` · ${Math.round((t.cacheRead / Math.max(1, t.input + t.cacheRead)) * 100)}% from cache`
                      : ''}
                  </small>
                </div>
                <div>
                  <span>Cost</span>
                  <b>{usd(t.cost)}</b>
                  <small title="What the Claude account runs would have cost on the API">
                    {t.equiv ? `+ ${usd(t.equiv)} of Claude account use` : 'AI API spend'}
                    {t.unpriced ? ` · ${t.unpriced} without a price` : ''}
                  </small>
                </div>
                <div>
                  <span>Saved</span>
                  <b>{t.cached.toLocaleString()}</b>
                  <small>
                    reused answers
                    {t.cachedChars ? ` · ~${k(Math.round(t.cachedChars / 4))} tokens` : ''}
                  </small>
                </div>
              </div>
              {t.estimated > 0 && (
                <p className="muted small au-note">
                  {t.estimated} call{t.estimated === 1 ? '' : 's'} ran on the Claude account or
                  Copilot, which don’t report tokens: those tokens are estimated from the text
                  length.
                </p>
              )}

              {/* 3. What to change, most useful first */}
              <Suggestions
                list={d.suggestions || []}
                days={d.days}
                busy={busy}
                onTurnOn={doSuggestion}
                go={go}
              />

              {/* 4. Over time */}
              <div className="card wide au-card">
                <div className="au-card-h">
                  <h3>Over time</h3>
                  <span className="muted small">tokens per day · hover for details</span>
                </div>
                <Days rows={d.byDay} days={d.days} />
              </div>

              {/* 5. Where it goes: one breakdown at a time */}
              <Breakdowns d={d} />

              {/* 6. The biggest single calls */}
              <details className="card wide au-top">
                <summary>
                  <h3 style={{ display: 'inline' }}>Largest calls</h3>{' '}
                  <span className="muted small">the 20 calls that used the most</span>
                </summary>
                <table className="rt-tbl">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Task</th>
                      <th>Project · person</th>
                      <th>Model</th>
                      <th>Tokens in / out</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.top.map((r: Any, i: number) => (
                      <tr key={i}>
                        <td className="small">
                          {new Date(r.at).toLocaleString([], {
                            day: 'numeric',
                            month: 'short',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </td>
                        <td>{r.label}</td>
                        <td className="small">
                          {r.project || '—'} · {r.user_name || 'system'}
                        </td>
                        <td className="small">
                          <code>{r.model || ENGINE[r.engine]}</code>
                        </td>
                        <td className="small">
                          {k(r.input + r.cache_read)} / {k(r.output)}
                          {r.estimated ? ' (est.)' : ''}
                        </td>
                        <td>
                          {r.engine === 'api' ? (
                            usd(r.cost)
                          ) : (
                            <span className="muted small">{ENGINE[r.engine]}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}
        </div>
      )}

      {view === 'limits' && (
        <div className="card wide">
          <h3>Spending limits</h3>
          <p className="sub">
            A monthly budget for AI API spend (Claude account and Copilot runs are part of those
            plans and don’t count). Owners are never stopped.
          </p>
          {b.limit > 0 && (
            <div className={`au-budget ${b.over ? 'over' : b.near ? 'near' : ''}`}>
              <div className="prog">
                <i className="p-done" style={{ width: `${Math.min(100, b.pct * 100)}%` }} />
              </div>
              <span className="small">
                <b>{usd(b.spent)}</b> of ${b.limit} this month ({Math.round(b.pct * 100)}%)
                {b.over ? ' · limit reached' : b.near ? ' · over 80%' : ''}
              </span>
            </div>
          )}
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="small">
              Budget ${' '}
              <input
                className="rt-days"
                style={{ width: 90 }}
                type="number"
                min={0}
                step={1}
                value={budget}
                placeholder="none"
                onChange={(e) => setBudget(e.target.value)}
              />{' '}
              a month
            </label>
            <span className="small">When it’s reached:</span>
            <SF
              filter
              value={action}
              onChange={(e) => setAction(e.target.value)}
              aria-label="When the budget is reached"
              sx={{ '&&': { maxWidth: 280 } }}
            >
              <MenuItem value="warn">Warn only</MenuItem>
              <MenuItem value="downgrade">Run High work on Standard</MenuItem>
              <MenuItem value="pause">Pause AI (owners can still use it)</MenuItem>
            </SF>
            <button className="btn sm primary" disabled={!!busy} onClick={saveBudget}>
              {busy === 'budget' ? <Spinner /> : 'Save'}
            </button>
          </div>
          <CB
            label={
              <>
                <b>Try Standard first for High work</b>{' '}
                <span className="muted">
                  — tickets, test cases, epics, splitting and test plans routed to High run on
                  Standard, and are asked again on High only when the answer isn’t usable.
                </span>
              </>
            }
            checked={routing.escalate}
            disabled={!!busy}
            onChange={(e: Any) =>
              run('esc', () =>
                apply(
                  { escalate: e.target.checked },
                  e.target.checked
                    ? 'High work now tries Standard first'
                    : 'High work runs on High again',
                ),
              )
            }
          />
          {go && (
            <p className="muted small" style={{ marginBottom: 0 }}>
              See what you spend in{' '}
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
      )}

      {view === 'limits' && (
        <details className="card wide au-prices">
          <summary>
            <h3 style={{ display: 'inline' }}>Prices</h3>{' '}
            <span className="muted small">used to work out costs (USD per million tokens)</span>
          </summary>
          <p className="sub">
            Anthropic’s models are built in. Add your other models (OpenAI, Gemini, OpenRouter…)
            with their prices from the provider’s pricing page; a model without a price shows tokens
            only.
          </p>
          <table className="rt-tbl au-price-tbl">
            <thead>
              <tr>
                <th>Model (exact name, or the start of it)</th>
                <th>Input</th>
                <th>Output</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {prices.map(([m, i, o], idx) => (
                <tr key={idx}>
                  <td>
                    <input
                      className="au-in"
                      value={m}
                      placeholder="e.g. gpt-4.1"
                      onChange={(e) =>
                        setPrices(
                          prices.map((x, j) => (j === idx ? [e.target.value, x[1], x[2]] : x)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="au-in num"
                      type="number"
                      min={0}
                      step="any"
                      value={i}
                      onChange={(e) =>
                        setPrices(
                          prices.map((x, j) => (j === idx ? [x[0], e.target.value, x[2]] : x)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="au-in num"
                      type="number"
                      min={0}
                      step="any"
                      value={o}
                      onChange={(e) =>
                        setPrices(
                          prices.map((x, j) => (j === idx ? [x[0], x[1], e.target.value] : x)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <button
                      className="icon-btn"
                      aria-label="Remove price"
                      onClick={() => setPrices(prices.filter((_, j) => j !== idx))}
                    >
                      <Ico svg={I.trash} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn sm" onClick={() => setPrices([...prices, ['', '', '']])}>
              <Ico svg={I.plus} />
              Add a model
            </button>
            <button className="btn sm primary" disabled={!!busy} onClick={savePrices}>
              {busy === 'prices' ? <Spinner /> : 'Save prices'}
            </button>
          </div>
        </details>
      )}
    </>
  );
}
