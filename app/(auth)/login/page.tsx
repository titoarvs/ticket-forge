import { Suspense } from 'react';
import AuthPage from '@/client/Auth';

export default async function Page() {
  return <Suspense><AuthPage mode="login" /></Suspense>;
}
