'use client';
// Project settings → GitHub issues → Push tickets to GitHub: files a GitHub issue for every ticket
// that has none yet (with its pull request links, closed when Done) and puts it on the linked
// GitHub Project board. The server does a few per request; this asks again until none are left,
// showing how far it got. Stops at the first round that pushes nothing (the errors say why).
import { useState } from 'react';
import { P, api, pullRemote, toast, openModal, type Any } from './core';
import { Confirm, Spinner } from './ui';

const waiting = () => (P().tickets || []).filter((t: Any) => !t.github?.number && !t.parentId);

async function pushAll(onProgress: (done: number) => void) {
  let done = 0;
  const errors: string[] = [];
  for (;;) {
    const r = await api(`/api/projects/${encodeURIComponent(P().id)}/github-sync`, {
      method: 'POST',
      body: { action: 'push-tickets' },
    });
    done += r.pushed;
    errors.push(...r.errors);
    onProgress(done);
    if (!r.remaining || !r.pushed) return { done, remaining: r.remaining, errors };
  }
}

export function GithubPushButton({ allowed }: { allowed: boolean }) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const linked = Boolean(P().githubSync?.repo);
  const count = waiting().length;
  const run = async () => {
    const total = count;
    setProgress({ done: 0, total });
    try {
      const r = await pushAll((done) => setProgress({ done, total }));
      await pullRemote({ quiet: true });
      const left = r.remaining ? ` ${r.remaining} still waiting.` : '';
      toast(
        `${r.done} ticket${r.done === 1 ? '' : 's'} filed on GitHub.${left}`,
        r.errors.length ? 'err' : 'ok',
        {
          title: 'Pushed to GitHub',
        },
      );
      if (r.errors.length) toast(r.errors.slice(0, 5).join(' '), 'err');
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setProgress(null);
    }
  };
  const ask = () =>
    openModal(
      <Confirm
        title={`Push ${count} ticket${count === 1 ? '' : 's'} to GitHub?`}
        label="Push"
        text={`Each becomes an issue in ${P().githubSync?.repo} (Done tickets closed) with its pull request links${P().githubSync?.project ? ` and goes on the “${P().githubSync.project.title}” board` : ''}. People watching the repository may be notified.`}
        onYes={run}
      />,
    );
  return (
    <button
      className="btn sm"
      disabled={!allowed || !linked || !count || Boolean(progress)}
      onClick={ask}
    >
      {progress ? (
        <>
          <Spinner />
          Pushing {progress.done} of {progress.total}…
        </>
      ) : (
        `Push ${count} ticket${count === 1 ? '' : 's'} to GitHub`
      )}
    </button>
  );
}
