'use client';
// Administration → AI → Model routing: which model each kind of AI work uses. Tasks get a tier (High, Standard, Light);
// each tier maps to a model on every AI (Claude account, GitHub Copilot, each AI API). Cheap, routine work (epic
// outlines, questions, failure notes) runs on lighter models, saving usage and credits for the work that needs the best.
import { useState } from 'react';
import { api, toast, openModal, ago, type Any } from './core';
import { Ico, I, Spinner, Confirm } from './ui';
import { CB, SF, MenuItem, PeopleF } from './fields';

const TIER_LABEL: Record<string, string> = { high: 'High', standard: 'Standard', light: 'Light' };
const TIER_HINT: Record<string, string> = { high: 'Best quality, most usage', standard: 'Good quality, moderate usage', light: 'Fast and cheap' };
const CLAUDE_OPTIONS = ['opus', 'sonnet', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'];

/** One-click starting points. */
const PRESETS: { key: string; label: string; desc: string; tiers: (t: Any) => string }[] = [
  { key: 'quality', label: 'Best quality', desc: 'Every task on the High tier. Uses the most.', tiers: () => 'high' },
  { key: 'balanced', label: 'Balanced', desc: 'The defaults: High for tickets, documents and scripts; lighter models for routine work.', tiers: (t) => t.tier },
  { key: 'economy', label: 'Economy', desc: 'Light for most work; Standard for tickets, documents, scripts and coding agents.', tiers: (t) => (['tickets', 'docs', 'automation', 'code', 'agent-tests', 'review'].includes(t.id) ? 'standard' : 'light') },
];

export function RoutingSection({ c, onSaved }: { c: Any; onSaved: (st: Any) => void }) {
  const saved = c.settings?.routing;
  const [r, setR] = useState<Any>(() => structuredClone(saved));
  const [busy, setBusy] = useState('');
  if (!saved || !r) return null;
  const tasks: Any[] = c.tasks || [];
  const tiers: string[] = c.tiers || ['high', 'standard', 'light'];
  const dirty = JSON.stringify(r) !== JSON.stringify(saved);
  const preset = PRESETS.find((p) => tasks.every((t) => r.tiers[t.id] === p.tiers(t)))?.key;
  const setTier = (id: string, v: string) => setR((x: Any) => ({ ...x, tiers: { ...x.tiers, [id]: v } }));
  const setModel = (ai: string, tier: string, v: string, entry?: string) => setR((x: Any) => {
    const n = structuredClone(x);
    if (entry) { n.api[entry] = { high: '', standard: '', light: '', ...(n.api[entry] || {}), [tier]: v }; } else n[ai][tier] = v;
    return n;
  });
  const run = async (what: string, fn: () => Promise<void>) => { setBusy(what); try { await fn(); } catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const patch = (routing: Any) => api('/api/admin/ai', { method: 'PATCH', body: { routing } });
  const save = () => run('save', async () => { const st = await patch(r); onSaved(st); setR(structuredClone(st.settings.routing)); toast('Model routing saved. New AI work uses it right away.'); });
  const reset = () => openModal(<Confirm title="Reset model routing?" label="Reset" text="Every task goes back to its default tier, and every tier to its default model."
    onYes={() => run('reset', async () => { const st = await patch(null); onSaved(st); setR(structuredClone(st.settings.routing)); toast('Model routing reset to the defaults'); })} />);
  const clearUsage = () => run('usage', async () => onSaved(await api('/api/admin/ai', { method: 'POST', body: { action: 'usage-reset' } })));

  // The AIs a tier maps to: your Claude account and Copilot on this computer, then each AI API.
  const apis: Any[] = (c.apis || []).filter((x: Any) => x.entryId);
  const usage = c.usage?.tasks || {};
  const totalCalls = Object.values(usage).reduce((n: number, u: Any) => n + u.calls, 0) as number;
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
      <div className="card wide">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}><h3>Model routing</h3>
            <p className="sub" style={{ marginBottom: 10 }}>Each kind of AI work uses a tier: <b>High</b> for work that needs the best model, <b>Standard</b> for everyday work and <b>Light</b> for small,
              frequent jobs. Lighter tiers answer faster and use less of your Claude plan or API credits.</p></div>
        </div>
        <CB label={<><b>Use a model per task</b> <span className="muted">— off: everything uses the main model (or the model each person picks on this computer)</span></>}
          checked={r.enabled} onChange={(e: Any) => setR({ ...r, enabled: e.target.checked })} />
        <div className={off ? 'rt-off' : ''}>
          <div className="rt-presets" role="radiogroup" aria-label="Preset">{PRESETS.map((p) => (
            <button key={p.key} type="button" role="radio" aria-checked={preset === p.key} className={preset === p.key ? 'on' : ''} disabled={off}
              onClick={() => setR({ ...r, tiers: Object.fromEntries(tasks.map((t) => [t.id, p.tiers(t)])) })}><b>{p.label}</b><span className="muted small">{p.desc}</span></button>))}</div>
          <div className="rt-scroll"><table className="rt-tbl">
            <thead><tr><th>Task</th><th className="rt-desc">What it covers</th><th>Tier</th><th>Model now</th><th>Used</th></tr></thead>
            <tbody>{tasks.map((t) => {
              const g = t.group !== lastGroup ? t.group : '';
              lastGroup = t.group;
              const u = usage[t.id];
              return [
                g && <tr key={`g-${g}`} className="rt-group"><td colSpan={5}>{g}</td></tr>,
                <tr key={t.id}>
                  <td><b>{t.label}</b>{r.tiers[t.id] !== t.tier && <div className="muted small">default {TIER_LABEL[t.tier]}</div>}</td>
                  <td className="rt-desc muted small">{t.desc}{t.agent && <div>Runs in Claude Code. A model picked on the agent in Agents wins.</div>}</td>
                  <td><div className="rt-tier" role="radiogroup" aria-label={`${t.label} tier`}>{tiers.map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={r.tiers[t.id] === k} title={TIER_HINT[k]} disabled={off}
                      className={`${r.tiers[t.id] === k ? 'on' : ''} t-${k}`} onClick={() => setTier(t.id, k)}>{TIER_LABEL[k]}</button>))}</div>
                    {(c.settings?.configs || []).length > 0 && <select className="rt-cfg" aria-label={`${t.label}: custom configuration`} disabled={off} value={String(r.tiers[t.id]).startsWith('cfg:') ? r.tiers[t.id] : ''}
                      onChange={(e) => setTier(t.id, e.target.value || t.tier)}><option value="">or a configuration…</option>{c.settings.configs.map((x: Any) => <option key={x.id} value={`cfg:${x.id}`}>{x.name}</option>)}</select>}</td>
                  <td><code className="rt-model">{off ? '—' : String(r.tiers[t.id]).startsWith('cfg:') ? (c.settings?.configs || []).find((x: Any) => `cfg:${x.id}` === r.tiers[t.id])?.name || '—' : modelFor(r.tiers[t.id], t.agent) || '—'}</code></td>
                  <td className="rt-use" title={u ? Object.entries(u.models).map(([m, n]) => `${m}: ${n}`).join('\n') : ''}>{u ? `${u.calls} call${u.calls === 1 ? '' : 's'}` : '—'}</td>
                </tr>];
            })}</tbody></table></div>
          <CB label="Light tasks never use extended thinking (fastest and cheapest)" checked={r.lightFast} disabled={off} onChange={(e: Any) => setR({ ...r, lightFast: e.target.checked })} />
        </div>
      </div>

      <div className={`card wide ${off ? 'rt-off' : ''}`}><h3>Models for each tier</h3>
        <p className="sub">Which model each AI uses for a tier. A blank API field uses that provider’s own model.</p>
        <div className="rt-scroll rt-models"><table className="rt-tbl">
          <thead><tr><th>AI</th>{tiers.map((k) => <th key={k}>{TIER_LABEL[k]}</th>)}</tr></thead>
          <tbody>
            {c.mode === 'account' && <tr><td className="rt-ai"><b>Claude account</b><span>Claude Code on this computer</span></td>
              {tiers.map((k) => <td key={k}><PeopleF avatars={false} disabled={off} value={r.claude[k]} onChange={(v) => setModel('claude', k, v.trim())} options={CLAUDE_OPTIONS} placeholder={c.claudeTiers?.[k]} /></td>)}</tr>}
            {c.copilot?.available && <tr><td className="rt-ai"><b>GitHub Copilot</b><span>{c.localEngine === 'copilot' ? 'Your local AI' : 'Backup for your Claude account'}</span></td>
              {tiers.map((k) => <td key={k}><SF value={r.copilot[k]} disabled={off} onChange={(e) => setModel('copilot', k, e.target.value)}>
                {(c.copilot.models || ['']).map((m: string) => <MenuItem key={m || 'd'} value={m}>{m || `Same as Local AI (${c.copilotModel || 'default'})`}</MenuItem>)}</SF></td>)}</tr>}
            {apis.map((x) => {
              const hint = c.tierHints?.[x.id] || {};
              return <tr key={x.entryId}><td className="rt-ai"><b>{x.label}</b><span>{x.model ? `Own model: ${x.model}` : 'API'}{x.source === 'env' ? ' · environment' : ''}</span></td>
                {tiers.map((k) => <td key={k}><PeopleF avatars={false} disabled={off} value={r.api[x.entryId]?.[k] || ''} onChange={(v) => setModel('api', k, v.trim(), x.entryId)}
                  options={[...new Set([hint[k], x.model].filter(Boolean))] as string[]} placeholder={x.model || hint[k] || 'Provider’s model'} /></td>)}</tr>;
            })}
            {c.mode !== 'account' && !apis.length && <tr><td colSpan={4} className="muted small">No AI APIs yet: add one under Providers.</td></tr>}
          </tbody></table></div>
        {c.mode !== 'account' && <p className="muted small" style={{ marginBottom: 0 }}>Your Claude account and GitHub Copilot rows show when TicketForge is opened on your own computer (localhost).</p>}
      </div>

      <div className="card wide"><h3>Save usage</h3>
        <p className="sub">Three things keep AI costs down: model routing above, <b>prompt caching</b> (the stable part of every prompt, such as rules and the project’s App context, is cached by the AI API and re-read at about a tenth of the price; always on), and <b>reusing answers</b> to identical requests.</p>
        <CB label={<><b>Reuse answers to identical requests</b> <span className="muted">— the same task, choice of model and input within the days below gets the stored answer, at no AI cost. “Again” and “Rewrite” always ask fresh.</span></>} checked={r.cache} onChange={(e: Any) => setR({ ...r, cache: e.target.checked })} />
        <div className={`row ${r.cache ? '' : 'rt-off'}`} style={{ gap: 12, alignItems: 'center', margin: '6px 0 4px 32px', flexWrap: 'wrap' }}>
          <label className="small">Keep answers for <input className="rt-days" type="number" min={1} max={90} value={r.cacheDays} disabled={!r.cache} onChange={(e) => setR({ ...r, cacheDays: Number(e.target.value) || 14 })} /> days</label>
          <span className="small muted">for:</span>
          {tasks.map((t) => <CB key={t.id} label={t.label} disabled={!r.cache} checked={r.cacheTasks.includes(t.id)} onChange={(e: Any) => setR({ ...r, cacheTasks: e.target.checked ? [...r.cacheTasks, t.id] : r.cacheTasks.filter((x: string) => x !== t.id) })} />)}
        </div>
        <div className="rt-saved small">
          <span><b>{c.cacheStore?.hits || 0}</b> reused answers{c.cacheStore?.savedChars ? <> · ~{Math.round(c.cacheStore.savedChars / 4 / 1000)}k tokens not sent</> : ''} · {c.cacheStore?.entries || 0} stored</span>
          {c.usage?.tokens && <span>Prompt caching: <b>{Math.round((c.usage.tokens.cacheRead || 0) / 1000)}k</b> tokens read from cache vs {Math.round((c.usage.tokens.input || 0) / 1000)}k sent fresh</span>}
          {(c.cacheStore?.entries || 0) > 0 && <button className="btn sm subtle" disabled={!!busy} onClick={() => run('cclear', async () => onSaved(await api('/api/admin/ai', { method: 'POST', body: { action: 'cache-clear' } })))}>Clear stored answers</button>}
        </div>
      </div>

      <div className="card wide">
        <div className="row"><h3 style={{ margin: 0 }}>Usage by task</h3><span className="muted small">since {ago(c.usage?.since)} on this server</span><span className="spacer" />
          {totalCalls > 0 && <button className="btn sm subtle" disabled={!!busy} onClick={clearUsage}>{busy === 'usage' ? <Spinner /> : null}Clear</button>}</div>
        {totalCalls ? <table className="rt-tbl" style={{ marginTop: 8 }}>
          <thead><tr><th>Task</th><th>Calls</th><th>Text sent and received</th><th>Answered by</th></tr></thead>
          <tbody>{Object.entries(usage).sort((a: Any, b: Any) => b[1].chars - a[1].chars).map(([k, u]: Any) => (
            <tr key={k}><td><b>{tasks.find((t) => t.id === k)?.label || 'Other'}</b></td><td>{u.calls}</td>
              <td>{u.chars ? <>{u.chars > 1e6 ? `${(u.chars / 1e6).toFixed(1)}M` : `${Math.round(u.chars / 1e3)}k`} characters <span className="muted small">(~{Math.round(u.chars / 4 / 1e3)}k tokens)</span></> : null}
                {u.cost ? <div>${u.cost.toFixed(2)} <span className="muted small">reported by Claude Code</span></div> : null}{!u.chars && !u.cost ? '—' : null}</td>
              <td className="small">{Object.entries(u.models).map(([m, n]: Any) => <div key={m}>{m} <span className="muted">×{n}</span></div>)}</td></tr>))}</tbody></table>
          : <p className="muted small" style={{ marginBottom: 0 }}>No AI work yet since the server started. Generate something and the calls show here, with the model that answered.</p>}
      </div>

      <div className={`gen-bar ${dirty ? 'dirty' : ''}`}>
        <span className="muted small">{dirty ? 'Unsaved changes' : saved.enabled ? 'Model routing is on' : 'Model routing is off'}</span>
        <div className="spacer" />
        <button className="btn subtle" disabled={!!busy} onClick={reset}><Ico svg={I.undo} />Reset to defaults</button>
        {dirty && <button className="btn" disabled={!!busy} onClick={() => setR(structuredClone(saved))}>Discard</button>}
        <button className="btn primary" disabled={!dirty || !!busy} onClick={save}>{busy === 'save' ? <><Spinner />Saving…</> : 'Save routing'}</button>
      </div>
    </div>
  );
}
