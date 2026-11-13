'use client';
// Administration → AI → Model routing → Usage: what the AI was used for, by whom, in which project and on which
// model, with tokens and cost (from every AI call, kept in the database), suggestions to use less, the monthly
// budget and the prices used to work out costs.
import { useEffect, useState } from 'react';
import { api, toast, type Any } from './core';
import { Ico, I, Spinner, EmptyState } from './ui';
import { SF, MenuItem, CB } from './fields';

const k = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${Math.round(x / 1e3)}k` : String(x));
const usd = (x: number | null | undefined) => (x == null ? '—' : x < 0.01 && x > 0 ? '<$0.01' : `$${x.toFixed(2)}`);
const IMPACT: Record<string, string> = { high: 'Big saving', medium: 'Good saving', low: 'Housekeeping' };
const ENGINE: Record<string, string> = { api: 'AI API', account: 'Claude account', copilot: 'GitHub Copilot', cache: 'Reused answer', '': 'Unknown' };

function Breakdown({ title, rows, label }: { title: string; rows: Any[]; label?: (r: Any) => string }) {
  if (!rows?.length) return null;
  const max = Math.max(...rows.map((r) => r.tokens), 1);
  return <div className="au-break"><h4>{title}</h4>
    <table className="rt-tbl"><thead><tr><th>{title.replace(/^By /, '')}</th><th>Calls</th><th>Tokens</th><th>API cost</th></tr></thead>
      <tbody>{rows.slice(0, 10).map((r) => <tr key={String(r.key)}>
        <td><div className="au-name">{label ? label(r) : r.key}</div><div className="au-bar"><i style={{ width: `${(r.tokens / max) * 100}%` }} /></div></td>
        <td>{r.calls}{r.cached ? <div className="muted small">{r.cached} reused</div> : null}</td>
        <td>{k(r.tokens)}{r.cacheRead ? <div className="muted small">{k(r.cacheRead)} cached</div> : null}</td>
        <td>{usd(r.cost)}{r.equiv ? <div className="muted small" title="What the Claude account runs would cost on the API">≈ {usd(r.equiv)} on account</div> : null}</td></tr>)}</tbody></table></div>;
}

/** view 'usage': suggestions and the usage report · 'limits': budget, try Standard first and prices. */
export function UsageReport({ routing, apply, view = 'usage', go }: { routing: Any; apply: (change: Any, msg: string) => Promise<void>; view?: 'usage' | 'limits'; go?: (k: string) => void }) {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<Any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [budget, setBudget] = useState(String(routing.budget?.monthlyUsd || ''));
  const [action, setAction] = useState(routing.budget?.action || 'downgrade');
  const [prices, setPrices] = useState<[string, string, string][]>(() => Object.entries(routing.prices || {}).map(([m, p]: Any) => [m, String(p.in), String(p.out)]));
  const load = () => { setErr(''); api(`/api/admin/ai/usage?days=${days}`).then(setD).catch((e) => setErr(e.message)); };
  useEffect(load, [days]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); load(); } catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const doSuggestion = (s: Any) => run(s.id, async () => {
    if (s.action === 'escalate') await apply({ escalate: true }, 'High work now tries Standard first');
    else if (s.action === 'cache') await apply({ cache: true }, 'Reusing answers is on');
    else if (s.action === 'cache-tasks') await apply({ cacheTasks: [...new Set([...routing.cacheTasks, ...s.tasks])] }, 'Answers are reused for those tasks too');
    else if (s.action === 'light-fast') await apply({ lightFast: true }, 'Light tasks no longer use extended thinking');
  });
  const saveBudget = () => run('budget', () => apply({ budget: { monthlyUsd: Number(budget) || 0, action } }, Number(budget) ? `Budget set to $${Number(budget)} a month` : 'Budget turned off'));
  const savePrices = () => run('prices', () => apply({ prices: Object.fromEntries(prices.filter(([m, i, o]) => m.trim() && i !== '' && o !== '').map(([m, i, o]) => [m.trim(), { in: Number(i), out: Number(o) }])) }, 'Prices saved'));

  if (err) return <div className="card wide"><h3>Usage</h3><p className="warn-text small">Couldn’t load the usage report: {err}</p></div>;
  if (!d) return <div className="card wide"><h3>{view === 'usage' ? 'Usage' : 'Spending limits'}</h3><p className="muted small"><Spinner /> Loading…</p></div>;
  const t = d.totals;
  const maxDay = Math.max(...d.byDay.map((x: Any) => x.tokens), 1);
  const b = d.budget;
  return <>
    {view === 'usage' && d.suggestions?.length > 0 && <div className="card wide au-sugg"><h3><Ico svg={I.sparkle} /> Suggestions to use less AI</h3>
      <p className="sub">From the last {d.days} days of AI calls in this workspace.</p>
      <ul>{d.suggestions.map((s: Any) => <li key={s.id} className={`imp-${s.impact}`}>
        <span className={`loz ${s.impact === 'high' ? 't-pass' : s.impact === 'medium' ? 's-inprogress' : ''}`}>{IMPACT[s.impact]}</span>
        <div><b>{s.title}</b><p className="muted small">{s.text}</p>
          {s.projects && <div className="au-links">{s.projects.map((p: Any) => <a key={p.id} className="btn sm" href={`/p/${p.id}/settings`}>{p.name}: App context</a>)}</div>}</div>
        {s.action ? <button className="btn sm primary" disabled={!!busy} onClick={() => doSuggestion(s)}>{busy === s.id ? <Spinner /> : 'Turn on'}</button>
          : ['budget', 'prices'].includes(s.id) && go ? <button className="btn sm" onClick={() => go('savings')}>Open Savings & limits</button> : null}
      </li>)}</ul></div>}

    {view === 'usage' && <div className="card wide">
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><h3 style={{ margin: 0 }}>Usage</h3><span className="muted small">every AI call, kept in the database</span><span className="spacer" />
        <SF filter value={String(days)} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">{[7, 30, 90].map((n) => <MenuItem key={n} value={String(n)}>Last {n} days</MenuItem>)}</SF>
        <a className="btn sm" href={`/api/admin/ai/usage?days=${days}&format=csv`}><Ico svg={I.download} />CSV</a></div>
      {!t.calls ? <EmptyState compact icon={I.chart} tone="neutral" title="No AI calls in this period"><p>Calls are recorded from now on, with their tokens and cost.</p></EmptyState> : <>
        <div className="au-kpis">
          <div><b>{t.calls}</b><span>AI calls</span></div>
          <div><b>{k(t.input + t.cacheRead)}</b><span>tokens in{t.cacheRead ? ` · ${Math.round((t.cacheRead / Math.max(1, t.input + t.cacheRead)) * 100)}% from cache` : ''}</span></div>
          <div><b>{k(t.output)}</b><span>tokens out</span></div>
          <div><b>{usd(t.cost)}</b><span>API cost</span></div>
          <div title="What the Claude account runs would have cost on the API"><b>{usd(t.equiv)}</b><span>Claude account (API value)</span></div>
          <div><b>{t.cached}</b><span>reused answers{t.cachedChars ? ` · ~${k(Math.round(t.cachedChars / 4))} tokens saved` : ''}</span></div>
          {t.escalated > 0 && <div><b>{t.escalated}</b><span>stepped up to High ({Math.round((t.escalated / t.calls) * 100)}%)</span></div>}
          {t.errors > 0 && <div className="bad"><b>{t.errors}</b><span>failed</span></div>}
        </div>
        {t.estimated > 0 && <p className="muted small">{t.estimated} calls ran on the Claude account or Copilot, which don’t report tokens: those are estimated from the text length.</p>}
        <div className="au-days" role="img" aria-label="Tokens per day">{d.byDay.map((x: Any) => <div key={x.day} title={`${x.day}: ${x.calls} calls · ${k(x.tokens)} tokens · ${usd(x.cost)}`}>
          <i style={{ height: `${Math.max(3, (x.tokens / maxDay) * 100)}%` }} /><span>{x.day.slice(8)}</span></div>)}</div>
        <div className="au-grid">
          <Breakdown title="By task" rows={d.byTask} label={(r) => r.label} />
          <Breakdown title="By project" rows={d.byProject} />
          <Breakdown title="By person" rows={d.byUser} />
          <Breakdown title="By model" rows={d.byModel} />
        </div>
        <details className="au-top"><summary>The 20 largest calls</summary>
          <table className="rt-tbl"><thead><tr><th>When</th><th>Task</th><th>Project · person</th><th>Model</th><th>Tokens in / out</th><th>Cost</th></tr></thead>
            <tbody>{d.top.map((r: Any, i: number) => <tr key={i}><td className="small">{new Date(r.at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
              <td>{r.label}</td><td className="small">{r.project || '—'} · {r.user_name || 'system'}</td><td className="small"><code>{r.model || ENGINE[r.engine]}</code></td>
              <td className="small">{k(r.input + r.cache_read)} / {k(r.output)}{r.estimated ? ' (est.)' : ''}</td><td>{r.engine === 'api' ? usd(r.cost) : <span className="muted small">{ENGINE[r.engine]}</span>}</td></tr>)}</tbody></table>
        </details>
      </>}
    </div>}

    {view === 'limits' && <div className="card wide"><h3>Spending limits</h3>
      <p className="sub">A monthly budget for AI API spend (Claude account and Copilot runs are part of those plans and don’t count). Owners are never stopped.</p>
      {b.limit > 0 && <div className={`au-budget ${b.over ? 'over' : b.near ? 'near' : ''}`}><div className="prog"><i className="p-done" style={{ width: `${Math.min(100, b.pct * 100)}%` }} /></div>
        <span className="small"><b>{usd(b.spent)}</b> of ${b.limit} this month ({Math.round(b.pct * 100)}%){b.over ? ' · limit reached' : b.near ? ' · over 80%' : ''}</span></div>}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="small">Budget $ <input className="rt-days" style={{ width: 90 }} type="number" min={0} step={1} value={budget} placeholder="none" onChange={(e) => setBudget(e.target.value)} /> a month</label>
        <span className="small">When it’s reached:</span>
        <SF filter value={action} onChange={(e) => setAction(e.target.value)} aria-label="When the budget is reached" sx={{ '&&': { maxWidth: 280 } }}>
          <MenuItem value="warn">Warn only</MenuItem><MenuItem value="downgrade">Run High work on Standard</MenuItem><MenuItem value="pause">Pause AI (owners can still use it)</MenuItem></SF>
        <button className="btn sm primary" disabled={!!busy} onClick={saveBudget}>{busy === 'budget' ? <Spinner /> : 'Save'}</button>
      </div>
      <CB label={<><b>Try Standard first for High work</b> <span className="muted">— tickets, test cases, epics, splitting and test plans routed to High run on Standard, and are asked again on High only when the answer isn’t usable.</span></>}
        checked={routing.escalate} disabled={!!busy} onChange={(e: Any) => run('esc', () => apply({ escalate: e.target.checked }, e.target.checked ? 'High work now tries Standard first' : 'High work runs on High again'))} />
      {go && <p className="muted small" style={{ marginBottom: 0 }}>See what you spend in <a href="#" onClick={(e) => { e.preventDefault(); go('usage'); }}>Usage & suggestions</a>.</p>}
    </div>}

    {view === 'limits' && <details className="card wide au-prices"><summary><h3 style={{ display: 'inline' }}>Prices</h3> <span className="muted small">used to work out costs (USD per million tokens)</span></summary>
      <p className="sub">Anthropic’s models are built in. Add your other models (OpenAI, Gemini, OpenRouter…) with their prices from the provider’s pricing page; a model without a price shows tokens only.</p>
      <table className="rt-tbl au-price-tbl"><thead><tr><th>Model (exact name, or the start of it)</th><th>Input</th><th>Output</th><th /></tr></thead>
        <tbody>{prices.map(([m, i, o], idx) => <tr key={idx}>
          <td><input className="au-in" value={m} placeholder="e.g. gpt-4.1" onChange={(e) => setPrices(prices.map((x, j) => (j === idx ? [e.target.value, x[1], x[2]] : x)))} /></td>
          <td><input className="au-in num" type="number" min={0} step="any" value={i} onChange={(e) => setPrices(prices.map((x, j) => (j === idx ? [x[0], e.target.value, x[2]] : x)))} /></td>
          <td><input className="au-in num" type="number" min={0} step="any" value={o} onChange={(e) => setPrices(prices.map((x, j) => (j === idx ? [x[0], x[1], e.target.value] : x)))} /></td>
          <td><button className="icon-btn" aria-label="Remove price" onClick={() => setPrices(prices.filter((_, j) => j !== idx))}><Ico svg={I.trash} /></button></td></tr>)}</tbody></table>
      <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn sm" onClick={() => setPrices([...prices, ['', '', '']])}><Ico svg={I.plus} />Add a model</button>
        <button className="btn sm primary" disabled={!!busy} onClick={savePrices}>{busy === 'prices' ? <Spinner /> : 'Save prices'}</button></div>
    </details>}
  </>;
}
