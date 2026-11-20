'use client';

// Diff review (TF-121): what a code-with-AI job changed. One file at a time, like a code review
// tool: the changed files on the left (filterable, grouped by folder), the chosen file's diff on
// the right with previous / next, and a choice of what to compare with (the repository default
// branch, the previous job run or the prior spec version).
// Split (side by side) or Unified (one column) view; a narrow panel always shows Unified and a file
// menu instead of the list. Long lines wrap, so nothing scrolls sideways. Anyone who can open the
// project sees it.

export { DIFF_TARGETS } from './DiffReview/diff-targets';
export { DiffReview } from './DiffReview/DiffReview';
