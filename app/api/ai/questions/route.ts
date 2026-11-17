import { api, perm, body, HttpError, aiOpts } from '@/lib/server/http';
import * as store from '@/lib/store';
import { clarifyQuestions } from '@/lib/clarify';

// The questions the AI asks before a generation or enhancement (lib/clarify.ts). Nothing is saved.
export const POST = api(async (req) => {
  const user = await perm('ai.use');
  const b = await body(req);
  let project = null;
  if (b.projectId) { await store.requireProject(user, String(b.projectId)); project = await store.getProject(String(b.projectId)); }
  if (!project && !['project'].includes(String(b.kind)) && !b.text) throw new HttpError(400, 'Open a project first.');
  const ids = new Set((Array.isArray(b.ticketIds) ? b.ticketIds : []).map(String));
  const tickets = project && ids.size ? project.tickets.filter((t: any) => ids.has(t.id)) : [];
  return clarifyQuestions({ kind: String(b.kind), project, ticket: b.ticket || null, tickets, epicId: b.epicId ? String(b.epicId) : null,
    text: String(b.text || '').slice(0, 60000), instructions: String(b.instructions || '').slice(0, 4000), ai: aiOpts(b) });
});
