import { api, authed } from '@/lib/server/http';
import { publicAgents } from '@/lib/agents';

// The agent catalog for anyone signed in (the epic panel and the code window hire from it). Settings are changed in
// Administration → Agents (/api/admin/agents).
export const GET = api(async () => {
  await authed();
  return publicAgents();
});
