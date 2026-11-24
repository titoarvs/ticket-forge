import Link from 'next/link';
import { Footer } from '@/client/Footer';
import { I } from '@/client/icons';

// Public pages (landing, pricing, legal): no app shell, no sign-in needed, rendered on the server.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mk">
      <header className="mk-head">
        <Link href="/" className="mk-brand">
          <span className="brand-mark" dangerouslySetInnerHTML={{ __html: I.logo }} />
          TicketForge
        </Link>
        <nav className="mk-nav" aria-label="Main">
          <Link href="/#features">Features</Link>
          <Link href="/#how">How it works</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/timeline">Timeline</Link>
        </nav>
        <span className="mk-spacer" />
        <Link href="/login" className="mk-link">
          Sign in
        </Link>
        <Link href="/signup" className="btn primary">
          Get started
        </Link>
      </header>
      <main className="mk-main">{children}</main>
      <Footer />
    </div>
  );
}
