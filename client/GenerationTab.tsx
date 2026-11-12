'use client';
// Administration → Generation: the team's standard for generated tickets, test cases and automation scripts.
// Every generation follows these rules; the defaults give consistent, direct results.
import { useEffect, useRef, useState } from 'react';
import { S, api, toast, openModal, ago, type Any } from './core';
import { Ico, I, Confirm, Spinner, ErrorState, SectionNav, useSection } from './ui';
import { TF, TA, SF, CB, RB, MenuItem } from './fields';
import { Loading, Sk } from './ui';
import { GuideCard } from './GuideCard';
import { AiTold } from './AiTold';
import { PsdTemplateCard } from './Psd';
import { FbdTemplateCard, ArdTemplateCard } from './Fbd';

const TYPES = ['Story', 'Task', 'Bug', 'Spike'];
const REASONING: [string, string, string][] = [
  ['fast', 'Fast & consistent', 'No extended thinking. The AI follows these rules directly: quickest, most predictable results. Recommended.'],
  ['balanced', 'Balanced', 'Some thinking for unusual or complex documents.'],
  ['thorough', 'Thorough', 'Thinks deeply before answering. Slower and uses more of your AI usage or credits.'],
];

/** Corporate test standards: picking one fills the Test management fields (each can then be changed). */
const TM_STANDARDS: [string, string, string][] = [
  ['istqb', 'ISTQB', 'Formal test cases: preconditions, numbered steps, expected result per step, test data.'],
  ['xray', 'Xray for Jira', 'Step tables (action · data · expected) on every test, linked to requirements.'],
  ['bdd', 'BDD (Cucumber)', 'Gherkin scenarios in business language: Given · When · Then.'],
  ['browserstack', 'BrowserStack TM', 'Concise step tests with tags; expected result on the last step.'],
  ['custom', 'Company standard', 'Your own rules: change any field below.'],
];
const TM_PRESETS: Record<string, Any> = {
  istqb: { format: 'steps', titleFormat: 'TC: Verify <behaviour> when <condition>', stepsMin: 3, stepsMax: 12, expectedEveryStep: true, testData: true, preconditions: true, labels: 'functional, negative, boundary, security, usability, performance' },
  xray: { format: 'steps', titleFormat: 'Verify <behaviour> when <condition>', stepsMin: 2, stepsMax: 8, expectedEveryStep: true, testData: true, preconditions: true, labels: 'smoke, regression, security, ui, api, integration, negative, edge' },
  bdd: { format: 'gherkin', titleFormat: '<Actor> can <goal>', gherkinStyle: 'declarative', preconditions: true, labels: 'smoke, regression, wip, negative, edge' },
  browserstack: { format: 'steps', titleFormat: '<Feature>: <behaviour>', stepsMin: 2, stepsMax: 6, expectedEveryStep: false, testData: false, preconditions: true, labels: 'smoke, sanity, regression, p1, p2, p3' },
};

