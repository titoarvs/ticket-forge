// Release notes: one entry per deployed version. The features of a release are not typed in here. They are the product
// timeline entries (lib/timeline.ts) dated after the previous release and up to this release's date, so a feature
// added to the timeline when it is delivered shows up in the next release's notes by itself.
import { TIMELINE } from './timeline';

export type Release = { version: string; date: string };
export type ReleaseNotes = Release & { features: string[] };

/** Deployed versions, oldest first. Add a line when a new version is deployed (keep in step with package.json). */
export const RELEASES: Release[] = [
  { version: '0.1.0', date: '2026-11-09' },
  { version: '0.2.0', date: '2026-11-12' },
  { version: '1.0.0', date: '2026-11-15' },
  { version: '1.0.1', date: '2026-11-16' },
];

/** Every release with its feature titles (major and minor), newest release first. */
export function releaseNotes(releases: Release[] = RELEASES, entries: { date: string; title: string }[] = TIMELINE): ReleaseNotes[] {
  const sorted = [...releases].sort((a, b) => a.date.localeCompare(b.date));
  return sorted
    .map((r, i) => {
      const from = sorted[i - 1]?.date ?? '';
      const features = entries.filter((e) => e.date > from && e.date <= r.date).map((e) => e.title);
      return { ...r, features };
    })
    .reverse();
}
