'use client';
// What you can do with one code job: review its changes, open its GitHub Actions run or pull
// request, stop it while it runs, and open (or review) its issue. Used by the job list.
import Link from 'next/link';
import { type Any, openModal } from '../core';
import { Ico, I, Spinner, Modal } from '../ui';
import { DiffReview } from '../DiffReview';
import { REVIEW } from './TicketContext';

/** The job's own page (CodePage): its live log, changes and review. */
export const openHref = (j: Any) =>
  `/p/${j.projectId}/code/${encodeURIComponent(j.ticketId)}?side=${j.side || 'frontend'}`;

type Props = { j: Any; busy: string; stop: (j: Any) => void };

export function JobActions({ j, busy, stop }: Props) {
  const review = REVIEW.includes(j.status);
  const className = 'btn sm subtle';
  const main = `btn sm ${review ? 'primary' : ''}`;
  return (
    <>
      {j.files?.length > 0 && !j.live && (
        <button
          className={className}
          onClick={() =>
            openModal(
              <Modal title={`Changes · ${j.ticketKey} ${j.title || ''}`} wide="xl">
                <DiffReview job={j} />
              </Modal>,
            )
          }
          title="Review the changes, file by file"
        >
          Changes
        </button>
      )}
      {j.url && (
        <a
          className={className}
          href={j.url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open the GitHub Actions run"
        >
          <Ico svg={I.external} />
        </a>
      )}
      {j.pr?.url && (
        <a className={className} href={j.pr.url} target="_blank" rel="noopener noreferrer">
          PR #{j.pr.number}
        </a>
      )}
      {j.live && (
        <button className={className} disabled={busy === j.id} onClick={() => stop(j)}>
          {busy === j.id ? <Spinner /> : <Ico svg={I.stop} />}
          {j.status === 'queued' ? 'Remove' : 'Stop'}
        </button>
      )}
      <Link className={main} href={openHref(j)}>
        {review ? 'Review' : 'Open'}
      </Link>
    </>
  );
}
