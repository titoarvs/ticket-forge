'use client';
// Pull requests: every pull / merge request linked to the project's issues in one place, with their status, branch,
// issue and AI review, and the AI actions on them: Review with AI (code review or UI/UX review, read-only), Update
// with AI (change, enhance, address review comments, re-describe) and refreshing their status from GitHub / GitLab.
import { useState } from 'react';
import { S, P, useStore, api, aiBody, can, toast, openModal, closeModal, ago, emit, type Any } from './core';
import { Ico, I, Modal, Spinner, EmptyState, TypeIcon, LayerChip } from './ui';
import { TF, TA, SF, MenuItem } from './fields';
import { openDrawer, linkPr, refreshPr } from './actions';
import { openCode, openUpdatePr, codeReady } from './DevCode';

const STATUSES = ['Open', 'Draft', 'Merged', 'Declined'];
const prCls = (s: string) => ({ Open: 'pr-open', Merged: 'pr-merged', Declined: 'pr-declined', Draft: 'pr-draft' } as Any)[s] || 'pr-open';
const ref = (r: Any) => (r.number ? `${r.provider === 'GitLab' ? '!' : '#'}${r.number}` : '');
const VERDICT_CLS: Record<string, string> = { Approve: 't-pass', 'Approve with comments': 't-blocked', 'Changes requested': 't-fail', Reviewed: '' };

