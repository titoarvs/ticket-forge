'use client';
// Project settings → App context: the project's "app knowledge" brief, built once from the code and documents and
// included in every AI prompt for this project. It saves AI usage (the AI stops re-discovering the app each time, and
// the brief is cached by the provider) and makes answers use the app's real names. You can edit it.
import { useEffect, useState } from 'react';
import { P, api, aiBody, mutate, toast, ago, can, readNdjson, startTask, type Any } from './core';
import { Ico, I, SetCard, Spinner } from './ui';
import { TA } from './fields';
import { Markdown } from './GuideCard';

export function AppContextSettings({ ed }: { ed: boolean }) {
  const p = P();
  const ctx = p.appContext || null;
  const [head, setHead] = useState<Any>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(ctx?.md || '');
  useEffect(() => { api(`/api/projects/${p.id}/context`).then(setHead).catch(() => setHead({})); }, [p.id]);
  const stale = Boolean(ctx?.sha && head?.head && head.head !== ctx.sha);
  const build = async () => {
    setBusy(true);
    const task = startTask('Building the app context', { kind: 'ai' });
    try {
      const res = await api(`/api/projects/${p.id}/context`, { method: 'POST', raw: true, body: aiBody({}) });
      let out: Any = null;
      await readNdjson(res, (ev) => { if (ev.type === 'progress') task.update({ detail: ev.message }); else if (ev.type === 'done') out = ev.context; else if (ev.type === 'error') throw new Error(ev.error); });
      if (!out?.md) throw new Error('Nothing came back.');
      mutate((pp: Any) => { pp.appContext = out; });
      setText(out.md);
      task.finish(`${Math.round(out.chars / 100) / 10}k characters`);
      toast('Every AI action in this project now starts from this app context.', 'ok', { title: 'App context ready' });
    } catch (e: Any) { task.fail(`Couldn’t build the app context: ${e.message}`); } finally { setBusy(false); }
  };
  const saveEdit = () => { mutate((pp: Any) => { pp.appContext = { ...(pp.appContext || {}), md: text.slice(0, 12000), chars: text.length, editedAt: new Date().toISOString() }; }); setEdit(false); toast('App context saved'); };
  return <>
    <SetCard title="App context" desc="A short brief of what this app is: its users and roles, modules and pages, business rules, data and APIs. Every AI action in this project reads it instead of re-discovering the app, so answers use your real names and use less AI."
      right={ed && can('ai.use') && <button className="btn ai" disabled={busy} onClick={build}>{busy ? <><Spinner />Building…</> : <><Ico svg={I.sparkle} />{ctx ? 'Rebuild' : 'Build from the code'}</>}</button>}>
      {ctx ? <>
        <div className="ctx-meta small">
          <span className={`loz ${stale ? 't-blocked' : 't-pass'}`}>{stale ? 'Code changed since' : 'In use'}</span>
          <span className="muted">Built {ago(ctx.at)}{ctx.editedAt ? ` · edited ${ago(ctx.editedAt)}` : ''} · {Math.round((ctx.chars || ctx.md.length) / 100) / 10}k characters</span>
          {ctx.sources && <span className="muted">from {ctx.sources.pages ? `${ctx.sources.pages} pages, ${ctx.sources.endpoints} endpoints, ${ctx.sources.models} data models, ` : ''}{ctx.sources.issues} issues{ctx.sources.docs ? `, ${ctx.sources.docs} documents` : ''}</span>}
          {stale && <span className="warn-text">The code has new commits: rebuild so the AI knows about them.</span>}
        </div>
        {edit ? <>
          <TA mono rows={18} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn primary" onClick={saveEdit}>Save</button><button className="btn subtle" onClick={() => { setText(ctx.md); setEdit(false); }}>Cancel</button></div>
        </> : <>
          <div className="ctx-doc"><Markdown text={ctx.md} /></div>
          {ed && <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn sm" onClick={() => setEdit(true)}><Ico svg={I.pencil} />Edit</button>
            <button className="btn sm subtle" onClick={() => mutate((pp: Any) => { pp.appContext = null; })}>Stop using it</button></div>}
        </>}
      </> : <p className="muted small" style={{ margin: 0 }}>{head?.local ? 'Build it from the local repository (pages, endpoints, data models), the project’s issues and documents. It takes about a minute, once.' : 'Build it from the project’s issues and documents. On your own computer with a local repository set, it also reads the code.'}</p>}
    </SetCard>
  </>;
}
