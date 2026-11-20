import { Suspense } from 'react';
import type { Metadata } from 'next';
import AuthPage from '@/client/Auth';

export const metadata: Metadata = { title: 'Get started · TicketForge' };
export default async function Page() {
  return (
    <Suspense>
      <AuthPage mode="signup" />
    </Suspense>
  );
}
