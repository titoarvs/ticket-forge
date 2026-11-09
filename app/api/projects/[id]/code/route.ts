import { api, authed, body, HttpError, appUrl } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { SERVERLESS, currentContext } from '@/lib/db.js';
import { startJob, getJob, jobForTicket, jobDiff, followUp, cancelJob, discardJob, openPullRequest, reviewJob } from '@/lib/devagent.js';
import { publicAgents, CODE_AGENT_IDS } from '@/lib/agents.js';
import { getProjectSecret } from '@/lib/secrets.js';

// Code generation and pull requests for an issue (local only): TicketForge agents (lib/agents.js) run as Claude Code
// agents in a git worktree of the project's repo.
async function guard(p: any, perms: string[]) {
  const user = await authed();
  store.requireAccess(user, p.id);
  if (SERVERLESS || !(currentContext() as any).local) throw new HttpError(400, 'Writing code needs TicketForge running on your computer (opened at localhost), next to the project’s local repository.');
  const missing = perms.filter((x) => !store.has(user, x));
  if (missing.length) throw new HttpError(403, `You don't have permission to do this (${missing.join(', ')}).`);
  return user;
}

export const GET = api(async (req, p) => {
  await guard(p, []);
  const sp = new URL(req.url).searchParams;
  const id = sp.get('jobId');
  if (id && sp.get('diff')) return new Response(await jobDiff(id, sp.get('file') || ''), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (id) { const j = getJob(id, Number(sp.get('since') || 0)); if (!j || j.projectId !== p.id) throw new HttpError(404, 'That code job is gone (the server restarted).'); return j; }
  const { agents } = await publicAgents();
  return { job: jobForTicket(p.id, String(sp.get('ticketId') || '')), agents: agents.filter((a: any) => CODE_AGENT_IDS.includes(a.id) || a.id === 'review-panel') };
});

export const POST = api(async (req, p) => {
  const b = await body(req);
  const own = (id: string) => { const j = getJob(id); if (!j || j.projectId !== p.id) throw new HttpError(404, 'That code job is gone (the server restarted).'); return j; };
  if (b.action === 'start') {
    const user = await guard(p, ['ai.use', 'issue.edit']);
    const project = await store.getProject(p.id);
    const dev = project.dev || {};
    if (!dev.localPath) throw new HttpError(400, 'Set the local repository folder in Project settings → Code & GitHub first.');
    const ticket = project.tickets.find((t: any) => t.id === b.ticketId);
    if (!ticket) throw new HttpError(404, 'That issue isn’t saved yet. Try again in a moment.');
    return startJob({ projectId: p.id, ticket, dev, instructions: String(b.instructions || '').slice(0, 4000), user, agentId: String(b.agentId || 'build') });
  }
  if (b.action === 'follow') { await guard(p, ['ai.use', 'issue.edit']); own(b.jobId); return followUp(b.jobId, String(b.text || '').slice(0, 4000)); }
  if (b.action === 'review') { await guard(p, ['ai.use']); own(b.jobId); return reviewJob(b.jobId, { panel: Boolean(b.panel) }); }
  if (b.action === 'cancel') { await guard(p, ['issue.edit']); own(b.jobId); return cancelJob(b.jobId); }
  if (b.action === 'discard') { await guard(p, ['issue.edit']); own(b.jobId); return discardJob(b.jobId); }
  if (b.action === 'pr') {
    await guard(p, ['issue.edit']);
    const j = own(b.jobId);
    const link = `${appUrl(req)}/p/${p.id}/backlog?issue=${encodeURIComponent(j.ticketId)}`;
    return openPullRequest(b.jobId, { title: b.title, body: b.body, draft: b.draft, token: await getProjectSecret(p.id, 'githubToken'), appLink: link });
  }
  throw new HttpError(400, 'Unknown action');
});
