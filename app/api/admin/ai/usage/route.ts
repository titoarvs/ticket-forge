import { api, perm, authed } from '@/lib/server/http';
import { usageReport, usageCsv, taskAverage } from '@/lib/aiusage';

// GET ?days=30 → the usage report · ?format=csv → every call as CSV · ?estimate=<task> (any signed-in user) → the
// average tokens and cost of one call of that task, for estimates before big jobs.
export const GET = api(async (req) => {
  const sp = new URL(req.url).searchParams;
  if (sp.get('estimate')) {
    await authed();
    return taskAverage(sp.get('estimate'));
  }
  await perm('users.manage');
  const days = Number(sp.get('days')) || 30;
  if (sp.get('format') === 'csv') {
    return new Response(await usageCsv(days), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="ai-usage-last-${days}-days.csv"`,
      },
    });
  }
  return usageReport(days);
});
