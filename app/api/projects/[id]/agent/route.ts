import { api, authed, body, HttpError, aiOpts, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store';
import { runDocAgent } from '@/lib/agentdocs';
import { ensureAgent } from '@/lib/agents';
import { saveGeneratedToDrive } from '@/lib/epic-docx';

// A document agent (Kick Off, Demo, Deploy…) writes its document for one epic. Nothing is saved here: the app
// stores it on the epic, like the Problem Statement and Feature Brief.
export const maxDuration = 300;

export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  if (!store.has(user, 'ai.use') || !store.has(user, 'epic.manage')) throw new HttpError(403, 'Hiring an agent for an epic needs the AI and epic permissions.');
  const b = await body(req);
  const project = await store.getProject(p.id);
  if (!project.epics.some((e: any) => e.id === b.epicId)) throw new HttpError(404, 'That epic isn’t in this project (save first if you just created it).');
  return ndjson(req, async (send) => {
    send({ type: 'progress', message: 'Reading the epic, its documents, issues and test results…' });
    const out = await runDocAgent({ project, epicId: String(b.epicId), agentId: String(b.agentId || ''), instructions: String(b.instructions || '').slice(0, 2000), ai: aiOpts(b) });
    const epic = project.epics.find((e: any) => e.id === b.epicId);
    const agent = await ensureAgent(String(b.agentId || ''));
    const drive = await saveGeneratedToDrive({ kind: 'agent', agentId: agent.id, project, epic, user, doc: { name: agent.name, markdown: out.markdown } });
    send({ type: 'done', ...out, drive });
  });
});
