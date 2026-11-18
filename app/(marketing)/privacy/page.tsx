import type { Metadata } from 'next';
import { LegalPage } from '../legal-page';

export const metadata: Metadata = { title: 'Privacy Policy · TicketForge' };
export default function Page() {
  return <LegalPage doc="privacy" />;
}
