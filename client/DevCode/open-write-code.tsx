'use client';
import { useState } from 'react';
import {
  type Any,
  api,
  P,
  toast,
  startTask,
  aiBody,
  mutate,
  setField,
  can,
  feat,
  openModal,
  logEvent,
  closeModal,
  S,
  emit,
} from '../core';
import { SetCard, Spinner, Ico, I, Modal } from '../ui';
import { CB, TF, TA } from '../fields';
import { setPrFixer } from '../CodeRabbit';
import { be, setBe, myPath } from './FolderPicker';
import { RepoChooser } from './RepoChooser';
import { dev } from './dev';
import { RepoProfile } from './RepoProfile';
import { CodeModal } from './CodeModal';

/**
 * Project settings → Code & GitHub: a separate backend repository (pull requests on GitHub, merge
 * requests on GitLab) and the frontend/backend split of issues.
 */
export function BackendRepoCard({
  ed,
  local: _local,
  env,
  setEnv,
}: {
  ed: boolean;
  local: boolean;
  env: Any;
  setEnv: (e: Any) => void;
}) {
  const d = be();
  const [check] = useState<Any>(null);
  const [glToken, setGlToken] = useState('');
  const gitlab = (check?.provider || d.provider) === 'GitLab';
  const saveGl = async (clear = false) => {
    setBusy('gl');
    try {
      const r = await api(`/api/projects/${P().id}/dev`, {
        method: 'POST',
        body: clear
          ? { action: 'clearGitlabToken' }
          : { action: 'saveGitlabToken', token: glToken },
      });
      setEnv({ ...env, hasGitlabToken: r.hasGitlabToken });
      setGlToken('');
      toast(clear ? 'GitLab token removed' : 'GitLab token saved');
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const [busy, setBusy] = useState('');
  const issues = P().tickets.filter((t: Any) => !t.parentId);
  const marked = issues.filter((t: Any) => t.layer).length;
  const classify = async (all: boolean) => {
    setBusy('classify');
    const task = startTask('Marking issues frontend / backend', {
      detail: `${all ? issues.length : issues.length - marked} issues`,
      kind: 'ai',
    });
    try {
      const r = await api(`/api/projects/${P().id}/layers`, {
        method: 'POST',
        body: aiBody({ all }),
      });
      const ids = Object.keys(r.layers);
      mutate((pp) => {
        for (const t of pp.tickets)
          if (r.layers[t.id] && t.layer !== r.layers[t.id]) {
            setField(t, 'layer', r.layers[t.id], 'Claude');
          }
      });
      const n = (l: string) => ids.filter((id) => r.layers[id] === l).length;
      task.finish(`${ids.length} marked`);
      toast(
        `${n('frontend')} frontend · ${n('backend')} backend · ${n('both')} both. Change any issue in its details (Implementation); ⌘Z undoes this.`,
        'ok',
        { title: `${ids.length} issues marked` },
      );
    } catch (e: Any) {
      task.fail(`Couldn’t mark the issues: ${e.message}`);
    } finally {
      setBusy('');
    }
  };
  return (
    <SetCard
      id="backend"
      title="Backend repository"
      desc="For projects whose backend lives in its own repository (GitHub or GitLab). Issues marked Backend run their code agents there, Frontend in the repository above, and Frontend + Backend in both: backend first, then the frontend builds on its API."
    >
      <CB
        label="This project has a separate backend repository"
        disabled={!ed}
        checked={Boolean(d.enabled)}
        onChange={(e: Any) => setBe('enabled', e.target.checked)}
      />
      {d.enabled && (
        <>
          <RepoChooser side="backend" ed={ed} env={env} setEnv={setEnv} />
          <h4 className="rc-sub">Branches and pull requests</h4>
          <div className="grid2">
            <label className="field">
              <span>
                {gitlab ? 'GitLab project (group/name)' : 'GitHub repository (owner/name)'}
              </span>
              <TF
                disabled={!ed}
                value={d.repo || ''}
                placeholder={gitlab ? 'tito-solutions/hris/tito-hris-api' : 'owner/my-app-api'}
                spellCheck={false}
                onChange={(e) => setBe('repo', e.target.value.trim())}
              />
              <small className="muted">
                Found automatically from the repository. Pull requests open{' '}
                {gitlab ? 'as GitLab merge requests' : 'on GitHub'}.
              </small>
            </label>
            <label className="field">
              <span>Base branch</span>
              <TF
                disabled={!ed}
                value={d.baseBranch || ''}
                placeholder="develop"
                spellCheck={false}
                onChange={(e) => setBe('baseBranch', e.target.value.trim())}
              />
            </label>
            <label className="field">
              <span>Branch prefix</span>
              <TF
                disabled={!ed}
                value={d.branchPrefix ?? dev().branchPrefix ?? 'tf/'}
                spellCheck={false}
                onChange={(e) => setBe('branchPrefix', e.target.value.trim())}
              />
            </label>
            <label className="field">
              <span>Check command (optional)</span>
              <TF
                disabled={!ed}
                value={d.checkCommand || ''}
                placeholder="e.g. npm test"
                spellCheck={false}
                onChange={(e) => setBe('checkCommand', e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span>Backend conventions</span>
            <TA
              disabled={!ed}
              rows={3}
              value={d.notes || ''}
              placeholder="e.g. Express + Drizzle, routes in src/routes, migrations with drizzle-kit, Vitest tests next to the file. Never edit existing migrations."
              onChange={(e) => setBe('notes', e.target.value)}
            />
          </label>
          <RepoProfile side="backend" ed={ed} />
          {gitlab ? (
            <div className="field" style={{ marginTop: 4 }}>
              <span>GitLab access token</span>
              <p className="small" style={{ margin: '0 0 6px' }}>
                <span
                  className={`dot ${env?.hasGitlabToken || env?.envGitlabToken ? 'ok' : 'bad'}`}
                  style={{ marginRight: 6 }}
                />
                {env?.hasGitlabToken
                  ? 'A token is saved for this project (encrypted).'
                  : env?.envGitlabToken
                    ? 'Using GITLAB_TOKEN from the server.'
                    : 'No token: the branch is pushed with your own git sign-in, and you open the merge request on GitLab from the link given.'}
              </p>
              {ed && (
                <div className="dev-path">
                  <TF
                    type="password"
                    autoComplete="off"
                    value={glToken}
                    placeholder={
                      env?.hasGitlabToken
                        ? 'Replace the saved token'
                        : 'glpat-… (scopes: api, write_repository)'
                    }
                    onChange={(e) => setGlToken(e.target.value)}
                  />
                  <button
                    className="btn"
                    disabled={!glToken.trim() || !!busy}
                    onClick={() => saveGl()}
                  >
                    Save token
                  </button>
                  {env?.hasGitlabToken && (
                    <button className="btn subtle" disabled={!!busy} onClick={() => saveGl(true)}>
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Pull requests use the GitHub account above.
            </p>
          )}
          <div className="be-classify">
            <span className="small">
              <b>Issues:</b> {marked} of {issues.length} marked frontend, backend or both.
            </span>
            {can('ai.use') && can('issue.edit') && (
              <>
                <button
                  className="btn sm ai"
                  disabled={!!busy || marked === issues.length}
                  onClick={() => classify(false)}
                >
                  {busy === 'classify' ? (
                    <>
                      <Spinner />
                      Marking…
                    </>
                  ) : (
                    <>
                      <Ico svg={I.sparkle} />
                      Mark {issues.length - marked} unmarked with AI
                    </>
                  )}
                </button>
                {marked > 0 && (
                  <button
                    className="btn sm subtle"
                    disabled={!!busy}
                    onClick={() => classify(true)}
                  >
                    Re-check all
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </SetCard>
  );
}
/** Whether "Write code with AI" can be offered for issues in this project. */
export const codeReady = () => feat('code') && Boolean(myPath('frontend') || dev().repo);
export const openCode = (t: Any, side?: string) =>
  openModal(<CodeModal t={t} initialSide={side} />);
/**
 * "Write code" on an issue or an epic's issue (TF-124): Code Jobs in a new tab with the issue; this
 * tab stays as it is. The page loads the prompt and the linked repository or spec itself.
 */
export const openWriteCode = (t: Any) => {
  window.open(
    `/code-jobs?project=${encodeURIComponent(P().id)}&ticket=${encodeURIComponent(t.id)}`,
    '_blank',
    'noopener',
  );
};
// ---------------------------------------------------------------- update an open pull / merge
// request with AI
const UPDATE_MODES: [string, string, string][] = [
  ['prompt', 'Apply changes', 'Tell the agent what to change; it works on the request’s branch.'],
  [
    'enhance',
    'Enhance',
    'Better tests, edge cases and error handling, without changing what it does.',
  ],
  ['review', 'Address review comments', 'Reads the open review comments and fixes what they ask.'],
  [
    'describe',
    'Improve description',
    'Rewrites the title and description from the real diff. No code changes.',
  ],
];
function UpdatePrModal({ t, pr }: { t: Any; pr: Any }) {
  const [mode, setMode] = useState('prompt');
  const [text, setText] = useState('');
  const [comments, setComments] = useState<Any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/projects/${P().id}/code`;
  const noun = pr.provider === 'GitLab' ? 'merge request' : 'pull request';
  const ref = `${pr.provider === 'GitLab' ? '!' : '#'}${pr.number}`;
  const loadComments = async () => {
    setComments(null);
    try {
      setComments(
        (
          await api(base, {
            method: 'POST',
            body: { action: 'comments', ticketId: t.id, prId: pr.id },
          })
        ).comments,
      );
    } catch (e: Any) {
      setComments([]);
      toast(e.message, 'err');
    }
  };
  const pick = (m: string) => {
    setMode(m);
    if (m === 'review' && comments === null) loadComments();
  };
  const go = async () => {
    setBusy(true);
    try {
      if (mode === 'describe') {
        const r = await api(base, {
          method: 'POST',
          body: aiBody({ action: 'describe', ticketId: t.id, prId: pr.id }),
        });
        mutate(() => {
          pr.title = r.title;
          logEvent(t, `rewrote the description of ${noun} ${ref} with AI`, 'Development');
        });
        closeModal();
        toast(`${ref} now reads “${r.title}”.`, 'ok', {
          title: 'Description updated',
          action: { label: 'Open', onClick: () => window.open(pr.url, '_blank', 'noopener') },
        });
        return;
      }
      const job = await api(base, {
        method: 'POST',
        body: aiBody({ action: 'update', ticketId: t.id, prId: pr.id, mode, prompt: text }),
      });
      closeModal();
      openCode(t, job.side);
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  const ready =
    mode === 'prompt' ? Boolean(text.trim()) : mode === 'review' ? Boolean(comments?.length) : true;
  return (
    <Modal
      title={`Update ${ref} with AI`}
      wide
      actions={[
        { label: 'Cancel' },
        {
          label: busy ? 'Starting…' : mode === 'describe' ? 'Rewrite description' : 'Start',
          kind: 'ai',
          disabled: busy || !ready,
          onClick: go,
        },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        <b>{pr.title}</b> · {pr.repo} · <code>{pr.branch}</code> → <code>{pr.base}</code>. Code
        changes run on the {noun}’s own branch; you review the diff, then push to the same {noun}.
      </p>
      <div className="upd-modes" role="radiogroup" aria-label="What to do">
        {UPDATE_MODES.map(([k, l, d]) => (
          <button
            key={k}
            role="radio"
            aria-checked={mode === k}
            className={mode === k ? 'on' : ''}
            onClick={() => pick(k)}
          >
            <b>{l}</b>
            <span className="muted small">{d}</span>
          </button>
        ))}
      </div>
      {mode === 'review' && (
        <div className="upd-comments">
          {comments === null ? (
            <span className="muted small">
              <Spinner /> Reading the review comments…
            </span>
          ) : comments.length ? (
            <ul className="small">
              {comments.slice(0, 12).map((c, i) => (
                <li key={i}>
                  <b>{c.author ? `@${c.author}` : 'Reviewer'}</b>
                  {c.file ? (
                    <code>
                      {' '}
                      {c.file}
                      {c.line ? `:${c.line}` : ''}
                    </code>
                  ) : null}{' '}
                  — {c.body.slice(0, 220)}
                  {c.body.length > 220 ? '…' : ''}
                </li>
              ))}
              {comments.length > 12 && <li className="muted">…and {comments.length - 12} more</li>}
            </ul>
          ) : (
            <span className="muted small">No open review comments on it.</span>
          )}
        </div>
      )}
      {mode !== 'describe' && (
        <label className="field" style={{ marginTop: 10 }}>
          <span>{mode === 'prompt' ? 'What to change' : 'Anything else (optional)'}</span>
          <TA
            rows={4}
            value={text}
            autoFocus={mode === 'prompt'}
            placeholder={
              mode === 'prompt'
                ? 'e.g. Rename the endpoint to /salary-proposals/:id/notify, and return 404 when the proposal is missing.'
                : 'e.g. Focus the tests on the approval rules.'
            }
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      )}
    </Modal>
  );
}
export const openUpdatePr = (t: Any, pr: Any) => openModal(<UpdatePrModal t={t} pr={pr} />);
// CodeRabbit findings on a pull request → an agent round on that request's branch (same as Update →
// What to change).
setPrFixer(async (t, pr, text) => {
  if (!codeReady()) {
    toast(
      'Writing code needs TicketForge on your computer with the local repository set (Project settings → Code & GitHub).',
      'err',
    );
    return;
  }
  try {
    const job = await api(`/api/projects/${P().id}/code`, {
      method: 'POST',
      body: aiBody({ action: 'update', ticketId: t.id, prId: pr.id, mode: 'prompt', prompt: text }),
    });
    closeModal();
    openCode(t, job.side);
  } catch (e: Any) {
    toast(e.message, 'err');
  }
});
void S;
void closeModal;
void emit;
