'use client';
import { useState } from 'react';
import type { Any } from '../core';
import { Spinner, Ico, I } from '../ui';

export const k = (x: number) =>
  x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${Math.round(x / 1e3)}k` : String(x);
export const usd = (x: number | null | undefined) =>
  x == null ? '—' : x < 0.01 && x > 0 ? '<$0.01' : `$${x.toFixed(2)}`;
const IMPACT: Record<string, string> = {
  high: 'Big saving',
  medium: 'Good saving',
  low: 'Housekeeping',
};
export const ENGINE: Record<string, string> = {
  api: 'AI API',
  account: 'Claude account',
  copilot: 'GitHub Copilot',
  cache: 'Reused answer',
  '': 'Unknown',
};
const IMPACT_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
/**
 * Suggestions, most useful first: savings you can switch on, then housekeeping (folded when there's
 * anything bigger).
 */
export function Suggestions({
  list,
  days,
  busy,
  onTurnOn,
  go,
}: {
  list: Any[];
  days: number;
  busy: string;
  onTurnOn: (s: Any) => void;
  go?: (k: string) => void;
}) {
  const sorted = [...list].sort(
    (a, b) =>
      (IMPACT_ORDER[a.impact] ?? 3) - (IMPACT_ORDER[b.impact] ?? 3) ||
      Number(Boolean(b.action)) - Number(Boolean(a.action)),
  );
  const main = sorted.filter((s) => s.impact !== 'low');
  const minor = sorted.filter((s) => s.impact === 'low');
  const item = (s: Any) => (
    <li key={s.id} className={`imp-${s.impact}`}>
      <span
        className={`loz ${s.impact === 'high' ? 't-pass' : s.impact === 'medium' ? 's-inprogress' : ''}`}
      >
        {IMPACT[s.impact]}
      </span>
      <div>
        <b>{s.title}</b>
        <p className="muted small">{s.text}</p>
        {s.projects && (
          <div className="au-links">
            {s.projects.map((p: Any) => (
              <a key={p.id} className="btn sm" href={`/p/${p.id}/settings`}>
                {p.name}: App context
              </a>
            ))}
          </div>
        )}
      </div>
      {s.action ? (
        <button className="btn sm primary" disabled={!!busy} onClick={() => onTurnOn(s)}>
          {busy === s.id ? <Spinner /> : 'Turn on'}
        </button>
      ) : ['budget', 'prices'].includes(s.id) && go ? (
        <button className="btn sm" onClick={() => go('savings')}>
          Open Savings & limits
        </button>
      ) : null}
    </li>
  );
  return (
    <div className="card wide au-card au-sugg">
      <div className="au-card-h">
        <h3>
          <Ico svg={I.sparkle} /> Suggestions
        </h3>
        <span className="muted small">
          {list.length
            ? `${list.length} from the last ${days} days`
            : `nothing to change from the last ${days} days`}
        </span>
      </div>
      {!list.length ? (
        <p className="muted small" style={{ margin: 0 }}>
          <Ico svg={I.check} /> Your AI setup already uses the savings TicketForge knows about.
        </p>
      ) : (
        <>
          {main.length > 0 && <ul>{main.map(item)}</ul>}
          {minor.length > 0 &&
            (main.length ? (
              <details className="au-minor">
                <summary className="small">
                  {minor.length} housekeeping item{minor.length === 1 ? '' : 's'}
                </summary>
                <ul>{minor.map(item)}</ul>
              </details>
            ) : (
              <ul>{minor.map(item)}</ul>
            ))}
        </>
      )}
    </div>
  );
}
/**
 * Tokens per day across the whole period (days without calls show as gaps, so the shape is honest).
 */
export function Days({ rows, days }: { rows: Any[]; days: number }) {
  const by = new Map(rows.map((r) => [r.day, r]));
  const all: Any[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    all.push(by.get(day) || { day, calls: 0, tokens: 0, cost: 0 });
  }
  const max = Math.max(...all.map((x) => x.tokens), 1);
  const every = days > 31 ? 14 : 7;
  return (
    <div className="au-days" role="img" aria-label={`Tokens per day over the last ${days} days`}>
      {all.map((x, i) => (
        <div
          key={x.day}
          title={`${x.day}: ${x.calls} call${x.calls === 1 ? '' : 's'} · ${k(x.tokens)} tokens · ${usd(x.cost)}`}
        >
          <i style={{ height: x.tokens ? `${Math.max(4, (x.tokens / max) * 100)}%` : 0 }} />
          {((i % every === 0 && all.length - 1 - i >= every / 2) || i === all.length - 1) && (
            <span>
              {new Date(`${x.day}T00:00:00`).toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
const VIEWS: [string, string][] = [
  ['byTask', 'Task'],
  ['byProject', 'Project'],
  ['byUser', 'Person'],
  ['byModel', 'Model'],
  ['byEngine', 'Engine'],
];
/** Where the AI goes, one breakdown at a time. */
export function Breakdowns({ d }: { d: Any }) {
  const [v, setV] = useState('byTask');
  const rows: Any[] = d[v] || [];
  const label = (r: Any) =>
    v === 'byTask' ? r.label : v === 'byEngine' ? ENGINE[r.key] || r.key : r.key;
  const max = Math.max(...rows.map((r) => r.tokens), 1);
  return (
    <div className="card wide au-card">
      <div className="au-card-h">
        <h3>Where it goes</h3>
        <span className="spacer" />
        <div className="seg" role="tablist" aria-label="Break down by">
          {VIEWS.map(([key, l]) => (
            <button
              key={key}
              role="tab"
              aria-selected={v === key}
              className={v === key ? 'on' : ''}
              onClick={() => setV(key)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {!rows.length ? (
        <p className="muted small">Nothing to show.</p>
      ) : (
        <table className="rt-tbl au-break">
          <thead>
            <tr>
              <th>{VIEWS.find(([key]) => key === v)?.[1]}</th>
              <th className="num">Calls</th>
              <th className="num">Tokens</th>
              <th className="num">API cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 15).map((r) => (
              <tr key={String(r.key)}>
                <td>
                  <div className="au-name">{label(r)}</div>
                  <div className="au-bar">
                    <i style={{ width: `${(r.tokens / max) * 100}%` }} />
                  </div>
                </td>
                <td className="num">
                  {r.calls}
                  {r.cached ? <div className="muted small">{r.cached} reused</div> : null}
                  {r.errors ? <div className="muted small">{r.errors} failed</div> : null}
                </td>
                <td className="num">
                  {k(r.tokens)}
                  {r.cacheRead ? <div className="muted small">{k(r.cacheRead)} cached</div> : null}
                </td>
                <td className="num">
                  {usd(r.cost)}
                  {r.equiv ? (
                    <div
                      className="muted small"
                      title="What the Claude account runs would cost on the API"
                    >
                      ≈ {usd(r.equiv)} on account
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