/** Review an open request with a read-only review agent. The findings open in the code dialog, ready to post. */
function ReviewModal({ t, pr }: { t: Any; pr: Any }) {
  const [agent, setAgent] = useState('review');
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const noun = pr.provider === 'GitLab' ? 'merge request' : 'pull request';
  const go = async () => {
    setBusy(true);
    try {
      const job = await api(`/api/projects/${P().id}/code`, { method: 'POST', body: aiBody({ action: 'prReview', ticketId: t.id, prId: pr.id, agent, focus }) });
      closeModal(); openCode(t, job.side);
    } catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Review ${ref(pr)} with AI`} wide actions={[{ label: 'Cancel' }, { label: busy ? 'Starting…' : 'Start review', kind: 'ai', disabled: busy, onClick: go }]}>
      <p className="muted small" style={{ marginTop: 0 }}><b>{pr.title}</b> · {pr.repo} · <code>{pr.branch}</code> → <code>{pr.base}</code>. The reviewer reads the {noun}’s diff and code on its own branch,
        checks it against {t.key}’s acceptance criteria and writes findings (blocking, should fix, nits). It never changes code. You can post the review on the {noun} afterwards.</p>
      <div className="upd-modes" role="radiogroup" aria-label="Reviewer">
        {([['review', '🔍 Code review', 'Correctness, security, tests and the acceptance criteria.'], ['ui-review', '🧐 UI/UX review', 'Usability, accessibility, states, copy and responsive layout.']] as [string, string, string][]).map(([k, l, d]) => (
          <button key={k} role="radio" aria-checked={agent === k} className={agent === k ? 'on' : ''} onClick={() => setAgent(k)}><b>{l}</b><span className="muted small">{d}</span></button>))}
      </div>
      <label className="field" style={{ marginTop: 10 }}><span>Focus on (optional)</span>
        <TA rows={2} value={focus} placeholder="e.g. the payroll rounding rules and the permission checks on the new endpoint" onChange={(e) => setFocus(e.target.value)} /></label>
      <p className="muted small" style={{ marginBottom: 0 }}>Runs in Claude Code with the model set for <b>Code review</b> in Administration → AI → Model routing.</p>
    </Modal>
  );
}

/** Link a pull request to an issue from this page. */
function LinkModal() {
  const p = P();
  const [issue, setIssue] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const t = p.tickets.find((x: Any) => x.id === issue);
  const go = async () => { if (!t) return; setBusy(true); if (await linkPr(t, url)) closeModal(); setBusy(false); };
  return (
    <Modal title="Link a pull request" actions={[{ label: 'Cancel' }, { label: busy ? 'Looking up…' : 'Link', kind: 'primary', disabled: busy || !t || !url.trim(), onClick: go }]}>
      <label className="field"><span>Issue</span><SF value={issue} onChange={(e) => setIssue(e.target.value)}>
        {p.tickets.map((x: Any) => <MenuItem key={x.id} value={x.id}>{x.key} {x.title}</MenuItem>)}</SF></label>
      <label className="field"><span>Pull or merge request URL</span><TF value={url} autoFocus placeholder="https://github.com/org/repo/pull/12" onChange={(e) => setUrl(e.target.value)} /></label>
    </Modal>
  );
}

export function PullRequests() {
  useStore();
  const p = P();
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [repo, setRepo] = useState('');
  const [busy, setBusy] = useState('');
  const rows: { t: Any; r: Any }[] = p.tickets.flatMap((t: Any) => (t.prs || []).map((r: Any) => ({ t, r })));
  const count = (s: string) => rows.filter((x) => x.r.status === s).length;
  const repos = [...new Set(rows.map((x) => x.r.repo).filter(Boolean))] as string[];
  const ql = q.trim().toLowerCase();
  const shown = rows.filter(({ t, r }) => (status === 'all' || (status === 'active' ? ['Open', 'Draft'].includes(r.status) : r.status === status))
    && (!repo || r.repo === repo)
    && (!ql || [r.title, r.branch, r.repo, ref(r), t.key, t.title, r.author].some((v) => String(v || '').toLowerCase().includes(ql))))
    .sort((a, b) => STATUSES.indexOf(a.r.status) - STATUSES.indexOf(b.r.status) || String(b.r.checkedAt || '').localeCompare(String(a.r.checkedAt || '')));
  const edit = can('issue.edit');
  const ai = can('ai.use') && codeReady();
  const canAi = (r: Any) => ['Open', 'Draft'].includes(r.status) && ['GitHub', 'GitLab'].includes(r.provider) && r.branch;
  const refreshAll = async () => {
    const list = rows.filter((x) => ['Open', 'Draft'].includes(x.r.status));
    setBusy('refresh');
    for (const x of list) await refreshPr(x.t, x.r.id); // one at a time: kind to the GitHub / GitLab rate limits
    setBusy('');
  };
  const reviewed = rows.filter((x) => x.r.aiReview).length;

  return (
    <div className="page"><div className="page-inner">
      <div className="page-h"><h1>Pull requests</h1><span className="spacer" />
        {edit && rows.some((x) => ['Open', 'Draft'].includes(x.r.status)) && <button className="btn" disabled={!!busy} onClick={refreshAll}>{busy === 'refresh' ? <><Spinner />Refreshing…</> : <><Ico svg={I.refresh} />Refresh open</>}</button>}
        {edit && <button className="btn primary" onClick={() => openModal(<LinkModal />)}><Ico svg={I.plus} />Link pull request</button>}
      </div>
      <p className="muted small" style={{ marginTop: -6 }}>Every pull and merge request linked to this project’s issues: opened by the coding agents or linked by hand.
        {ai ? ' Review them with AI, or update them with AI on their own branch.' : can('ai.use') && can('project.settings') ? <> Set up the local repository in <a href={`/p/${p.id}/settings`} onClick={() => { S.setTab = 'code'; emit(); }}>Project settings → Code & GitHub</a> to review and update them with AI.</> : ''}</p>

      <div className="pr-stats">
        {[['active', 'Active', count('Open') + count('Draft')], ['Open', 'Open', count('Open')], ['Draft', 'Draft', count('Draft')], ['Merged', 'Merged', count('Merged')], ['Declined', 'Declined', count('Declined')], ['all', 'All', rows.length]].map(([k, l, n]) => (
          <button key={k as string} type="button" className={status === k ? 'on' : ''} onClick={() => setStatus(k as string)}><b>{n as number}</b><span>{l as string}</span></button>))}
        <div className="pr-stat-note muted small"><Ico svg={I.sparkle} /> {reviewed} reviewed with AI</div>
      </div>

      <div className="row pr-tools">
        <TF filter value={q} placeholder="Search title, branch, issue…" onChange={(e) => setQ(e.target.value)} aria-label="Search pull requests" />
        {repos.length > 1 && <SF filter value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Repository"><MenuItem value="">All repositories</MenuItem>{repos.map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>)}</SF>}
        <span className="spacer" /><span className="muted small">{shown.length} of {rows.length}</span>
      </div>

      {!rows.length ? <EmptyState icon={I.pr} title="No pull requests yet" actions={edit ? <button className="btn primary" onClick={() => openModal(<LinkModal />)}><Ico svg={I.plus} />Link pull request</button> : undefined}>
        <p>Pull requests appear here when a coding agent opens one (Write code with AI on an issue), or when you link one to an issue.</p></EmptyState>
        : !shown.length ? <p className="muted small">No pull requests match. <a href="#" onClick={(e) => { e.preventDefault(); setStatus('all'); setQ(''); setRepo(''); }}>Show all</a></p>
        : <div className="pr-list">{shown.map(({ t, r }) => (
          <div key={`${t.id}-${r.id}`} className={`pr-item s-${String(r.status).toLowerCase()}`}>
            <Ico svg={I.pr} className="pr-ico" />
            <div className="pr-body">
              <div className="pr-l1"><a href={r.url} target="_blank" rel="noopener noreferrer" className="pr-title">{r.title}</a> <span className={`loz ${prCls(r.status)}`}>{r.status}</span>
                {r.aiReview && <span className={`loz ${VERDICT_CLS[r.aiReview.verdict] || ''}`} title={`${r.aiReview.agent} · ${ago(r.aiReview.at)}${r.aiReview.posted ? ' · posted on the request' : ''}`}>AI: {r.aiReview.verdict}{r.aiReview.posted ? ' ✓' : ''}</span>}</div>
              <div className="pr-l2 muted small">
                <span>{r.repo} {ref(r)}</span>
                {r.branch && <span><code>{r.branch}</code> → <code>{r.base || '…'}</code></span>}
                {r.author && <span>by {r.author}</span>}
                {r.checkedAt && <span>checked {ago(r.checkedAt)}</span>}
              </div>
              <button type="button" className="pr-issue small" onClick={() => openDrawer('issue', t.id)} title="Open the issue">
                <TypeIcon type={t.type} /><span className="key">{t.key}</span><span className="pr-issue-t">{t.title}</span>{t.layer && <LayerChip layer={t.layer} short />}</button>
            </div>
            <div className="pr-acts">
              {ai && canAi(r) && <button className="btn sm ai" onClick={() => openModal(<ReviewModal t={t} pr={r} />)} title="A read-only review agent reviews the diff against the issue"><Ico svg={I.sparkle} />Review</button>}
              {ai && edit && canAi(r) && <button className="btn sm" onClick={() => openUpdatePr(t, r)} title="Change, enhance, address review comments or re-describe it with AI">Update</button>}
              {edit && <button className="icon-btn" title="Refresh status" disabled={!!busy} onClick={() => refreshPr(t, r.id)}><Ico svg={I.refresh} /></button>}
              <a className="icon-btn" href={r.url} target="_blank" rel="noopener noreferrer" title={`Open on ${r.provider || 'the host'}`}><Ico svg={I.external} /></a>
            </div>
          </div>))}</div>}
    </div></div>
  );
}
