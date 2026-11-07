import { Suspense } from 'react';
import AuthPage from '@/client/Auth';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Suspense><AuthPage mode="reset" token={token} /></Suspense>;
}
