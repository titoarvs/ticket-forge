'use client';
// Projects list and "Create a project from a document".
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { S, emit, useStore, api, readNdjson, toast, openModal, store, can, hashColor, COLORS, closeProject, uid, type Any } from './core';
import { Ico, I, TypeIcon, Confirm, Spinner } from './ui';
import { BlankProjectModal, ClaudeSettingsModal } from './actions';
import { TF, TA, SF, CB, RB, DateF, PeopleF, MenuItem, opts } from './fields';

async function loadProjects() { S.projects = await api('/api/projects').catch(() => []); S.projectsLoaded = true; emit(); }

export function ProjectsPage() {
  useStore();
  const [q, setQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { closeProject(); loadProjects(); }, []);
  const list = S.projects.filter((p: Any) => !q || `${p.name} ${p.key}`.toLowerCase().includes(q.toLowerCase()));
  const importJson = async (file: File) => {
    try {
      const p = JSON.parse(await file.text());
      if (!Array.isArray(p.tickets) || !Array.isArray(p.epics)) throw new Error('Not a TicketForge project file');
      p.id = uid(); p.name = p.name || file.name.replace(/\.json$/, '');
      const saved = await api('/api/projects', { method: 'POST', body: p });
      S.nav(`/p/${saved.id}/summary`);
    } catch (e: Any) { toast(`Import failed: ${e.message}`, 'err'); }
  };
  const del = (p: Any) => openModal(<Confirm title="Delete project?" label="Delete" text={`“${p.name}” and all of its issues will be permanently deleted. This can’t be undone.`}
    onYes={async () => { try { await api(`/api/projects/${p.id}`, { method: 'DELETE' }); toast('Project deleted'); loadProjects(); } catch (e: Any) { toast(e.message, 'err'); } }} />);
  return (
    <div className="page"><div className="page-inner">
      <div className="page-h"><h1>Projects</h1><div className="spacer" />
        {can('project.create') && <>
          <button className="btn" onClick={() => fileRef.current?.click()}><Ico svg={I.upload} />Import backup</button>
          <input ref={fileRef} type="file" hidden accept=".json" onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); }} />
          <Link className="btn primary" href="/new">Create project</Link>
        </>}
      </div>
      {!S.projectsLoaded ? <Spinner /> : S.projects.length ? <>
        <div className="toolbar"><TF search sx={{ width: 220 }} placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <table className="tbl"><thead><tr><th>Name</th><th>Key</th><th className="num">Epics</th><th className="num">Issues</th><th>Last updated</th><th /></tr></thead><tbody>
          {list.map((p: Any) => (
            <tr key={p.id} className="click" onClick={() => S.nav(`/p/${p.id}/summary`)}>
              <td><span className="row" style={{ flexWrap: 'nowrap' }}><span className="proj-avatar" style={{ width: 24, height: 24, fontSize: 10, background: hashColor(p.key, COLORS) }}>{p.key.slice(0, 2)}</span><a>{p.name}</a></span></td>
              <td>{p.key}</td><td className="num">{p.epics}</td><td className="num">{p.tickets}</td>
              <td className="muted">{new Date(p.updatedAt).toLocaleString()}</td>
              <td style={{ textAlign: 'right' }}>{can('project.delete') && <button className="icon-btn" title="Delete project" onClick={(e) => { e.stopPropagation(); del(p); }}><Ico svg={I.trash} /></button>}</td>
            </tr>
          ))}
        </tbody></table>
        {!list.length && <div className="empty">No projects match your search.</div>}
      </> : (
        <div className="empty" style={{ padding: '80px 20px' }}>
          <Ico svg={I.folder} size={56} style={{ color: 'var(--brand)' }} />
          <h3>{can('project.create') ? 'Create your first project' : 'No projects yet'}</h3>
          <p>{can('project.create') ? 'Upload a requirements document and Claude turns it into epics, issues, acceptance criteria and test cases.' : 'Ask an administrator to give you access to a project.'}</p>
          {can('project.create') && <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            <Link className="btn primary" href="/new">Create project from a document</Link><button className="btn" onClick={() => openModal(<BlankProjectModal />)}>Blank project</button></div>}
        </div>
      )}
    </div></div>
  );
}

