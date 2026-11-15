// Release notes (/release-notes): every deployed version, newest first, each with its features as bullet points.
// A version with no features says so. Plain server-rendered HTML, readable by everyone, signed in or not.
import type { ReleaseNotes as Notes } from '@/lib/release-notes';

const dateLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' });

export function ReleaseNotesList({ releases }: { releases: Notes[] }) {
  return (
    <article className="legal rn">
      <h1>Release notes</h1>
      <p className="muted">Everything delivered in each version of TicketForge, newest first.</p>
      {!releases.length && <p>No releases yet.</p>}
      {releases.map((r) => (
        <section key={r.version} className="rn-release" aria-labelledby={`v-${r.version}`}>
          <h2 id={`v-${r.version}`}>Version {r.version} <time className="muted small" dateTime={r.date}>{dateLabel(r.date)}</time></h2>
          {r.features.length
            ? <ul>{r.features.map((f, i) => <li key={`${i}-${f}`}>{f}</li>)}</ul>
            : <p className="muted">No new features in this release.</p>}
        </section>))}
    </article>
  );
}
