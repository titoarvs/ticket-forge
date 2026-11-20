'use client';
// General: how hard the AI thinks, sticking to the document, and the team's own rules.
import Link from 'next/link';
import { RB, TA } from '../../fields';
import { REASONING } from '../tm-presets';
import type { Rules } from './use-rules';
import { CheckField } from './rule-fields';

/** Opens Administration → AI on its Model routing section. */
function openModelRouting() {
  try {
    localStorage.setItem('tf.adminAiSec', 'routing');
  } catch {
    /* private mode */
  }
}

function ReasoningChoice({ g }: { g: Rules }) {
  return (
    <div className="gen-reason">
      {REASONING.map(([k, label, desc]) => (
        <label key={k} className={`gen-opt ${g.r.reasoning === k ? 'on' : ''}`}>
          <RB checked={g.r.reasoning === k} onChange={() => g.set('reasoning', k)} label="" />
          <div>
            <b>{label}</b>
            {k === g.data.defaults.reasoning && (
              <span className="label-chip" style={{ marginLeft: 6 }}>
                Default
              </span>
            )}
            <div className="muted small">{desc}</div>
          </div>
        </label>
      ))}
    </div>
  );
}

export function GeneralSection({ g }: { g: Rules }) {
  return (
    <div className="cards">
      <div className="card wide">
        <h3>How the AI works</h3>
        <p className="sub">
          These rules apply to everyone’s generation: new projects from documents, Enhance,
          acceptance criteria, test cases, splitting issues and automation scripts.
        </p>
        <ReasoningChoice g={g} />
        <CheckField
          g={g}
          path="stickToDocument"
          label="Stick to the document: no extra features or speculative tickets; unclear points become open questions"
        />
        <p className="muted small" style={{ margin: '8px 0 0' }}>
          Which <b>model</b> each task uses is set in{' '}
          <Link href="/admin/ai" onClick={openModelRouting}>
            AI → Model routing
          </Link>
          .
        </p>
      </div>
      <div className="card wide">
        <h3>Team rules</h3>
        <p className="sub">Anything else every generation should follow, in plain words.</p>
        <TA
          value={g.r.custom}
          placeholder={
            'e.g. Write for a non-technical reader. Use “customer”, not “user”. Mention the API endpoint in technical tasks.'
          }
          onChange={(e) => g.set('custom', e.target.value)}
        />
      </div>
    </div>
  );
}
