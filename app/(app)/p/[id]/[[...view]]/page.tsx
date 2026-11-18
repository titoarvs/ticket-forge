import { Suspense } from 'react';
import Workspace from '@/client/Workspace';

export default async function Page({ params }: { params: Promise<{ id: string; view?: string[] }> }) {
  const { id, view } = await params;
  return (
    <Suspense>
      <Workspace id={id} view={view?.[0] || 'backlog'} />
    </Suspense>
  );
}
