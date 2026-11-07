import AdminPage from '@/client/Admin';

export default async function Page({ params }: { params: Promise<{ tab?: string[] }> }) {
  const { tab } = await params;
  return <AdminPage tab={tab?.[0] || 'users'} />;
}
