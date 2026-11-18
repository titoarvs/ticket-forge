import type { Metadata } from 'next';
import { ProductTimeline } from '@/client/ProductTimeline';

export const metadata: Metadata = {
  title: 'Product timeline · TicketForge',
  description: 'How TicketForge grew, day by day: every feature, from documents-to-backlog to AI agents that write code.',
};

export default function Page() {
  return <ProductTimeline />;
}
