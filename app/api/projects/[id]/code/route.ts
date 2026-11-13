import { api, authed, body, HttpError, appUrl, aiOpts } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { SERVERLESS, currentContext } from '@/lib/db.js';
import { codeRabbitJob, issueContext, apiContract, listJobs, queueInfo, startJob, getJob, jobForTicket, jobsForTicket, backendSummary, jobDiff, followUp, cancelJob, discardJob, openPullRequest, commitLocal, reviewJob, prDraft, pushToPullRequest, reviewComments, describePullRequest, remoteInfo, setUpdateLabel, startPrReview, postReview } from '@/lib/devagent.js';
import { publicAgents, agentForRole, requireRole } from '@/lib/agents.js';
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

/** Which of the project's repositories a linked pull/merge request belongs to: { side, dev } or null. */
async function repoForPr(project: any, pr: any) {
  const norm = (x: string) => String(x || '').toLowerCase().replace(/\.git$/, '');
  const candidates: [string, any][] = [['frontend', project.dev], ['backend', backendDev(project)]];
  for (const [side, dev] of candidates) {
    if (!dev?.localPath) continue;
    const r = await remoteInfo(dev.localPath).catch(() => null);
    if (r && norm(r.path) === norm(pr.repo)) return { side, dev };
    if (dev.repo && norm(dev.repo) === norm(pr.repo)) return { side, dev };
  }
  return null;
}

/**
 * Starts the code job(s) for one issue: on the backend repository for Backend issues, on the frontend for the rest,
 * and on both in parallel for Frontend + Backend issues (with a shared API contract) when `both` or the issue says so.
 */
async function startForIssue(project: any, ticket: any, { both = false, instructions = '', user, ai, agentId = '' }: any) {
  const be = backendDev(project), fe = project.dev?.localPath ? project.dev : null;
  const { agents } = await publicAgents();
  // The chosen agent, else the project's agent for that repository (Administration → Agents → Default agents).
  const pick = async (role: string) => (agentId && agents.some((a: any) => a.id === agentId && a.enabled) ? agentId : requireRole(be ? role : 'build'));
  const ctx = issueContext(project, ticket);
  if (be && fe && (both || ticket.layer === 'both')) {
    const contract = await apiContract({ project, ticket, ai }).catch(() => '');
    const shared = contract ? `API CONTRACT (agreed before both jobs started; the backend and frontend are being built AT THE SAME TIME in separate jobs):
${contract}` : 'The backend and frontend are being built AT THE SAME TIME in separate jobs. Derive the API from the issue and list every endpoint in your summary.';
    const beNote = `${sideNote(project, ticket, 'backend')}\n\n${shared}${contract ? '\nImplement these endpoints exactly as written (method, path, fields, status codes), so the frontend works without changes. If the contract contradicts an endpoint that already exists, keep the existing response shape, add only the new fields, and say so at the top of your summary.' : ''}`;
    const feNote = `REPOSITORY: this is the FRONTEND of the project (${fe.repo || fe.localPath}). Build only the user interface and its calls to the API; the backend (${be.repo || be.localPath}) is a separate job running now.\n\n${shared}${contract ? '\nCall these endpoints exactly as written. Don\'t wait for or mock a different API. For endpoints that already exist in the app, keep reading their current response shape and only use the added fields.' : ''}`;
    const [backend, frontend] = await Promise.all([
      startJob({ projectId: project.id, ticket, dev: be, instructions, user, agentId: await pick('backend'), context: [beNote, ctx].join('\n\n'), side: 'backend' }),
      startJob({ projectId: project.id, ticket, dev: fe, instructions, user, agentId: await pick('frontend'), context: [feNote, ctx].join('\n\n'), side: 'frontend' }),
    ]);
    return { jobs: { backend, frontend }, contract };
  }
  const side = be && (ticket.layer === 'backend' || !fe) ? 'backend' : 'frontend';
  const dev = side === 'backend' ? be : fe;
  if (!dev?.localPath) throw new HttpError(400, 'Set the local repository folder in Project settings → Code & GitHub first.');
  const job = await startJob({ projectId: project.id, ticket, dev, instructions, user, agentId: await pick(side), context: [sideNote(project, ticket, side), ctx].filter(Boolean).join('\n\n'), side });
  return { jobs: { [side]: job } };
}

