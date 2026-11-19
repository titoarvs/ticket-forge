'use client';
// Reuse answers: store answers to identical requests for some days, for chosen tasks; and what that
// and prompt caching saved.
import type { Any } from '../../core';
import { CB } from '../../fields';
import type { RoutingDraft } from './use-routing-draft';

function ReuseOptions({ d }: { d: RoutingDraft }) {
  const { r, setR } = d;
  const toggleTask = (id: string, on: boolean) =>
    setR({
      ...r,
      cacheTasks: on ? [...r.cacheTasks, id] : r.cacheTasks.filter((x: string) => x !== id),
    });
  return (
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
      {d.tasks.map((t) => (
        <CB
          key={t.id}
          label={t.label}
          disabled={!r.cache}
          checked={r.cacheTasks.includes(t.id)}
          onChange={(e: Any) => toggleTask(t.id, e.target.checked)}
        />
      ))}
    </div>
  );
}

/** Reused answers, tokens not sent, and prompt caching reads. */
function Saved({ c, d }: { c: Any; d: RoutingDraft }) {
  const store = c.cacheStore || {};
  const tokens = c.usage?.tokens;
  const k = (n: number) => Math.round((n || 0) / 1000);
  return (
    <div className="rt-saved small">
      <span>
        <b>{store.hits || 0}</b> reused answers
        {store.savedChars ? (
          <> · ~{Math.round(store.savedChars / 4 / 1000)}k tokens not sent</>
        ) : (
          ''
        )}{' '}
        · {store.entries || 0} stored
      </span>
      {tokens && (
        <span>
          Prompt caching: <b>{k(tokens.cacheRead)}k</b> tokens read from cache vs {k(tokens.input)}k
          sent fresh
        </span>
      )}
      {(store.entries || 0) > 0 && (
        <button className="btn sm subtle" disabled={!!d.busy} onClick={d.clearCache}>
          Clear stored answers
        </button>
      )}
    </div>
  );
}

export function SavingsCard({ c, d }: { c: Any; d: RoutingDraft }) {
  return (
    <div className="card wide">
      <h3>Reuse answers</h3>
      <p className="sub">
        Besides model routing, two things keep AI costs down: <b>prompt caching</b> (the stable part
        of every prompt, such as rules and the project’s App context, is cached by the AI API and
        re-read at about a tenth of the price; always on), and <b>reusing answers</b> to identical
        requests.
      </p>
      <CB
        label={
          <>
            <b>Reuse answers to identical requests</b>{' '}
            <span className="muted">
              — the same task, choice of model and input within the days below gets the stored
              answer, at no AI cost. “Again” and “Rewrite” always ask fresh.
            </span>
          </>
        }
        checked={d.r.cache}
        onChange={(e: Any) => d.setR({ ...d.r, cache: e.target.checked })}
      />
      <ReuseOptions d={d} />
      <Saved c={c} d={d} />
    </div>
  );
}
