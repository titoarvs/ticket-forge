import { PaymentStepPage } from '@/client/Checkout';

export default async function Page({ params }: { params: Promise<{ method: string }> }) {
  const { method } = await params;
  return <PaymentStepPage method={method} />;
}
