'use client';
// Administration → AI → Decisions: Jev (TypeSafe AI), a fast model for decisions (choose an option, yes/no) that the AI
// would otherwise answer. Off by default; when off, unreachable or unsure, the AI answers as before.
import { useEffect, useState } from 'react';
import { api, toast, type Any } from './core';
import { Ico, I, Spinner, ErrorState } from './ui';
import { TF, CB, SF, MenuItem } from './fields';

export function DecisionsSection() {
  const [d, setD] = useState<Any>(null);
  const [error, setError] = useState<Any>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState<Any>(null);
  const load = () => api('/api/admin/jev').then((x) => { setD(x); setError(null); }).catch(setError);
  useEffect(() => { load(); }, []);
  if (error) return <ErrorState title="Couldn’t load the decision settings" error={error} onRetry={load}><p>Jev’s settings couldn’t be loaded.</p></ErrorState>;
  if (!d) return <div className="card" style={{ padding: 24 }}><Spinner /> Loading…</div>;
  const run = async (name: string, fn: () => Promise<void>) => { setBusy(name); try { await fn(); } catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const save = (patch: Any, ok?: string) => run('save', async () => { setD(await api('/api/admin/jev', { method: 'PUT', body: patch })); setKey(''); if (ok) toast(ok); });
  return (
    <div className="cards"><div className="card wide">
      <h3>Decisions with Jev</h3>
      <p className="sub">Jev, from <a href="https://docs.typesafe.ai" target="_blank" rel="noopener noreferrer">TypeSafe AI</a>, answers fixed-format questions (pick one of several options, yes or no) with probabilities in a fraction of a second, for far less than a general AI. It can’t write text, so it only takes the small classification calls: <b>frontend, backend or both</b> for each issue, and <b>which automated tests are worth running</b>. What it isn’t sure about, and anything when it is off or unreachable, goes to your AI as before.</p>
      <div className={`gha-row ${d.configured ? 'ok' : ''}`}>
        <span className="gha-icon"><Ico svg={I.sparkle} /></span>
        <div className="gha-text">{d.configured
          ? <><b>{d.enabled ? 'On' : 'Key saved, turned off'}</b><span className="muted small">{d.keySource === 'env' ? 'Using TYPESAFE_API_KEY from the server' : `Key ends with ${d.keyEnd}`} · model {d.model}{d.updatedAt ? ` · saved ${new Date(d.updatedAt).toLocaleDateString()}` : ''}</span></>
          : <><b>Not set up</b><span className="muted small">Early access: get an API key at console.typesafe.ai → Keys.</span></>}</div>
        <span className="spacer" />
        {d.keySource === 'saved' && <button className="btn subtle" disabled={!!busy} onClick={() => run('rm', async () => { setD(await api('/api/admin/jev', { method: 'DELETE' })); toast('Jev key removed'); })}>Remove key</button>}
      </div>
      <label className="field"><span>TypeSafe API key</span>
        <div className="dev-path"><TF type="password" autoComplete="off" value={key} placeholder={d.keyEnd ? `Saved, ends with ${d.keyEnd}. Paste a new one to replace it` : 'Paste your key'} onChange={(e) => setKey(e.target.value)} />
          <button className="btn" disabled={!key.trim() || !!busy} onClick={() => save({ apiKey: key }, 'Key saved (encrypted)')}>Save key</button></div>
        <small className="muted">Stored encrypted and never shown again.</small></label>
      <CB label="Use Jev for decisions" disabled={!d.configured || !!busy} checked={d.enabled} onChange={(e: Any) => save({ enabled: e.target.checked }, e.target.checked ? 'Jev is on' : 'Jev is off')} />
      <label className="field" style={{ maxWidth: 360 }}><span>Ask the AI when Jev is less sure than</span>
        <SF disabled={!d.configured || !!busy} value={String(d.minConfidence)} onChange={(e) => save({ minConfidence: Number(e.target.value) })}>
          {[0.5, 0.6, 0.7, 0.8, 0.9].map((v) => <MenuItem key={v} value={String(v)}>{Math.round(v * 100)}% confidence</MenuItem>)}</SF>
        <small className="muted">Lower uses Jev for more answers; higher sends more to the AI.</small></label>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <button className="btn" disabled={!d.configured || !!busy} onClick={() => run('test', async () => setTest(await api('/api/admin/jev', { method: 'POST' })))}>{busy === 'test' ? <><Spinner />Testing…</> : 'Test the connection'}</button>
        {test && (test.ok ? <span className="small"><span className="dot ok" /> Works: {test.ms} ms{test.sample ? ` · example answer ${test.sample}` : ''}</span> : <span className="small"><span className="dot bad" /> {test.error}</span>)}
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>The state of the issues or tests being decided (titles, descriptions, acceptance criteria, test names and results) is sent to TypeSafe. Check their terms and your data rules before turning it on.</p>
    </div></div>
  );
}
