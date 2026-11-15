import Link from 'next/link';
import { Footer } from '@/client/Footer';

// Public pages (landing, pricing, legal): no app shell, no sign-in needed, rendered on the server.
const LOGO = "<svg viewBox='0 0 32 32' width='22' height='22'><rect width='32' height='32' rx='7' fill='#0c66e4'/><path d='M8 9h16v4h-6v11h-4V13H8z' fill='white'/></svg>";
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mk">
      <header className="mk-head">
        <Link href="/" className="mk-brand"><span dangerouslySetInnerHTML={{ __html: LOGO }} />TicketForge</Link>
        <nav className="mk-nav" aria-label="Main">
          <Link href="/#features">Features</Link>
          <Link href="/#how">How it works</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/timeline">Timeline</Link>
        </nav>
        <span className="mk-spacer" />
        <Link href="/login" className="mk-link">Sign in</Link>
        <Link href="/signup" className="btn primary">Get started</Link>
      </header>
      <main className="mk-main">{children}</main>
      <Footer />
    </div>
  );
}
