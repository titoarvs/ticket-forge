'use client';

// Releases (Jira "versions"): plan what ships together. Each version has a name, dates and a
// description; issues get it as their Fix version. The list shows each version's progress, the
// detail its issues, what still blocks the release (open issues, open pull requests, failing tests)
// and release notes. Releasing a version asks where its unfinished issues go.

export { releaseIssues, ReleaseModal } from './Releases/ReleaseModal';
export { releaseNotes } from './Releases/release-notes';
export { Releases } from './Releases/Releases';
