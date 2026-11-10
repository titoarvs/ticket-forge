import { api, perm, body } from '@/lib/server/http';
import { publicAgents, saveAgentSettings } from '@/lib/agents.js';

// Administration → Agents: what each TicketForge agent does, and the administrator's settings for it
// (on/off, Claude model, effort, extra instructions added to its prompt).
export const GET = api(async () => { await perm('users.manage'); return publicAgents(); });
export const PUT = api(async (req) => {
  const user = await perm('users.manage');
  const b = await body(req);
  await saveAgentSettings(user, b.agents || {});
  return publicAgents();
});
