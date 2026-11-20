'use client';

// Pull requests: every pull / merge request linked to the project's issues in one place. Each shows
// what GitHub / GitLab says (checks, reviews, conflicts, size, comments, description) and the AI
// review; "Needs attention" filters pick out failing checks, requested changes, conflicts,
// unreviewed and ready-to-merge requests. Rows expand into details. AI actions: Review with AI
// (read-only) and Update with AI. Open requests refresh by themselves when stale.

export { PullRequests } from './PullRequests/PullRequests';
