import { api, authed, body, HttpError, appUrl } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { SERVERLESS, currentContext } from '@/lib/db.js';
import { startJob, getJob, jobForTicket, jobsForTicket, backendSummary, jobDiff, followUp, cancelJob, discardJob, openPullRequest, commitLocal, reviewJob } from '@/lib/devagent.js';
import { publicAgents, CODE_AGENT_IDS } from '@/lib/agents.js';
import { getProjectSecret } from '@/lib/secrets.js';
import { ardContext } from '@/lib/ard.js';
import { markdownToDocx } from '@/lib/md-docx.js';

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

// The project's backend repository (Project settings → Code & GitHub): its own repo, pull/merge requests like the frontend.
const backendDev = (project: any) => (project.devBackend?.enabled && project.devBackend?.localPath ? { draft: project.dev?.draft, ...project.devBackend } : null);
/** Tells the agent which half of the app this repository is, when the project has both. */
function sideNote(project: any, ticket: any, side: string) {
  const be = backendDev(project);
  if (!be) return '';
  const fe = project.dev || {};
  const name = (d: any) => d.repo || d.localPath;
  if (side === 'backend') return `REPOSITORY: this is the BACKEND of the project (${name(be)}). Implement only the server side: endpoints, data and migrations, validation, permissions, background jobs, and their tests. The frontend is a separate repository (${name(fe)}) handled by a separate job: don't write UI code. At the end, list every API you added or changed (method, path, request, response, errors) so the frontend can use it.`;
  const done = ticket.layer === 'both' ? backendSummary(project.id, ticket.id) : null;
  return `REPOSITORY: this is the FRONTEND of the project (${name(fe)}). Build only the user interface and its calls to the API. The backend is a separate repository (${name(be)}) handled by a separate job: don't implement server logic here; call the API as described${done ? '' : ' in the issue, and say in your summary which endpoints the UI expects'}.${done ? `\n\nThe backend part of this issue is already done (branch ${done.branch}). Its summary, including the API:\n${String(done.summary).slice(0, 6000)}` : ''}`;
}

export const GET = api(async (req, p) => {
  await guard(p, []);
  const sp = new URL(req.url).searchParams;
  const id = sp.get('jobId');
  if (id && sp.get('diff')) return new Response(await jobDiff(id, sp.get('file') || ''), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (id) { const j = getJob(id, Number(sp.get('since') || 0)); if (!j || j.projectId !== p.id) throw new HttpError(404, 'That code job is gone (the server restarted).'); return j; }
  const { agents } = await publicAgents();
  const project = await store.getProject(p.id);
  const ticketId = String(sp.get('ticketId') || '');
  return { job: jobForTicket(p.id, ticketId), jobs: jobsForTicket(p.id, ticketId), backend: Boolean(backendDev(project)),
    agents: agents.filter((a: any) => CODE_AGENT_IDS.includes(a.id) || a.id === 'review-panel') };
});

export const POST = api(async (req, p) => {
  const b = await body(req);
  const own = (id: string) => { const j = getJob(id); if (!j || j.projectId !== p.id) throw new HttpError(404, 'That code job is gone (the server restarted).'); return j; };
  if (b.action === 'start') {
    const user = await guard(p, ['ai.use', 'issue.edit']);
    const project = await store.getProject(p.id);
    const side = b.side === 'backend' ? 'backend' : 'frontend';
    const dev = side === 'backend' ? backendDev(project) : project.dev || {};
    if (!dev?.localPath) throw new HttpError(400, side === 'backend' ? 'Set the backend repository in Project settings → Code & GitHub first.' : 'Set the local repository folder in Project settings → Code & GitHub first.');
    const ticket = project.tickets.find((t: any) => t.id === b.ticketId);
    if (!ticket) throw new HttpError(404, 'That issue isn’t saved yet. Try again in a moment.');
    const agentId = String(b.agentId || 'build');
    const context = [sideNote(project, ticket, side), agentId === 'architecture-record' ? await ardContext(project, ticket) : ''].filter(Boolean).join('\n\n');
    return startJob({ projectId: p.id, ticket, dev, instructions: String(b.instructions || '').slice(0, 4000), user, agentId, context, side });
  }
  if (b.action === 'docx') { // a read-only agent's report (e.g. the Architecture Record Design) as a Word document
    await guard(p, ['export']);
    const j = own(b.jobId);
    if (!j.summary) throw new HttpError(400, 'This job has no report to download yet.');
    const title = String(j.summary.match(/^#\s+(.+)$/m)?.[1] || `${j.agentName} - ${j.ticketKey}`).replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 120);
    const buf = await markdownToDocx(j.summary, { title });
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="report.docx"; filename*=UTF-8''${encodeURIComponent(title)}.docx`, 'Content-Length': String(buf.length), 'Cache-Control': 'no-store' } });
  }
  if (b.action === 'follow') { await guard(p, ['ai.use', 'issue.edit']); own(b.jobId); return followUp(b.jobId, String(b.text || '').slice(0, 4000)); }
  if (b.action === 'review') { await guard(p, ['ai.use']); own(b.jobId); return reviewJob(b.jobId, { panel: Boolean(b.panel), agent: String(b.agent || 'review') }); }
  if (b.action === 'commit') { await guard(p, ['issue.edit']); own(b.jobId); return commitLocal(b.jobId, { title: String(b.title || ''), appLink: `${appUrl(req)}/p/${p.id}/backlog` }); }
  if (b.action === 'cancel') { await guard(p, ['issue.edit']); own(b.jobId); return cancelJob(b.jobId); }
  if (b.action === 'discard') { await guard(p, ['issue.edit']); own(b.jobId); return discardJob(b.jobId); }
  if (b.action === 'pr') {
    await guard(p, ['issue.edit']);
    const j = own(b.jobId);
    const link = `${appUrl(req)}/p/${p.id}/backlog?issue=${encodeURIComponent(j.ticketId)}`;
    return openPullRequest(b.jobId, { title: b.title, body: b.body, draft: b.draft, token: await getProjectSecret(p.id, 'githubToken'), gitlabToken: await getProjectSecret(p.id, 'gitlabToken'), appLink: link });
  }
  throw new HttpError(400, 'Unknown action');
});
