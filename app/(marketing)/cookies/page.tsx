import type { Metadata } from 'next';
import { LegalPage } from '../legal-page';

export const metadata: Metadata = { title: 'Cookie Notice · TicketForge' };
export default function Page() {
  return <LegalPage doc="cookies" />;
}
