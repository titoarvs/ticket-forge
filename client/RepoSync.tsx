'use client';

// Test automation: "Sync with the repository" (lib/reposync.ts) and the Playwright run settings.
// Sync reads the project's local repository: its pages, what changed since the last sync, the test
// cases those changes affect, and features already delivered. Everything comes back as a review;
// nothing changes until you apply it.

export { RepoSyncCard } from './RepoSync/RepoSyncCard';
export { FeatureMapReview } from './RepoSync/FeatureMapReview';
export { RunSettingsCard, applyPageTests } from './RepoSync/RunSettingsCard';