export function GenerationTab() {
  const [data, setData] = useState<Any>(null);
  const [r, setR] = useState<Any>(null);
  const [err, setErr] = useState<Any>(null);
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState<Any>(null);
  const [prompts, setPrompts] = useState<Any>(null);
  const [sec, setSec] = useSection('tf.adminGenSec', ['general', 'tickets', 'tests', 'testmgmt', 'documents', 'prompts'], 'general');
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
  // Test management: editing any field after picking a corporate standard makes it the company's own ("custom").
  const setTm = (k: string, v: Any) => setR((x: Any) => ({ ...x, testmgmt: { ...x.testmgmt, [k]: v, standard: TM_PRESETS[x.testmgmt.standard] && TM_PRESETS[x.testmgmt.standard][k] !== undefined && TM_PRESETS[x.testmgmt.standard][k] !== v ? 'custom' : x.testmgmt.standard } }));
  const numTm = (k: string, label: string, min: number, max: number) => (
    <label className="field"><span>{label}{def(`testmgmt.${k}`)}</span>
      <TF type="number" value={r.testmgmt[k]} slotProps={{ htmlInput: { min, max } }} onChange={(e) => setTm(k, Number(e.target.value))} /></label>);
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

  const changed = (keys: string[]) => keys.some((k) => JSON.stringify(r[k]) !== JSON.stringify(data.rules[k]));
  const dot = (keys: string[]) => (changed(keys) ? <span className="gen-dot" title="Unsaved changes" /> : null);
  const items = [
    { key: 'general', label: 'General', hint: 'Thinking level and team rules', icon: I.sparkle, badge: dot(['reasoning', 'stickToDocument', 'custom']) },
    { key: 'tickets', label: 'Tickets', hint: 'Titles, criteria, points, types', icon: I.backlog, badge: dot(['tickets']) },
    { key: 'tests', label: 'Test cases & scripts', hint: 'Test cases on issues, Playwright', icon: I.test, badge: dot(['tests', 'automation']) },
    { key: 'testmgmt', label: 'Test management', hint: 'Corporate test standard', icon: I.check, badge: dot(['testmgmt']) },
    { key: 'documents', label: 'Documents', hint: 'Guide and document templates', icon: I.doc },
    { key: 'prompts', label: 'What the AI is told', hint: 'Preview of every prompt', icon: I.summary },
  ];
  return (
    <div className="gen sec-layout">
      <SectionNav label="Generation settings" items={items} value={sec} onChange={setSec} />
      <div className="sec-body">
      {sec === 'general' && <div className="cards">
        <div className="card wide"><h3>How the AI works</h3>
          <p className="sub">These rules apply to everyone’s generation: new projects from documents, Enhance, acceptance criteria, test cases, splitting issues and automation scripts.</p>
          <div className="gen-reason">{REASONING.map(([k, label, desc]) => (
            <label key={k} className={`gen-opt ${r.reasoning === k ? 'on' : ''}`}>
              <RB checked={r.reasoning === k} onChange={() => set('reasoning', k)} label="" />
              <div><b>{label}</b>{k === D.reasoning && <span className="label-chip" style={{ marginLeft: 6 }}>Default</span>}<div className="muted small">{desc}</div></div>
            </label>))}</div>
          {check('stickToDocument', 'Stick to the document: no extra features or speculative tickets; unclear points become open questions')}
          <p className="muted small" style={{ margin: '8px 0 0' }}>Which <b>model</b> each task uses is set in <a href="/admin/ai" onClick={(e) => { e.preventDefault(); try { localStorage.setItem('tf.adminAiSec', 'routing'); } catch { /* */ } S.nav('/admin/ai'); }}>AI → Model routing</a>.</p>
        </div>

        <div className="card wide"><h3>Team rules</h3>
          <p className="sub">Anything else every generation should follow, in plain words.</p>
          <TA value={r.custom} placeholder={'e.g. Write for a non-technical reader. Use “customer”, not “user”. Mention the API endpoint in technical tasks.'} onChange={(e) => set('custom', e.target.value)} />
        </div>
      </div>}

      {sec === 'tickets' && <div className="cards">

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

      </div>}

      {sec === 'tests' && <div className="cards">
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

      </div>}

      {sec === 'testmgmt' && <div className="cards">
        <div className="card wide"><h3>Test management</h3>
          <p className="sub">How the AI writes repository tests and builds test plans (Test management). Start from a corporate standard, then change any field to match your company’s.</p>
          <div className="tm-std" role="radiogroup" aria-label="Corporate standard">{TM_STANDARDS.map(([k, l, dsc]) => (
            <button key={k} role="radio" aria-checked={r.testmgmt.standard === k} className={r.testmgmt.standard === k ? 'on' : ''}
              onClick={() => setR((x: Any) => ({ ...x, testmgmt: { ...x.testmgmt, ...(TM_PRESETS[k] || {}), standard: k } }))}><b>{l}</b><span className="muted small">{dsc}</span></button>))}</div>
          <div className="gen-grid two" style={{ marginTop: 12 }}>
            <label className="field"><span>Test format{def('testmgmt.format')}</span><SF value={r.testmgmt.format} onChange={(e) => setTm('format', e.target.value)}>
              <MenuItem value="steps">Step tables (action · data · expected)</MenuItem><MenuItem value="gherkin">Gherkin scenarios (BDD)</MenuItem><MenuItem value="both">Both: Gherkin for user behaviour, steps for the rest</MenuItem></SF></label>
            <label className="field"><span>Title pattern{def('testmgmt.titleFormat')}</span><TF value={r.testmgmt.titleFormat} placeholder="e.g. Verify <behaviour> when <condition>" onChange={(e) => setTm('titleFormat', e.target.value)} /></label>
            {numTm('perIssue', 'Tests per issue', 1, 20)}
            {r.testmgmt.format !== 'gherkin' && <div className="row" style={{ gap: 8 }}>{numTm('stepsMin', 'Steps: at least', 1, 30)}{numTm('stepsMax', 'at most', 1, 40)}</div>}
            {r.testmgmt.format !== 'steps' && <label className="field"><span>Gherkin style{def('testmgmt.gherkinStyle')}</span><SF value={r.testmgmt.gherkinStyle} onChange={(e) => setTm('gherkinStyle', e.target.value)}>
              <MenuItem value="declarative">Declarative: business language</MenuItem><MenuItem value="imperative">Imperative: UI actions</MenuItem></SF></label>}
            <label className="field"><span>Labels allowed{def('testmgmt.labels')}</span><TF value={r.testmgmt.labels} placeholder="e.g. smoke, regression, security" onChange={(e) => setTm('labels', e.target.value)} /></label>
          </div>
          <div className="gen-checks">
            {r.testmgmt.format !== 'gherkin' && check('testmgmt.expectedEveryStep', 'An expected result on every step')}
            {r.testmgmt.format !== 'gherkin' && check('testmgmt.testData', 'Test data in its own column, never inside the action')}
            {check('testmgmt.preconditions', 'Preconditions on every test')}
          </div>
          <div className="gen-grid two">
            <label className="field"><span>Priority rule{def('testmgmt.priorityRule')}</span><TA rows={2} value={r.testmgmt.priorityRule} onChange={(e) => setTm('priorityRule', e.target.value)} /></label>
            <label className="field"><span>Test plan rules{def('testmgmt.planRules')}</span><TA rows={2} value={r.testmgmt.planRules} placeholder="e.g. Smoke ≤ 15 tests; regression includes every High-priority test" onChange={(e) => setTm('planRules', e.target.value)} /></label>
          </div>
          <label className="field"><span>Company test standard (anything else)</span><TA rows={3} value={r.testmgmt.custom} placeholder={'e.g. Every test names the role it runs as. Amounts use PHP with two decimals. Payroll tests use the QA-Payroll company. Never test against production data.'} onChange={(e) => setTm('custom', e.target.value)} /></label>
        </div>

      </div>}

      {sec === 'documents' && <div className="cards">
        <GuideCard onChange={refreshPrompts} />
        <PsdTemplateCard />
        <FbdTemplateCard />
        <ArdTemplateCard />
      </div>}

      {sec === 'prompts' && <div className="cards"><AiTold prompts={prompts} /></div>}

      <div className={`gen-bar ${dirty ? 'dirty' : ''}`}>
        <span className="muted small">{dirty ? 'Unsaved changes' : data.meta ? <>Saved{data.meta.updatedBy ? ` by ${data.meta.updatedBy}` : ''} {ago(data.meta.updatedAt)}</> : 'Using the default rules'}</span>
        <div className="spacer" />
        <button className="btn subtle" disabled={!!busy} onClick={reset}><Ico svg={I.undo} />Reset to defaults</button>
        {dirty && <button className="btn" disabled={!!busy} onClick={() => setR(data.rules)}>Discard</button>}
        <button className="btn primary" disabled={!dirty || !!busy} onClick={save}>{busy === 'save' ? <><Spinner />Saving…</> : 'Save rules'}</button>
      </div>
      </div>
    </div>
  );
}
void S;
