'use client';
// The row under the title: status, flag, the AI actions and "Run tests".
import {
  type Any,
  can,
  isSub,
  S,
  statusColor,
  statusOf,
  toneOf,
  allowedStatuses,
  setMenu,
  openModal,
} from '../../core';
import { Ico, I, Menu, AiRunPicker } from '../../ui';
import { runTicketAi, AskModal, runTests } from '../../actions';
import { SF, opts } from '../../fields';
import { type IssueProps, setIssueField } from './edit';

function AiActions({ t }: { t: Any }) {
  return (
    <>
      <button
        className="btn ai"
        data-tour="drawer-enhance"
        title="Improve the whole issue"
        onClick={() => runTicketAi(t, 'enhance')}
      >
        <Ico svg={I.sparkle} />
        Enhance
      </button>
      <Menu
        id="drawer-ai"
        left
        button={
          <button className="btn ai" onClick={() => setMenu('drawer-ai')}>
            <Ico svg={I.sparkle} />
            More AI actions
            <Ico svg={I.chevron} />
          </button>
        }
      >
        <div className="mh">AI</div>
        <button onClick={() => runTicketAi(t, 'ac')}>Improve acceptance criteria</button>
        <button onClick={() => runTicketAi(t, 'tests')}>Regenerate test cases</button>
        {!isSub(t) && (
          <button onClick={() => runTicketAi(t, 'split')}>Split into smaller issues</button>
        )}
        <hr />
        <button onClick={() => openModal(<AskModal t={t} />)}>Ask AI to change this issue…</button>
      </Menu>
      <AiRunPicker compact />
    </>
  );
}

export function IssueToolbar({ t, edit }: IssueProps) {
  return (
    <div className="dr-actions">
      <SF
        tone={toneOf(statusOf(t.status))}
        toneColor={statusColor(statusOf(t.status))}
        aria-label="Status"
        disabled={!edit}
        value={t.status}
        onChange={(ev) => setIssueField(t, 'status', ev.target.value)}
      >
        {opts(allowedStatuses(t))}
      </SF>
      {t.flagged && (
        <span className="flag is-flag" title="Flagged: needs attention">
          <Ico svg={I.flag} />
          Flagged
        </span>
      )}
      {can('ai.use') && edit && <AiActions t={t} />}
      {t.testCases.length > 0 && can('test.run') && (
        <button
          className="btn"
          data-tour="drawer-tests"
          disabled={S.autoRun?.running}
          title="Run this issue's test cases in a browser"
          onClick={() => runTests(t.testCases.map((tc: Any) => ({ t, tc })))}
        >
          <Ico svg={I.play} />
          Run tests
        </button>
      )}
    </div>
  );
}
