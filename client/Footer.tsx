// Links to the legal pages, on the landing page, the legal pages and the sign-in screens.
import Link from 'next/link';

export function Footer({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={`site-footer ${compact ? 'compact' : ''}`}>
      <nav aria-label="Legal">
        <Link href="/timeline">Timeline</Link>
        <Link href="/release-notes">Release notes</Link>
        <Link href="/terms">Terms of Use</Link>
        <Link href="/privacy">Privacy Policy</Link>
        <Link href="/cookies">Cookies</Link>
      </nav>
      <span className="muted">© {new Date().getFullYear()} [Company name]</span>
    </footer>
  );
}
