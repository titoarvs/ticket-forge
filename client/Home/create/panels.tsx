'use client';
// Around the form: the "AI isn't ready" warning, the generation's progress, and "How it works".
import Link from 'next/link';
import { S, type Any, can, openModal } from '../../core';
import { Ico, I, Spinner, TypeIcon } from '../../ui';
import { AiSettingsModal } from '../../actions';
import { connLabel } from '../ProjectsPage';

function ClaudeCodeMissing({ installed }: { installed: boolean }) {
  if (installed)
    return (
      <>
        Claude Code isn’t signed in. Run <code>claude</code> in a terminal and sign in with your
        Claude account.
      </>
    );
  return (
    <>
      Claude Code isn’t installed on this computer. Run{' '}
      <code>npm install -g @anthropic-ai/claude-code</code>, then <code>claude</code> to sign in.
    </>
  );
}

/** What to do when AI can't answer yet: sign in to Claude Code here, or set up an AI API. */
export function AiNotReady() {
  const st = S.status;
  if (!st || st.ready) return null;
  return (
    <div className="warn-banner">
      <Ico svg={I.warn} />
      <span>
        {st.mode === 'account' ? (
          <>
            AI isn’t ready: <ClaudeCodeMissing installed={Boolean(st.account?.cli?.available)} />
          </>
        ) : (
          <>
            No AI API is set up for this address.{' '}
            {can('users.manage') ? (
              <>
                Set it up in <Link href="/admin/ai">Administration → AI</Link>.
              </>
            ) : (
              'Ask an administrator to set it up.'
            )}
          </>
        )}
      </span>
    </div>
  );
}

function LogIcon({ l }: { l: Any }) {
  if (l.level === 'err' || l.level === 'warn') return <Ico svg={I.warn} />;
  if (l.done) return <Ico svg={I.check} className="ok" />;
  return <Spinner />;
}

export function GenProgress({ g }: { g: Any }) {
  return (
    <div className="progress-box">
      {g.running && (
        <div className="pbar">
          <i />
        </div>
      )}
      <ul className="log">
        {g.log.map((l: Any, i: number) => (
          <li key={i} className={l.level || ''}>
            <LogIcon l={l} />
            <span>{l.message}</span>
          </li>
        ))}
        {g.running && g.chars > 0 && (
          <li className="muted small">Claude has written {g.chars.toLocaleString()} characters…</li>
        )}
      </ul>
    </div>
  );
}

const STEPS: [string, string, string][] = [
  ['Epic', 'Epics', 'Claude reads the document and groups the work into epics by capability.'],
  ['Story', 'Issues', 'Stories, tasks, spikes and bugs with user stories, estimates and labels.'],
  ['Task', 'Acceptance criteria', 'Testable Given / When / Then criteria for every issue.'],
  [
    'Test',
    'Test cases',
    'Steps and expected results that cover each criterion, ready to automate.',
  ],
];

export function HowItWorks() {
  const c = connLabel();
  return (
    <aside className="info">
      <h4>How it works</h4>
      {STEPS.map(([type, title, text]) => (
        <div key={type} className="step">
          <TypeIcon type={type} />
          <div>
            <b>{title}</b>
            {text}
          </div>
        </div>
      ))}
      <p className="small muted" style={{ margin: '16px 0 0' }}>
        Using <b>{c.label}</b>
        {c.model ? ` (${c.model})` : ''}. Large documents take a few minutes.{' '}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            openModal(<AiSettingsModal />);
          }}
        >
          Change
        </a>
      </p>
    </aside>
  );
}
