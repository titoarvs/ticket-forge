'use client';
import { useState, useEffect } from 'react';
import { type Any, api, P, aiBody, closeModal, toast } from '../core';
import { Modal } from '../ui';
import { TA, SF, MenuItem, TF } from '../fields';
import { linkPr } from '../actions';
import { openCode } from '../DevCode';
import { useAgents } from '../Agents';

export const prCls = (s: string) =>
  (({ Open: 'pr-open', Merged: 'pr-merged', Declined: 'pr-declined', Draft: 'pr-draft' }) as Any)[
    s
  ] || 'pr-open';
export const ref = (r: Any) =>
  r.number ? `${r.provider === 'GitLab' ? '!' : '#'}${r.number}` : '';
export const VERDICT_CLS: Record<string, string> = {
  Approve: 't-pass',
  'Approve with comments': 't-blocked',
  'Changes requested': 't-fail',
  Reviewed: '',
};
/**
 * Review an open request with a read-only review agent. The findings open in the code dialog, ready
 * to post.
 */
export function ReviewModal({ t, pr }: { t: Any; pr: Any }) {
  const [agent, setAgent] = useState('review');
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const noun = pr.provider === 'GitLab' ? 'merge request' : 'pull request';
  const agents = useAgents();
  const custom = (agents?.agents || []).filter(
    (a: Any) => a.custom && a.runner === 'code' && !a.writes && a.enabled,
  );
  // Built-in reviewers that were removed (Administration → Agents) give way to the custom ones.
  useEffect(() => {
    if (
      agents &&
      agent === 'review' &&
      !(agents.agents || []).some((a: Any) => a.id === 'review' && a.enabled) &&
      custom[0]
    )
      setAgent(custom[0].id);
  }, [agents]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    setBusy(true);
    try {
      const job = await api(`/api/projects/${P().id}/code`, {
        method: 'POST',
        body: aiBody({ action: 'prReview', ticketId: t.id, prId: pr.id, agent, focus }),
      });
      closeModal();
      openCode(t, job.side);
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Review ${ref(pr)} with AI`}
      wide
      actions={[
        { label: 'Cancel' },
        { label: busy ? 'Starting…' : 'Start review', kind: 'ai', disabled: busy, onClick: go },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        <b>{pr.title}</b> · {pr.repo} · <code>{pr.branch}</code> → <code>{pr.base}</code>. The
        reviewer reads the {noun}’s diff and code on its own branch, checks it against {t.key}’s
        acceptance criteria and writes findings (blocking, should fix, nits). It never changes code.
        You can post the review on the {noun} afterwards.
      </p>
      <div className="upd-modes" role="radiogroup" aria-label="Reviewer">
        {(
          [
            [
              'review',
              '🔍 Code review',
              'Correctness, security, tests and the acceptance criteria.',
            ],
            [
              'ui-review',
              '🧐 UI/UX review',
              'Usability, accessibility, states, copy and responsive layout.',
            ],
          ] as [string, string, string][]
        )
          .filter(
            ([k]) =>
              !agents ||
              (agents.agents || []).some((a: Any) => a.id === k && a.enabled) ||
              (k === 'review' && !custom.length),
          )
          .map(([k, l, d]) => (
            <button
              key={k}
              role="radio"
              aria-checked={agent === k}
              className={agent === k ? 'on' : ''}
              onClick={() => setAgent(k)}
            >
              <b>{l}</b>
              <span className="muted small">{d}</span>
            </button>
          ))}
        {custom.map((a: Any) => (
          <button
            key={a.id}
            role="radio"
            aria-checked={agent === a.id}
            className={agent === a.id ? 'on' : ''}
            onClick={() => setAgent(a.id)}
          >
            <b>
              {a.icon} {a.name}
            </b>
            <span className="muted small">{a.summary} · custom</span>
          </button>
        ))}
      </div>
      <label className="field" style={{ marginTop: 10 }}>
        <span>Focus on (optional)</span>
        <TA
          rows={2}
          value={focus}
          placeholder="e.g. the payroll rounding rules and the permission checks on the new endpoint"
          onChange={(e) => setFocus(e.target.value)}
        />
      </label>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Runs in Claude Code with the model set for <b>Code review</b> in Administration → AI → Model
        routing.
      </p>
    </Modal>
  );
}
/** Link a pull request to an issue from this page. */
export function LinkModal() {
  const p = P();
  const [issue, setIssue] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const t = p.tickets.find((x: Any) => x.id === issue);
  const go = async () => {
    if (!t) return;
    setBusy(true);
    if (await linkPr(t, url)) closeModal();
    setBusy(false);
  };
  return (
    <Modal
      title="Link a pull request"
      actions={[
        { label: 'Cancel' },
        {
          label: busy ? 'Looking up…' : 'Link',
          kind: 'primary',
          disabled: busy || !t || !url.trim(),
          onClick: go,
        },
      ]}
    >
      <label className="field">
        <span>Issue</span>
        <SF value={issue} onChange={(e) => setIssue(e.target.value)}>
          {p.tickets.map((x: Any) => (
            <MenuItem key={x.id} value={x.id}>
              {x.key} {x.title}
            </MenuItem>
          ))}
        </SF>
      </label>
      <label className="field">
        <span>Pull or merge request URL</span>
        <TF
          value={url}
          autoFocus
          placeholder="https://github.com/org/repo/pull/12"
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
    </Modal>
  );
}
