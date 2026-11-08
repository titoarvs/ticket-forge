'use client';
// Administration → Generation → What the AI is told: the exact instructions for each kind of generation, shown
// as readable sections (role, team standards, generation guide) or as the exact text, with its size.
import { useState } from 'react';
import { copyText, type Any } from './core';
import { Ico, I } from './ui';
import { Markdown } from './GuideCard';

const KINDS: [string, string][] = [['tickets', 'Writing tickets'], ['tests', 'Writing test cases'], ['actions', 'Improving an issue'], ['automation', 'Automation scripts']];
const tokens = (s: string) => Math.ceil((s || '').length / 4);
const lines = (s: string) => String(s || '').split('\n').map((x) => x.replace(/^-\s*/, '').trim()).filter(Boolean);

/** The base instructions: the opening sentences as text, "Rules:" bullets as a list. */
function Base({ text }: { text: string }) {
  const [intro, rules = ''] = String(text).split(/\nRules:\n/);
  return <>
    <p className="told-intro">{intro.replace(/\s*\n\s*/g, ' ')}</p>
    {rules && <ul className="told-list">{rules.split(/\n(?=- )/).map((l) => l.replace(/^-\s*/, '').replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).map((l, i) => <li key={i}>{l}</li>)}</ul>}
  </>;
}

export function AiTold({ prompts }: { prompts: Any }) {
  const [kind, setKind] = useState('tickets');
  const [exact, setExact] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  if (!prompts) return null;
  const p = prompts[kind];
  const std = lines(p.standards);
  return (
    <div className="card wide told">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}><h3>What the AI is told</h3>
          <p className="sub" style={{ marginBottom: 12 }}>The exact instructions sent with every request, built from the rules and guide on this page. Unsaved changes show here as you edit.</p></div>
        <div className="seg" role="tablist" aria-label="View">
          <button role="tab" aria-selected={!exact} className={!exact ? 'on' : ''} onClick={() => setExact(false)}>Readable</button>
          <button role="tab" aria-selected={exact} className={exact ? 'on' : ''} onClick={() => setExact(true)}>Exact text</button>
        </div>
      </div>
      <div className="told-tabs" role="tablist" aria-label="Kind of generation">{KINDS.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={kind === k} className={`told-tab ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
          <b>{label}</b><span>{tokens(prompts[k].text).toLocaleString()} tokens</span></button>))}</div>
      <p className="muted small told-when"><Ico svg={I.clock} /> Used for: {p.when}</p>

      {exact ? <>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="muted small">{p.text.length.toLocaleString()} characters · about {tokens(p.text).toLocaleString()} tokens</span>
          <button className="btn sm subtle" onClick={() => copyText(p.text)}><Ico svg={I.copy} />Copy</button>
        </div>
        <pre className="code told-exact">{p.text}</pre>
      </> : <div className="told-sections">
        <section>
          <div className="told-h"><span className="told-n">1</span><b>Role and basics</b><span className="muted small">Built in</span></div>
          <Base text={p.base} />
        </section>
        <section>
          <div className="told-h"><span className="told-n">2</span><b>Team standards</b><span className="muted small">{std.length} rule{std.length === 1 ? '' : 's'} · followed exactly</span></div>
          {std.length ? <ul className="told-checks">{std.map((l, i) => <li key={i}><Ico svg={I.check} />{l}</li>)}</ul>
            : <p className="muted small" style={{ margin: 0 }}>No extra rules for this kind of generation.</p>}
          {kind !== 'automation' && <p className="muted small" style={{ margin: '8px 0 0' }}>Also checked in code after generation: story points snap to the scale, only allowed ticket types, labels trimmed, the test-case count and title prefix.</p>}
        </section>
        <section>
          <div className="told-h"><span className="told-n">3</span><b>Generation guide</b>
            <span className="muted small">{p.guide ? `${p.guide.name} · ${p.guide.chars.toLocaleString()} characters · reference context` : 'Not used here'}</span>
            {p.guide && <button className="btn sm subtle" style={{ marginLeft: 'auto' }} onClick={() => setGuideOpen(!guideOpen)}>{guideOpen ? 'Hide' : 'Show'} guide</button>}</div>
          {p.guide
            ? (guideOpen ? <div className="guide-preview told-guide"><Markdown text={p.guide.text} /></div>
              : <p className="muted small" style={{ margin: 0 }}>Added after the standards. Where the guide and the standards disagree, the standards win.</p>)
            : <p className="muted small" style={{ margin: 0 }}>{kind === 'automation' ? 'The guide isn’t used for automation scripts. Turn it on under Generation guide → Use it for.' : 'No generation guide yet. Add one under Generation guide.'}</p>}
        </section>
        <p className="muted small" style={{ margin: 0 }}>Then the request itself: the document, issue or test case, plus the expected JSON shape.</p>
      </div>}
    </div>
  );
}
