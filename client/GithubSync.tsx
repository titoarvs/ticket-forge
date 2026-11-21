'use client';
// Project settings → Code & GitHub → GitHub issues (TF-130): link a GitHub repository to this
// project, import its issues as tickets and keep them in sync. Only the project owner and the
// Super Admin can; everyone else sees the link and a permission message.
import { useState } from 'react';
import { P, api, pullRemote, toast, type Any } from './core';
import { SetCard, Spinner } from './ui';
import { TF } from './fields';
import { canDeleteProject } from './DeleteProject';
import { GithubBoardPicker } from './GithubBoardPicker';

export const ONLY_OWNERS =
  'Only the project owner or a Super Admin can link a GitHub repository or import from GitHub.';

const summary = (r: Any) =>
  `${r.created} new, ${r.updated} updated, ${r.unchanged} unchanged` +
  (r.conflicts ? `, ${r.conflicts} conflict${r.conflicts === 1 ? '' : 's'}` : '') +
  (r.pushed ? `, ${r.pushed} written to GitHub` : '') +
  (r.board
    ? `. Project “${r.board.title}”: ${r.board.updated} updated, ${r.board.pushed} written` +
      (r.board.added ? `, ${r.board.added} added` : '') +
      (r.board.conflicts ? `, ${r.board.conflicts} conflicts` : '')
    : '');

function LastRun({ last }: { last: Any }) {
  return (
    <small className="muted">
      Last {last.mode === 'sync' ? 'sync' : 'import'} {new Date(last.at).toLocaleString()}
      {last.by ? ` by ${last.by}` : ''}: {summary(last)}.
    </small>
  );
}

export function GithubSyncCard() {
  const p = P();
  const link = p.githubSync;
  const allowed = canDeleteProject(p); // the same people as the server: the creator and owners
  const [repo, setRepo] = useState('');
  const [busy, setBusy] = useState('');
  const run = async (action: 'link' | 'import' | 'sync') => {
    setBusy(action);
    try {
      const r = await api(`/api/projects/${encodeURIComponent(p.id)}/github-sync`, {
        method: 'POST',
        body: { action, repo },
      });
      if (action === 'link') {
        setRepo('');
        toast(`Linked ${r.linked.repo}`, 'ok', { title: 'Repository linked' });
      } else {
        toast(
          `${summary(r)}${r.truncated ? '. Only the first 2000 issues were read.' : ''}`,
          r.errors?.length ? 'err' : 'ok',
          { title: action === 'sync' ? 'GitHub issues synced' : 'GitHub issues imported' },
        );
        if (r.errors?.length) toast(r.errors.join(' '), 'err');
      }
      await pullRemote({ quiet: true });
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const last = link?.last;
  return (
    <SetCard
      id="github-issues"
      title="GitHub issues"
      desc="Link a GitHub repository, import its issues as tickets and keep them in sync. Titles, descriptions, labels, assignees and milestones (as epics) carry over, and with a GitHub Project linked so do Status, Priority, story points and sprints (as Iterations); when both sides changed, the newer change wins and the ticket’s activity records the conflict."
    >
      {!allowed && (
        <div className="warn-banner" role="status">
          <span>{ONLY_OWNERS}</span>
        </div>
      )}
      <label className="field">
        <span>GitHub repository</span>
        <TF
          value={repo}
          placeholder={link?.repo || 'owner/name'}
          disabled={!allowed}
          onChange={(e) => setRepo(e.target.value)}
        />
        <small className="muted">
          {link?.repo ? (
            <>
              Linked:{' '}
              <a href={link.url} target="_blank" rel="noreferrer">
                {link.repo}
              </a>
            </>
          ) : (
            'No repository linked yet. Connect GitHub under Repository setup first.'
          )}
        </small>
      </label>
      <div className="row" style={{ gap: 8, margin: '8px 0' }}>
        <span title={allowed ? undefined : ONLY_OWNERS}>
          <button
            className="btn primary sm"
            disabled={!allowed || !repo.trim() || Boolean(busy)}
            onClick={() => run('link')}
          >
            {busy === 'link' ? (
              <>
                <Spinner />
                Checking…
              </>
            ) : (
              'Link repository'
            )}
          </button>
        </span>
        <span title={allowed ? undefined : ONLY_OWNERS}>
          <button
            className="btn sm"
            disabled={!allowed || !link?.repo || Boolean(busy)}
            onClick={() => run('import')}
          >
            {busy === 'import' ? (
              <>
                <Spinner />
                Importing…
              </>
            ) : (
              'Import issues'
            )}
          </button>
        </span>
        <span title={allowed ? undefined : ONLY_OWNERS}>
          <button
            className="btn sm"
            disabled={!allowed || !link?.repo || Boolean(busy)}
            onClick={() => run('sync')}
          >
            {busy === 'sync' ? (
              <>
                <Spinner />
                Syncing…
              </>
            ) : (
              'Sync now'
            )}
          </button>
        </span>
      </div>
      <GithubBoardPicker allowed={allowed} />
      {last && <LastRun last={last} />}
    </SetCard>
  );
}