export const GET = api(async (req, p) => {
  await guard(p, []);
  const sp = new URL(req.url).searchParams;
  const id = sp.get('jobId');
  if (id && sp.get('diff')) return new Response(await jobDiff(id, sp.get('file') || ''), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (sp.get('list')) return { jobs: listJobs(p.id), queue: queueInfo() };
  if (id) { const j = getJob(id, Number(sp.get('since') || 0)); if (!j || j.projectId !== p.id) throw new HttpError(404, 'That code job is gone (the server restarted).'); return j; }
  const { agents } = await publicAgents();
  const project = await store.getProject(p.id);
  const ticketId = String(sp.get('ticketId') || '');
  return { job: jobForTicket(p.id, ticketId), jobs: jobsForTicket(p.id, ticketId), backend: Boolean(backendDev(project)),
    agents: agents.filter((a: any) => (a.runner === 'code' && !a.broken) || a.id === 'review-panel'),
    roles: { build: await agentForRole('build'), frontend: await agentForRole('frontend'), backend: await agentForRole('backend'), review: await agentForRole('review') } };
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
    const agentId = String(b.agentId || await requireRole(side === 'backend' && backendDev(project) ? 'backend' : 'build'));
    const context = [sideNote(project, ticket, side), agentId === 'architecture-record' ? await ardContext(project, ticket) : issueContext(project, ticket)].filter(Boolean).join('\n\n');
    return startJob({ projectId: p.id, ticket, dev, instructions: String(b.instructions || '').slice(0, 4000), user, agentId, context, side });
  }
  // Frontend + Backend issues, both at once: one API contract first (a few seconds), then both jobs in parallel.
  if (b.action === 'start-both') {
    const user = await guard(p, ['ai.use', 'issue.edit']);
    const project = await store.getProject(p.id);
    if (!backendDev(project) || !project.dev?.localPath) throw new HttpError(400, 'Building both at once needs the frontend and backend repositories in Project settings → Code & GitHub.');
    const ticket = project.tickets.find((t: any) => t.id === b.ticketId);
    if (!ticket) throw new HttpError(404, 'That issue isn’t saved yet. Try again in a moment.');
    return startForIssue(project, ticket, { both: true, instructions: String(b.instructions || '').slice(0, 4000), user, ai: aiOpts(b) });
  }
  // Many issues at once: one job per issue (and per repository for Frontend + Backend issues). They run
  // MAX_PARALLEL at a time; the rest wait in line.
  if (b.action === 'start-many') {
    const user = await guard(p, ['ai.use', 'issue.edit']);
    const project = await store.getProject(p.id);
    if (!project.dev?.localPath && !backendDev(project)) throw new HttpError(400, 'Set the local repository folder in Project settings → Code & GitHub first.');
    const ids: string[] = (Array.isArray(b.ticketIds) ? b.ticketIds : []).map(String).slice(0, 50);
    if (!ids.length) throw new HttpError(400, 'Choose at least one issue.');
    const instructions = String(b.instructions || '').slice(0, 4000);
    const started: any[] = [], skipped: { key: string; reason: string }[] = [];
    // All at once: API contracts are written in parallel; git setup takes turns per repository (lib/devagent.js).
    await Promise.all(ids.map(async (id) => {
      const ticket = project.tickets.find((t: any) => t.id === id);
      if (!ticket) { skipped.push({ key: id, reason: 'not saved yet' }); return; }
      try {
        const r = await startForIssue(project, ticket, { instructions, user, ai: aiOpts(b), agentId: b.agentId ? String(b.agentId) : '' });
        started.push(...Object.values(r.jobs).filter(Boolean));
      } catch (e: any) { skipped.push({ key: ticket.key, reason: e.message }); }
    }));
    return { started, skipped, queue: queueInfo() };
  }
  if (b.action === 'coderabbit') {
    await guard(p, ['ai.use']);
    own(b.jobId);
    return codeRabbitJob(b.jobId, { apiKey: (await getProjectSecret(p.id, 'coderabbitKey')) || '' });
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
  // ---------------------------------------------------------------- pull requests: better text, and updating an open one
  if (b.action === 'prDraft') { await guard(p, ['ai.use']); own(b.jobId); return prDraft(b.jobId, { appLink: `${appUrl(req)}/p/${p.id}/backlog`, ai: aiOpts(b) }); }
  if (b.action === 'push') {
    await guard(p, ['issue.edit']); own(b.jobId);
    return pushToPullRequest(b.jobId, { message: String(b.message || ''), token: await getProjectSecret(p.id, 'githubToken'), gitlabToken: await getProjectSecret(p.id, 'gitlabToken') });
  }
  if (b.action === 'postReview') {
    await guard(p, ['ai.use']); own(b.jobId);
    return postReview(b.jobId, { token: await getProjectSecret(p.id, 'githubToken'), gitlabToken: await getProjectSecret(p.id, 'gitlabToken') });
  }
  if (['update', 'describe', 'comments', 'prReview'].includes(b.action)) {
    const user = await guard(p, b.action === 'comments' ? [] : b.action === 'prReview' ? ['ai.use'] : ['ai.use', 'issue.edit']);
    const project = await store.getProject(p.id);
    const ticket = project.tickets.find((t: any) => t.id === b.ticketId);
    const pr = ticket?.prs?.find((x: any) => x.id === b.prId);
    if (!ticket || !pr) throw new HttpError(404, 'That pull request isn’t linked to this issue any more.');
    const where = await repoForPr(project, pr);
    if (!where) throw new HttpError(400, `${pr.repo} isn’t this project’s repository or its backend repository (Project settings → Code & GitHub), so it can’t be updated from here.`);
    if (!pr.branch) throw new HttpError(400, 'TicketForge doesn’t know this request’s branch yet. Click refresh on it first.');
    const target = { url: pr.url, number: pr.number, branch: pr.branch, base: pr.base || where.dev.baseBranch || 'main', title: pr.title, provider: pr.provider };
    const tokens = { token: await getProjectSecret(p.id, 'githubToken'), gitlabToken: await getProjectSecret(p.id, 'gitlabToken') };
    if (b.action === 'comments') return { comments: await reviewComments({ repoPath: where.dev.localPath, target, ...tokens }) };
    if (b.action === 'prReview') return startPrReview({ projectId: p.id, ticket, dev: where.dev, target, user, side: where.side, agentId: b.agent === 'ui-review' || /^custom-[a-z0-9-]+$/.test(String(b.agent || '')) ? String(b.agent) : await requireRole('review'), focus: String(b.focus || '').slice(0, 1000) });
    if (b.action === 'describe') return describePullRequest({ repoPath: where.dev.localPath, target, ticket, side: where.side, ...tokens, appLink: `${appUrl(req)}/p/${p.id}/backlog`, ai: aiOpts(b) });
    // update: an agent works on the request's own branch; the person reviews, then pushes to the same request.
    const mode = String(b.mode || 'prompt');
    let ask = String(b.prompt || '').trim().slice(0, 6000);
    let label = 'Apply requested changes';
    if (mode === 'enhance') { label = 'Enhance tests, edge cases and error handling'; ask = `Enhance this ${pr.provider === 'GitLab' ? 'merge request' : 'pull request'} without changing what it does: add or improve automated tests for its behaviour and the issue's acceptance criteria, handle edge cases and errors it misses, and tidy names and structure where it helps a reviewer. Keep the change focused.${ask ? `\n\nAlso: ${ask}` : ''}`; }
    if (mode === 'review') {
      label = 'Address review comments';
      const cs = await reviewComments({ repoPath: where.dev.localPath, target, ...tokens });
      if (!cs.length) throw new HttpError(400, 'There are no open review comments on it.');
      ask = `Address these review comments on the ${pr.provider === 'GitLab' ? 'merge request' : 'pull request'}. Change what each asks; if you disagree with one, leave the code and say why in your summary.\n\n${cs.map((c: any, i: number) => `${i + 1}. ${c.author ? `@${c.author}` : 'Reviewer'}${c.file ? ` on ${c.file}${c.line ? `:${c.line}` : ''}` : ''}: ${c.body}`).join('\n')}${ask ? `\n\nAlso: ${ask}` : ''}`;
    }
    if (!ask) throw new HttpError(400, 'Say what to change.');
    const context = [sideNote(project, ticket, where.side), `UPDATING AN OPEN ${pr.provider === 'GitLab' ? 'MERGE' : 'PULL'} REQUEST: ${pr.url} (branch ${target.branch} → ${target.base}). The request's changes are already committed on this branch. Make only the changes asked for below; don't redo the original work.`].filter(Boolean).join('\n\n');
    const job = await startJob({ projectId: p.id, ticket, dev: where.dev, instructions: ask, user, agentId: String(b.agentId || await requireRole(where.side === 'backend' && project.devBackend?.enabled ? 'backend' : 'build')), context, side: where.side, target });
    setUpdateLabel(job.id, label);
    return job;
  }
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
