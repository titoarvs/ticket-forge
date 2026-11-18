import type { Metadata } from 'next';
import { ReleaseNotesList } from '@/client/ReleaseNotes';
import { releaseNotes } from '@/lib/release-notes';

export const metadata: Metadata = {
  title: 'Release notes · TicketForge',
  description: 'Every feature delivered in each version of TicketForge.',
};

export default function Page() {
  return <ReleaseNotesList releases={releaseNotes()} />;
}
