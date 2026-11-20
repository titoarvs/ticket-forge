'use client';
// Development: the issue's code status, its pull requests and the "Link pull request" form.
import { useState } from 'react';
import { type Any, P, can, mutate, S, logEvent, feat, ago } from '../../core';
import { Ico, I } from '../../ui';
import { refreshPr, linkPr } from '../../actions';
import { codeReady, openCode, openUpdatePr } from '../../DevCode';
import { PrFindingChips, openPrFindings } from '../../CodeRabbit';
import { TF } from '../../fields';
import { CodeChip, finishedCode } from '../../codeStatus';
import { prCls } from '../Drawer';
import { type IssueProps, showForm } from './edit';

const hosted = (r: Any) => ['GitHub', 'GitLab'].includes(r.provider);

/** provider · repo #number · branch → base · author · checked … */
const prFacts = (r: Any) =>
  [
    `${r.provider} · ${r.repo}`,
    r.number ? ` #${r.number}` : '',
    r.branch ? ` · ${r.branch} → ${r.base || ''}` : '',
    r.author ? ` · ${r.author}` : '',
    r.checkedAt ? ` · checked ${ago(r.checkedAt)}` : '',
  ].join('');

const unlinkPr = (t: Any, r: Any) =>
  mutate(() => {
    t.prs = t.prs.filter((x: Any) => x.id !== r.id);
    logEvent(t, `unlinked pull request ${r.title}`);
  });

function PrRow({ t, edit, r }: IssueProps & { r: Any }) {
  const canUpdate =
    edit && can('ai.use') && codeReady() && ['Open', 'Draft'].includes(r.status) && hosted(r);
  const kind = r.provider === 'GitLab' ? 'merge request' : 'pull request';
  return (
    <div className="pr-row">
      <Ico svg={I.pr} />
      <div className="pr-main">
        <a href={r.url} target="_blank" rel="noopener noreferrer">
          {r.title}
        </a>
        <div className="muted small">{prFacts(r)}</div>
        <PrFindingChips t={t} r={r} />
      </div>
      <span className={`loz ${prCls(r.status)}`}>{r.status}</span>
      {canUpdate && (
        <button
          className="btn sm ai"
          title={`Change, enhance or re-describe this ${kind} with AI`}
          onClick={() => openUpdatePr(t, r)}
        >
          <Ico svg={I.sparkle} />
          Update
        </button>
      )}
      {hosted(r) && (
        <button
          className="btn sm subtle"
          title="Read CodeRabbit's review comments on it: fix them with an agent, file them as bugs, or dismiss them"
          onClick={() => openPrFindings(t, r)}
        >
          🐇 CodeRabbit
        </button>
      )}
      {edit && (
        <>
          <button className="icon-btn" title="Refresh status" onClick={() => refreshPr(t, r.id)}>
            <Ico svg={I.refresh} />
          </button>
          <button className="icon-btn" title="Unlink" onClick={() => unlinkPr(t, r)}>
            <Ico svg={I.close} />
          </button>
        </>
      )}
    </div>
  );
}

function LinkPrForm({ t }: { t: Any }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    if (await linkPr(t, url)) setUrl('');
    setBusy(false);
  };
  return (
    <div className="inline-form">
      <TF
        bare
        autoFocus
        placeholder="Paste a GitHub, GitLab or Bitbucket pull request URL"
        autoComplete="off"
        value={url}
        onChange={(ev) => setUrl(ev.target.value)}
        onKeyDown={async (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            await save();
          }
          if (ev.key === 'Escape') showForm('prForm', false);
        }}
      />
      <button className="btn sm primary" disabled={busy} onClick={save}>
        {busy ? 'Looking up…' : 'Link'}
      </button>
      <button className="btn sm subtle" onClick={() => showForm('prForm', false)}>
        Cancel
      </button>
    </div>
  );
}

/** View code, set up code with AI, link a pull request (TF-123: finished code is shown, not rewritten). */
function DevTools({ t, edit }: IssueProps) {
  return (
    <div className="tools">
      {feat('code') && codeReady() && finishedCode(t) && (
        <button
          className="btn sm"
          onClick={() => openCode(t)}
          title="Review the code, approve it and merge the pull request"
        >
          <Ico svg={I.pr} />
          View code
        </button>
      )}
      {feat('code') && !codeReady() && can('project.settings') && (
        <a
          className="btn sm subtle"
          href={`/p/${P().id}/settings`}
          onClick={() => {
            S.setTab = 'code';
          }}
          title="Set up the local repository to write code with AI"
        >
          Set up code with AI
        </a>
      )}
      {edit && feat('prs') && (
        <button className="btn sm subtle" onClick={() => showForm('prForm', true)}>
          <Ico svg={I.plus} />
          Link pull request
        </button>
      )}
    </div>
  );
}

export function DevelopmentSection({ t, edit }: IssueProps) {
  return (
    <div className="sec">
      <div className="sec-title">
        <Ico svg={I.pr} />
        <h3>Development</h3>
        <span className="count">{t.prs.length}</span>
        <CodeChip t={t} />
        {(edit || feat('code')) && <DevTools t={t} edit={edit} />}
      </div>
      {t.prs.map((r: Any) => (
        <PrRow key={r.id} t={t} edit={edit} r={r} />
      ))}
      {S.prForm && <LinkPrForm t={t} />}
      {!t.prs.length && !S.prForm && (
        <p className="muted small">
          Link the pull requests that implement this issue to track their status here.
        </p>
      )}
    </div>
  );
}
