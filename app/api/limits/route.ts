import { api, perm } from '@/lib/server/http';
import { effectivePlan, usage, billingOn, limitRows } from '@/lib/limits';
import { copilotLimits } from '@/lib/claude';

// Administration → Limits: the workspace's plan limits (hosted service only) and GitHub Copilot's
// limits (this computer only).
export const GET = api(async () => {
  const u: any = await perm('users.manage');
  const plan = billingOn() ? await effectivePlan(u.workspace_id) : null;
  return {
    enabled: billingOn(),
    plan: plan && {
      id: plan.id,
      name: plan.name,
      source: plan.source,
      rows: limitRows(plan, await usage(u.workspace_id)),
    },
    copilot: await copilotLimits(),
  };
});