// ---------------------------------------------------------------- create from a document
function connLabel() {
  const st = S.status;
  const provider = S.settings.provider || st?.defaultProvider;
  return { label: provider === 'cli' ? 'Claude account' : provider === 'api' ? 'Anthropic API' : 'Not connected', model: S.settings.model || (provider === 'api' ? st?.defaultModels?.api : st?.defaultModels?.cli) || '' };
}

export function CreateProjectPage() {
  useStore();
  const [paste, setPaste] = useState('');
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const o = S.genOpts, g = S.gen, st = S.status;
  const setOpt = (k: string, v: Any) => { S.genOpts = { ...S.genOpts, [k]: v }; store.set('tf.genOpts', { ...S.genOpts, projectKey: '' }); emit(); };
  useEffect(() => { closeProject(); }, []);

  const upload = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    setReading(true);
    try { const r = await api('/api/parse', { method: 'POST', body: fd }); S.doc = { filename: r.filename, text: r.text }; emit(); }
    catch (e: Any) { toast(e.message, 'err'); }
    finally { setReading(false); }
  };
  const generate = async () => {
    const text = S.doc ? S.doc.text : paste;
    const sourceName = S.doc ? S.doc.filename : 'Pasted requirements';
    if (text.trim().length < 20) return toast('Add a document or paste some requirements first.', 'err');
    if (!S.doc) S.doc = { filename: sourceName, text };
    const ctrl = new AbortController();
    S.gen = { running: true, ctrl, chars: 0, log: [{ message: `Sending “${sourceName}” to Claude…` }] }; emit();
    const push = (message: string, level?: string) => { S.gen.log.forEach((l: Any) => { l.done = true; }); S.gen.log.push({ message, level }); emit(); };
    try {
      const res = await api('/api/generate', { method: 'POST', raw: true, signal: ctrl.signal, body: { text, sourceName, options: { ...S.genOpts, provider: S.settings.provider || undefined, model: S.settings.model || undefined } } });
      let project: Any = null;
      await readNdjson(res, (ev) => {
        if (ev.type === 'progress') {
          if (ev.progressChars) { S.gen.chars = ev.progressChars; emit(); }
          if (ev.message) { S.gen.chars = 0; push(ev.message, ev.level); }
        } else if (ev.type === 'done') project = ev.project;
        else if (ev.type === 'error') throw new Error(ev.error);
      });
      if (!project) throw new Error('Generation ended without a result.');
      S.gen = null; S.doc = null; emit();
      toast(`Created ${project.epics.length} epics and ${project.tickets.length} issues`);
      S.nav(`/p/${project.id}/backlog`);
    } catch (e: Any) {
      if (e.name === 'AbortError') { S.gen = null; emit(); toast('Generation cancelled'); return; }
      S.gen.running = false;
      S.gen.log.forEach((l: Any) => { l.done = true; });
      S.gen.log.push({ message: `Generation failed: ${e.message}`, level: 'err' });
      emit();
    }
  };
  const providerOk = st && (st.cli?.available || st.api);
  const c = connLabel();
  return (
    <div className="page"><div className="page-inner">
      <div className="crumbs"><Link href="/">Projects</Link><span>/</span><span>Create project</span></div>
      <div className="page-h"><h1>Create a project from a document</h1></div>
      <div className="create-grid">
        <div>
          {!providerOk && st && <div className="warn-banner"><Ico svg={I.warn} /><span>No Claude connection found. Install Claude Code and run <code>claude</code> once to sign in, or set <code>ANTHROPIC_API_KEY</code>.</span></div>}
          <div className={`dropzone ${over ? 'over' : ''}`} onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) upload(f); }}>
            {reading ? <div className="row" style={{ justifyContent: 'center' }}><Spinner /> Reading document…</div> : <>
              <Ico svg={I.upload} size={32} style={{ color: 'var(--brand)' }} />
              <div style={{ marginTop: 8 }}><b>Choose a file</b> or drag and drop it here</div>
              <div className="muted small" style={{ marginTop: 4 }}>PDF, Word (.docx), Markdown, text, HTML, Excel or CSV — up to 50 MB</div></>}
            <input ref={fileRef} type="file" hidden accept={(st?.supported || []).join(',')} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
          </div>
          {S.doc ? <>
            <div className="filebar"><Ico svg={I.doc} /><span className="name">{S.doc.filename}</span><span className="muted small">{S.doc.text.split(/\s+/).length.toLocaleString()} words</span><button className="btn sm subtle" onClick={() => { S.doc = null; emit(); }}>Remove</button></div>
            <details><summary className="small muted" style={{ cursor: 'pointer' }}>Review or edit the extracted text</summary>
              <TA style={{ minHeight: 220, marginTop: 8, font: '12.5px/1.5 var(--mono)' }} value={S.doc.text} onChange={(e) => { S.doc.text = e.target.value; emit(); }} /></details>
          </> : <>
            <div className="or">or paste the requirements</div>
            <TA style={{ minHeight: 120 }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste a PRD, BRD, feature brief or meeting notes…" />
          </>}
          <div style={{ marginTop: 24 }} className="grid2">
            <label className="field"><span>Project key</span><TF maxLength={8} placeholder="Auto, e.g. SHOP" value={o.projectKey} onChange={(e) => setOpt('projectKey', e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())} /></label>
            <label className="field"><span>Issue size</span><SF value={o.granularity} onChange={(e) => setOpt('granularity', e.target.value)}>
              <MenuItem value="coarse">Fewer, larger issues</MenuItem><MenuItem value="balanced">Balanced</MenuItem><MenuItem value="fine">Many small issues</MenuItem></SF></label>
            <label className="field"><span>Test cases</span><label className="check" style={{ minHeight: 32 }}><CB checked={o.includeTests} onChange={(e) => setOpt('includeTests', e.target.checked)} /> Write test cases for every issue</label></label>
            <label className="field"><span>Test cases per issue (approx.)</span><TF type="number" min={1} max={15} value={o.testsPerTicket} onChange={(e) => setOpt('testsPerTicket', Number(e.target.value) || 4)} /></label>
          </div>
          <label className="field"><span>Instructions for Claude (optional)</span>
            <TA value={o.instructions} onChange={(e) => setOpt('instructions', e.target.value)} placeholder="e.g. We use React + Node. Label issues frontend/backend. Add an epic for analytics." /></label>
          <div className="row">
            {can('ai.use') ? <button className="btn primary" disabled={g?.running} onClick={generate}><Ico svg={I.sparkle} />Generate backlog</button>
              : <span className="muted small">Your role can’t use Claude to generate backlogs.</span>}
            {g?.running ? <button className="btn" onClick={() => g.ctrl.abort()}>Cancel</button> : <button className="btn subtle" onClick={() => openModal(<BlankProjectModal />)}>Create a blank project instead</button>}
          </div>
          {g && <div className="progress-box">
            {g.running && <div className="pbar"><i /></div>}
            <ul className="log">
              {g.log.map((l: Any, i: number) => <li key={i} className={l.level || ''}>{l.level === 'err' || l.level === 'warn' ? <Ico svg={I.warn} /> : l.done ? <Ico svg={I.check} className="ok" /> : <Spinner />}<span>{l.message}</span></li>)}
              {g.running && g.chars > 0 && <li className="muted small">Claude has written {g.chars.toLocaleString()} characters…</li>}
            </ul>
          </div>}
        </div>
        <aside className="info">
          <h4>How it works</h4>
          <div className="step"><TypeIcon type="Epic" /><div><b>Epics</b>Claude reads the document and groups the work into epics by capability.</div></div>
          <div className="step"><TypeIcon type="Story" /><div><b>Issues</b>Stories, tasks, spikes and bugs with user stories, estimates and labels.</div></div>
          <div className="step"><TypeIcon type="Task" /><div><b>Acceptance criteria</b>Testable Given / When / Then criteria for every issue.</div></div>
          <div className="step"><TypeIcon type="Test" /><div><b>Test cases</b>Steps and expected results that cover each criterion, ready to automate.</div></div>
          <p className="small muted" style={{ margin: '16px 0 0' }}>Using <b>{c.label}</b>{c.model ? ` (${c.model})` : ''}. Large documents take a few minutes. <a href="#" onClick={(e) => { e.preventDefault(); openModal(<ClaudeSettingsModal />); }}>Change</a></p>
        </aside>
      </div>
    </div></div>
  );
}
