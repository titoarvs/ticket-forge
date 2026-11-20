'use client';
// An AI review of an open pull request: its verdict, remembered on the linked pull request (Pull
// requests page) once the report is ready.
import { useEffect } from 'react';
import { type Any, mutate, logEvent, nowIso } from '../../core';
import { prMark } from './pr-actions';

/** The verdict a review report states, in the words the Pull requests page shows. */
export function verdictOf(summary = '') {
  if (/request(ed)? changes/i.test(summary)) return 'Changes requested';
  if (/approve with comments/i.test(summary)) return 'Approve with comments';
  if (/approve/i.test(summary)) return 'Approve';
  return 'Reviewed';
}

/** The "**Verdict: …**" line a report starts with, and how it is coloured. */
export function reportVerdict(summary = '') {
  const text = summary.match(/^\s*\*\*Verdict:\s*([^*]+?)\.?\*\*/i)?.[1] || '';
  const tone = /request|block|reject/i.test(text)
    ? 'bad'
    : /comment/i.test(text)
      ? 'warn'
      : /approve/i.test(text)
        ? 'ok'
        : '';
  return { text, tone };
}

/** Returns the pull request a review job is about, and records the verdict on it once. */
export function useReviewedPr(t: Any, job: Any) {
  const isPrReview = job?.kind === 'pr-review';
  const reviewedPr = isPrReview ? t.prs.find((r: Any) => r.url === job.target?.url) : null;
  useEffect(() => {
    if (!isPrReview || job.status !== 'report' || !reviewedPr) return;
    if (reviewedPr.aiReview?.jobId === job.id) return;
    const verdict = verdictOf(job.summary || '');
    mutate(() => {
      reviewedPr.aiReview = {
        jobId: job.id,
        at: job.finishedAt || nowIso(),
        agent: job.agentName,
        verdict,
        posted: null,
      };
      logEvent(
        t,
        `${job.agentName} agent reviewed ${prMark(reviewedPr.provider)}${reviewedPr.number}: ${verdict}`,
        'Development',
      );
    });
  }, [isPrReview, job?.status, job?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return { isPrReview, reviewedPr };
}
