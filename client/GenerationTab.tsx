'use client';
// Administration → Generation: the team's standard for generated tickets, test cases and automation scripts.
// Every generation follows these rules; the defaults give consistent, direct results.
import { useEffect, useRef, useState } from 'react';
import { S, api, toast, openModal, ago, type Any } from './core';
import { Ico, I, Confirm, Spinner, ErrorState } from './ui';
import { TF, TA, SF, CB, RB, MenuItem } from './fields';
import { Loading, Sk } from './ui';
import { GuideCard } from './GuideCard';
import { AiTold } from './AiTold';
import { PsdTemplateCard } from './Psd';
import { FbdTemplateCard } from './Fbd';

const TYPES = ['Story', 'Task', 'Bug', 'Spike'];
const REASONING: [string, string, string][] = [
  ['fast', 'Fast & consistent', 'No extended thinking. The AI follows these rules directly: quickest, most predictable results. Recommended.'],
  ['balanced', 'Balanced', 'Some thinking for unusual or complex documents.'],
  ['thorough', 'Thorough', 'Thinks deeply before answering. Slower and uses more of your AI usage or credits.'],
];

export function GenerationTab() {
  const [data, setData] = useState<Any>(null);
  const [r, setR] = useState<Any>(null);
  const [err, setErr] = useState<Any>(null);
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState<Any>(null);
  const [prompts, setPrompts] = useState<Any>(null);
  const timer = useRef<Any>(null);
  const load = async () => { setErr(null); try { const d = await api('/api/admin/generation'); setData(d); setR(d.rules); setPreview(d.preview); setPrompts(d.prompts); } catch (e: Any) { setErr(e); } };
  const refreshPrompts = () => { if (r) api('/api/admin/generation', { method: 'PUT', body: { rules: r, preview: true } }).then((x) => { setPreview(x.preview); setPrompts(x.prompts); }).catch(() => {}); };
  useEffect(() => { load(); }, []);
  // Live preview of what the AI will be told, as you edit.
  useEffect(() => {
    if (!r || !data) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { api('/api/admin/generation', { method: 'PUT', body: { rules: r, preview: true } }).then((x) => { setPreview(x.preview); setPrompts(x.prompts); }).catch(() => {}); }, 350);
  }, [r]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <div className="card"><ErrorState compact title="Couldn’t load the generation rules" error={err} onRetry={load} /></div>;
  if (!r || !data) return <Loading><div className="card"><Sk w={180} h={16} /><Sk w="60%" h={10} style={{ margin: '10px 0 20px' }} />{[0, 1, 2, 3].map((i) => <Sk key={i} h={36} style={{ marginBottom: 12 }} />)}</div></Loading>;

  const D = data.defaults;
  const dirty = JSON.stringify(r) !== JSON.stringify(data.rules);
  const set = (path: string, v: Any) => setR((x: Any) => {
    const n = structuredClone(x);
    const keys = path.split('.');
    let o = n;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys[keys.length - 1]] = v;
    return n;
  });
  const get = (path: string, from: Any = r) => path.split('.').reduce((o: Any, k) => o?.[k], from);
  const def = (path: string) => {
    const dv = get(path, D), cv = get(path);
    if (JSON.stringify(dv) === JSON.stringify(cv)) return null;
    return <span className="muted small gen-def"> · default {Array.isArray(dv) ? dv.join(', ') : typeof dv === 'boolean' ? (dv ? 'on' : 'off') : String(dv || 'none')}</span>;
  };
  const num = (path: string, label: string, min: number, max: number) => (
    <label className="field"><span>{label}{def(path)}</span>
      <TF type="number" value={get(path)} slotProps={{ htmlInput: { min, max } }} onChange={(e) => set(path, Number(e.target.value))} /></label>
  );
  const check = (path: string, label: string) => <CB label={<>{label}{def(path)}</>} checked={Boolean(get(path))} onChange={(e: Any) => set(path, e.target.checked)} />;
  const save = async () => {
    setBusy('save');
    try { const d = await api('/api/admin/generation', { method: 'PUT', body: { rules: r } }); setData(d); setR(d.rules); setPreview(d.preview); setPrompts(d.prompts); toast('Generation rules saved. New generations follow them.'); }
    catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const reset = () => openModal(<Confirm title="Reset to the default rules?" label="Reset"
    text="Every generation rule goes back to its default. Tickets and test cases that were already generated don’t change."
    onYes={async () => { const d = await api('/api/admin/generation', { method: 'DELETE' }); setData(d); setR(d.rules); setPreview(d.preview); setPrompts(d.prompts); toast('Generation rules reset to the defaults'); }} />);
  const scaleText = (r.tickets.pointScale || []).join(', ');

  return (
    <div className="gen">
      <div className="cards">
        <div className="card wide"><h3>How the AI works</h3>
          <p className="sub">These rules apply to everyone’s generation: new projects from documents, Enhance, acceptance criteria, test cases, splitting issues and automation scripts.</p>
          <div className="gen-reason">{REASONING.map(([k, label, desc]) => (
            <label key={k} className={`gen-opt ${r.reasoning === k ? 'on' : ''}`}>
              <RB checked={r.reasoning === k} onChange={() => set('reasoning', k)} label="" />
              <div><b>{label}</b>{k === D.reasoning && <span className="label-chip" style={{ marginLeft: 6 }}>Default</span>}<div className="muted small">{desc}</div></div>
            </label>))}</div>
          {check('stickToDocument', 'Stick to the document: no extra features or speculative tickets; unclear points become open questions')}
        </div>

        <div className="card wide"><h3>Tickets</h3>
          <div className="gen-grid">
            {num('tickets.titleMaxWords', 'Title: at most (words)', 3, 30)}
            <label className="field"><span>Acceptance criteria format{def('tickets.acFormat')}</span>
              <SF value={r.tickets.acFormat} onChange={(e) => set('tickets.acFormat', e.target.value)}>
                <MenuItem value="gwt">Given / When / Then</MenuItem><MenuItem value="checklist">Checklist of testable statements</MenuItem></SF></label>
            {num('tickets.acMin', 'Acceptance criteria: at least', 1, 15)}
            {num('tickets.acMax', 'Acceptance criteria: at most', 1, 20)}
            <label className="field"><span>Story point scale{def('tickets.pointScale')}</span>
              <TF key={scaleText} defaultValue={scaleText} placeholder="1, 2, 3, 5, 8, 13" onBlur={(e) => set('tickets.pointScale', e.target.value.split(/[\s,]+/).map(Number).filter((n) => n > 0))} /></label>
            <label className="field"><span>Split tickets bigger than{def('tickets.maxPoints')}</span>
              <SF value={r.tickets.maxPoints} onChange={(e) => set('tickets.maxPoints', Number(e.target.value))}>
                {(r.tickets.pointScale || []).map((n: number) => <MenuItem key={n} value={n}>{n} points</MenuItem>)}</SF></label>
            <label className="field"><span>Default priority{def('tickets.defaultPriority')}</span>
              <SF value={r.tickets.defaultPriority} onChange={(e) => set('tickets.defaultPriority', e.target.value)}>
                {['Highest', 'High', 'Medium', 'Low'].map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}</SF></label>
            {num('tickets.maxLabels', 'Labels: at most', 0, 10)}
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Description sections, in order{def('tickets.descriptionSections')}</span>
              <TF value={r.tickets.descriptionSections} placeholder="e.g. Context, Scope, Out of scope (leave empty for free text)" onChange={(e) => set('tickets.descriptionSections', e.target.value)} /></label>
          </div>
          <div className="row" style={{ gap: 18, marginTop: 4 }}>
            {check('tickets.userStory', 'Every story has “As a…, I want…, so that…”')}
            <span className="small" style={{ fontWeight: 600, color: 'var(--text-subtle)' }}>Ticket types{def('tickets.types')}</span>
            {TYPES.map((t) => <CB key={t} label={t} checked={r.tickets.types.includes(t)} disabled={r.tickets.types.length === 1 && r.tickets.types.includes(t)}
              onChange={(e: Any) => set('tickets.types', e.target.checked ? TYPES.filter((x) => x === t || r.tickets.types.includes(x)) : r.tickets.types.filter((x: string) => x !== t))} />)}
          </div>
        </div>

        <div className="card"><h3>Test cases</h3>
          <div className="gen-grid two">
            {num('tests.perTicket', 'Test cases per ticket', 1, 15)}
            {num('tests.maxSteps', 'Steps: at most', 2, 30)}
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Titles start with{def('tests.titlePrefix')}</span>
              <TF value={r.tests.titlePrefix} placeholder="e.g. Verify (leave empty for no rule)" onChange={(e) => set('tests.titlePrefix', e.target.value)} /></label>
          </div>
          <div className="gen-checks">
            <span className="small" style={{ fontWeight: 600, color: 'var(--text-subtle)' }}>Always include</span>
            {check('tests.positive', 'A positive (happy path) test')}
            {check('tests.negative', 'A negative test (invalid input, not allowed)')}
            {check('tests.edge', 'An edge case')}
            {check('tests.preconditions', 'Fill in preconditions on every test')}
          </div>
        </div>

        <div className="card"><h3>Automation scripts</h3>
          <div className="gen-checks">
            {check('automation.roleLocators', 'Prefer user-facing locators (role, label, text) over CSS')}
            {check('automation.noHardWaits', 'No fixed waits; rely on assertions')}
            {check('automation.oneFlow', 'Script only the flow the test case describes')}
          </div>
          <label className="field" style={{ marginTop: 8 }}><span>Prefix for test data the scripts create{def('automation.testDataPrefix')}</span>
            <TF value={r.automation.testDataPrefix} placeholder="e.g. QA (leave empty for none)" onChange={(e) => set('automation.testDataPrefix', e.target.value)} /></label>
        </div>

        <div className="card wide"><h3>Team rules</h3>
          <p className="sub">Anything else every generation should follow, in plain words.</p>
          <TA value={r.custom} placeholder={'e.g. Write for a non-technical reader. Use “customer”, not “user”. Mention the API endpoint in technical tasks.'} onChange={(e) => set('custom', e.target.value)} />
        </div>

        <GuideCard onChange={refreshPrompts} />

        <PsdTemplateCard />

        <FbdTemplateCard />

        <AiTold prompts={prompts} />
      </div>

      <div className={`gen-bar ${dirty ? 'dirty' : ''}`}>
        <span className="muted small">{dirty ? 'Unsaved changes' : data.meta ? <>Saved{data.meta.updatedBy ? ` by ${data.meta.updatedBy}` : ''} {ago(data.meta.updatedAt)}</> : 'Using the default rules'}</span>
        <div className="spacer" />
        <button className="btn subtle" disabled={!!busy} onClick={reset}><Ico svg={I.undo} />Reset to defaults</button>
        {dirty && <button className="btn" disabled={!!busy} onClick={() => setR(data.rules)}>Discard</button>}
        <button className="btn primary" disabled={!dirty || !!busy} onClick={save}>{busy === 'save' ? <><Spinner />Saving…</> : 'Save rules'}</button>
      </div>
    </div>
  );
}
void S;
