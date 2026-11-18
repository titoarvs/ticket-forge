import type { Metadata } from 'next';
import { LegalPage } from '../legal-page';

export const metadata: Metadata = { title: 'Terms of Use · TicketForge' };
export default function Page() {
  return <LegalPage doc="terms" />;
}
