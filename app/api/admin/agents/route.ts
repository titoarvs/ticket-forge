import { api, perm, body, HttpError, aiOpts } from '@/lib/server/http';
import { publicAgents, saveAgentSettings, saveCustomAgent, removeCustomAgent, generateAgentMd, parseAgentMd } from '@/lib/agents.js';

// Administration → Agents: what each TicketForge agent does, the administrator's settings for it (on/off, Claude model,
// effort, extra instructions), and custom agents defined as Markdown (written by AI from a description, or pasted).
export const GET = api(async () => { await perm('users.manage'); return publicAgents(); });
export const PUT = api(async (req) => {
  const user = await perm('users.manage');
  const b = await body(req);
  await saveAgentSettings(user, b.agents || {});
  return publicAgents();
});
// { action: 'generate', description, kind } → { md } · { action: 'check', md } → { agent } · { action: 'save', id?, md } → catalog
export const POST = api(async (req) => {
  const user = await perm('users.manage');
  const b = await body(req);
  if (b.action === 'generate') {
    if (!String(b.description || '').trim()) throw new HttpError(400, 'Describe what the agent should do.');
    return { md: await generateAgentMd({ description: String(b.description), kind: String(b.kind || ''), ai: aiOpts(b) }) };
  }
  if (b.action === 'check') return { agent: parseAgentMd(String(b.md || '')) };
  if (b.action === 'save') { const id = await saveCustomAgent(user, { id: b.id ? String(b.id) : undefined, md: String(b.md || '') }); return { id, ...(await publicAgents()) }; }
  throw new HttpError(400, 'Unknown action.');
});
export const DELETE = api(async (req) => {
  const user = await perm('users.manage');
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^custom-[a-z0-9-]+$/.test(id)) throw new HttpError(400, 'Only custom agents can be removed.');
  await removeCustomAgent(user, id);
  return publicAgents();
});
