import { api, perm, body, aiOpts } from '@/lib/server/http';
import * as store from '@/lib/store';
import { planOrder } from '@/lib/devorder';

export const maxDuration = 300;

// The suggested development order of an epic's or sprint's issues (lib/devorder.ts), with a reason per issue. Nothing is
// saved here: the app shows the order and the person applies it to the backlog (a normal save of the ticket order).
export const POST = api(async (req, p) => {
  const b = await body(req);
  const smart = b.smart !== false;
  const user = smart ? await perm('ai.use') : await perm();
  store.requireAccess(user, p.id);
  return planOrder({
    project: await store.getProject(p.id),
    epicId: b.epicId ? String(b.epicId) : '',
    sprintId: b.sprintId ? String(b.sprintId) : '',
    ticketIds: Array.isArray(b.ticketIds) ? b.ticketIds.map(String).slice(0, 200) : undefined,
    ai: aiOpts(b),
    smart,
  });
});
