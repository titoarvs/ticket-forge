import { after } from 'next/server';
import { HttpError, aiOpts, appUrl, authed, api } from '@/lib/server/http';
import * as store from '@/lib/store';
import { SERVERLESS, currentContext } from '@/lib/db';
import {
  backendSummary,
  remoteInfo,
  issueContext,
  jobForTicket,
  apiContract,
  startJob,
  jobDiff,
  getJob,
  compareJob,
  listJobs,
  queueInfo,
  jobsForTicket,
} from '@/lib/devagent';
import { compareTarget } from '@/lib/codecompare';
import { publicAgents, requireRole, agentForRole } from '@/lib/agents';
import { codeTask, writePrText } from '@/lib/devagent';
import {
  isRemoteId,
  loadJob,
  publicRemote,
  approveRemote,
  mergeRemote,
  requiredApprovals,
  cancelRemote,
  followRemote,
  discardRemote,
  prRemote,
} from '@/lib/remote-jobs';
import {
  remoteMode,
  localHere,
  userOk,
  remoteDev,
  startRemoteFor,
  withApprovals,
  ghFor,
  brainFor,
  FINISHED_CODE,
  alreadyCoded,
  remoteGet,
  specAtFor,
} from './remote';

/** POST for remote jobs. Returns undefined when the request isn't for them. */
export async function remotePost(req: Request, p: any, b: any) {
  const project: any = await store.getProject(p.id);
  const forJob = b.jobId && isRemoteId(b.jobId);
  if (
    !forJob &&
    !(remoteMode(project) && ['start', 'start-both', 'start-many'].includes(b.action))
  ) {
    if (!localHere() && !['docx'].includes(b.action) && !b.prId)
      throw new HttpError(400, 'This works only for code jobs on your computer.');
    return undefined;
  }
  if (b.action === 'start' || b.action === 'start-both' || b.action === 'start-many') {
    const user = await userOk(p, ['ai.use', 'issue.edit']);
    const ids: string[] =
      b.action === 'start-many'
        ? (Array.isArray(b.ticketIds) ? b.ticketIds : []).map(String).slice(0, 50)
        : [String(b.ticketId || '')];
    const started: any[] = [],
      skipped: any[] = [];
    for (const tid of ids) {
      const ticket = project.tickets.find((t: any) => t.id === tid);
      if (!ticket) {
        skipped.push({ key: tid, reason: 'not saved yet' });
        continue;
      }
      const both =
        remoteDev(project, 'backend') && (b.action === 'start-both' || ticket.layer === 'both');
      const sides = both
        ? ['backend', 'frontend']
        : [
            b.side === 'backend' ||
            (b.action === 'start-many' &&
              ticket.layer === 'backend' &&
              remoteDev(project, 'backend'))
              ? 'backend'
              : 'frontend',
          ];
      for (const side of sides) {
        try {
          started.push(
            await startRemoteFor(project, ticket, {
              side,
              user,
              instructions: String(b.instructions || '').slice(0, 4000),
              agentId: b.agentId ? String(b.agentId) : '',
              ai: aiOpts(b),
            }),
          );
        } catch (e: any) {
          if (b.action === 'start') throw e;
          skipped.push({ key: ticket.key, reason: e.message });
        }
      }
    }
    if (b.action === 'start') return started[0];
    if (b.action === 'start-both')
      return { jobs: Object.fromEntries(started.map((j: any) => [j.side, j])), contract: '' };
    return { started, skipped, queue: { max: 'GitHub' } };
  }
  // Approving and merging (TF-123): any member of the workspace who can open the project, no extra
  // permission.
  if (b.action === 'approve' || b.action === 'merge') {
    const member = await userOk(p, []);
    const job = await loadJob(String(b.jobId));
    if (!job || job.projectId !== p.id) throw new HttpError(404, 'That code job is gone.');
    if (b.action === 'approve')
      return withApprovals(project, publicRemote(await approveRemote(job, member)));
    return withApprovals(
      project,
      publicRemote(
        await mergeRemote(job, {
          user: member,
          required: requiredApprovals(project),
          gh: () => ghFor(project, remoteDev(project, job.side)),
        }),
      ),
    );
  }
  const user = await userOk(p, b.action === 'prDraft' ? ['ai.use'] : ['issue.edit']);
  const j = await loadJob(String(b.jobId));
  if (!j || j.projectId !== p.id) throw new HttpError(404, 'That code job is gone.');
  const dev = remoteDev(project, j.side);
  // Stop must work even when GitHub isn't reachable right now.
  if (b.action === 'cancel') return publicRemote(await cancelRemote(j));
  const gh = await ghFor(project, dev);
  if (b.action === 'follow') {
    if (!store.has(user, 'ai.use'))
      throw new HttpError(403, 'You don’t have permission to do this (ai.use).');
    const ticket = project.tickets.find((t: any) => t.id === j.ticketId) || {
      id: j.ticketId,
      key: j.ticketKey,
      title: j.ticketKey,
    };
    const task: any = await codeTask({
      ticket,
      agentId: j.agentId,
      instructions: String(b.text || '').slice(0, 4000),
      round: (j.rounds || 1) + 1,
      dev,
      previousSummary: j.summary,
    });
    task.agentId = j.agentId;
    task.commitTitle = String(b.text || '')
      .split('\n')[0]
      .slice(0, 80);
    return publicRemote(
      await followRemote(j, {
        gh,
        task,
        user,
        text: String(b.text || '').slice(0, 4000),
        ai: aiOpts(b),
        defer: (fn: any) => after(fn),
      }),
    );
  }
  if (b.action === 'discard') return publicRemote(await discardRemote(j, gh));
  if (b.action === 'prDraft') {
    const ticket = project.tickets.find((t: any) => t.id === j.ticketId) || {
      key: j.ticketKey,
      title: j.ticketKey,
    };
    return writePrText({
      ticket,
      diff: String(j.diff || ''),
      summary: j.summary,
      side: j.side === 'backend' ? 'backend' : '',
      provider: 'GitHub',
      appLink: `${appUrl(req)}/p/${p.id}/backlog`,
      ai: aiOpts(b),
    });
  }
  if (b.action === 'pr') {
    const ticket = project.tickets.find((t: any) => t.id === j.ticketId) || {
      key: j.ticketKey,
      title: j.ticketKey,
    };
    const link = `${appUrl(req)}/p/${p.id}/backlog?issue=${encodeURIComponent(j.ticketId)}`;
    const body =
      String(b.body || '').trim() ||
      [
        `Implements **${ticket.key}: ${ticket.title}** (${link}).`,
        ticket.userStory,
        ticket.acceptanceCriteria?.length
          ? `### Acceptance criteria\n${ticket.acceptanceCriteria.map((a: string) => `- ${a}`).join('\n')}`
          : '',
        j.summary ? `### What the agent did\n${String(j.summary).slice(0, 20000)}` : '',
        '_Written by the TicketForge agent; reviewed in TicketForge._',
      ]
        .filter(Boolean)
        .join('\n\n');
    const r = await prRemote(j, gh, {
      title: String(b.title || `${ticket.key}: ${ticket.title}`).slice(0, 250),
      body,
      draft: b.draft !== false,
    });
    return { job: publicRemote(await loadJob(j.id)), ...r };
  }
  throw new HttpError(
    400,
    'Not available for code jobs on the deployed TicketForge yet (reviews, CodeRabbit and local commits need TicketForge on your computer).',
  );
}
// Code generation and pull requests for an issue (local only): TicketForge agents (lib/agents.ts)
// run as Claude Code agents in a git worktree of the project's repo.
export async function guard(p: any, perms: string[]) {
  const user = await authed();
  store.requireAccess(user, p.id);
  if (SERVERLESS || !(currentContext() as any).local)
    throw new HttpError(
      400,
      'Writing code needs TicketForge running on your computer (opened at localhost), next to the project’s local repository.',
    );
  const missing = perms.filter((x) => !store.has(user, x));
  if (missing.length)
    throw new HttpError(403, `You don't have permission to do this (${missing.join(', ')}).`);
  return user;
}
// The project's backend repository (Project settings → Code & GitHub): its own repo, pull/merge
// requests like the frontend.
export const backendDev = (project: any) =>
  project.devBackend?.enabled && project.devBackend?.localPath
    ? { draft: project.dev?.draft, ...project.devBackend }
    : null;
/** Tells the agent which half of the app this repository is, when the project has both. */
export function sideNote(project: any, ticket: any, side: string) {
  const be = backendDev(project);
  if (!be) return '';
  const fe = project.dev || {};
  const name = (d: any) => d.repo || d.localPath;
  if (side === 'backend')
    return `REPOSITORY: this is the BACKEND of the project (${name(be)}). Implement only the server side: endpoints, data and migrations, validation, permissions, background jobs, and their tests. The frontend is a separate repository (${name(fe)}) handled by a separate job: don't write UI code. At the end, list every API you added or changed (method, path, request, response, errors) so the frontend can use it.`;
  const done = ticket.layer === 'both' ? backendSummary(project.id, ticket.id) : null;
  return `REPOSITORY: this is the FRONTEND of the project (${name(fe)}). Build only the user interface and its calls to the API. The backend is a separate repository (${name(be)}) handled by a separate job: don't implement server logic here; call the API as described${done ? '' : ' in the issue, and say in your summary which endpoints the UI expects'}.${done ? `\n\nThe backend part of this issue is already done (branch ${done.branch}). Its summary, including the API:\n${String(done.summary).slice(0, 6000)}` : ''}`;
}
/**
 * Which of the project's repositories a linked pull/merge request belongs to: { side, dev } or
 * null.
 */
export async function repoForPr(project: any, pr: any) {
  const norm = (x: string) =>
    String(x || '')
      .toLowerCase()
      .replace(/\.git$/, '');
  const candidates: [string, any][] = [
    ['frontend', project.dev],
    ['backend', backendDev(project)],
  ];
  for (const [side, dev] of candidates) {
    if (!dev?.localPath) continue;
    const r = await remoteInfo(dev.localPath).catch(() => null);
    if (r && norm(r.path) === norm(pr.repo)) return { side, dev };
    if (dev.repo && norm(dev.repo) === norm(pr.repo)) return { side, dev };
  }
  return null;
}
/**
 * Starts the code job(s) for one issue: on the backend repository for Backend issues, on the
 * frontend for the rest, and on both in parallel for Frontend + Backend issues (with a shared API
 * contract) when `both` or the issue says so.
 */
export async function startForIssue(
  project: any,
  ticket: any,
  { both = false, instructions = '', user, ai, agentId = '' }: any,
) {
  const be = backendDev(project),
    fe = project.dev?.localPath ? project.dev : null;
  const { agents } = await publicAgents();
  // The chosen agent, else the project's agent for that repository (Administration → Agents →
  // Default agents).
  const pick = async (role: string) =>
    agentId && agents.some((a: any) => a.id === agentId && a.enabled)
      ? agentId
      : requireRole(be ? role : 'build');
  const brain = await brainFor(project, ticket, true);
  const ctx = [issueContext(project, ticket), brain.text].filter(Boolean).join('\n\n');
  const coded = (s: string) => {
    const j: any = jobForTicket(project.id, ticket.id, s);
    return j && j.kind !== 'pr-review' && FINISHED_CODE.includes(j.status);
  };
  if (be && fe && (both || ticket.layer === 'both')) {
    if (coded('backend') || coded('frontend')) throw alreadyCoded(ticket);
    const contract = await apiContract({ project, ticket, ai }).catch(() => '');
    const shared = contract
      ? `API CONTRACT (agreed before both jobs started; the backend and frontend are being built AT THE SAME TIME in separate jobs):
${contract}`
      : 'The backend and frontend are being built AT THE SAME TIME in separate jobs. Derive the API from the issue and list every endpoint in your summary.';
    const beNote = `${sideNote(project, ticket, 'backend')}\n\n${shared}${contract ? '\nImplement these endpoints exactly as written (method, path, fields, status codes), so the frontend works without changes. If the contract contradicts an endpoint that already exists, keep the existing response shape, add only the new fields, and say so at the top of your summary.' : ''}`;
    const feNote = `REPOSITORY: this is the FRONTEND of the project (${fe.repo || fe.localPath}). Build only the user interface and its calls to the API; the backend (${be.repo || be.localPath}) is a separate job running now.\n\n${shared}${contract ? "\nCall these endpoints exactly as written. Don't wait for or mock a different API. For endpoints that already exist in the app, keep reading their current response shape and only use the added fields." : ''}`;
    const [backend, frontend] = await Promise.all([
      startJob({
        projectId: project.id,
        ticket,
        dev: be,
        instructions,
        user,
        agentId: await pick('backend'),
        context: [beNote, ctx].join('\n\n'),
        side: 'backend',
        brainFiles: brain.files,
      }),
      startJob({
        projectId: project.id,
        ticket,
        dev: fe,
        instructions,
        user,
        agentId: await pick('frontend'),
        context: [feNote, ctx].join('\n\n'),
        side: 'frontend',
        brainFiles: brain.files,
      }),
    ]);
    return { jobs: { backend, frontend }, contract };
  }
  const side = be && (ticket.layer === 'backend' || !fe) ? 'backend' : 'frontend';
  const dev = side === 'backend' ? be : fe;
  if (!dev?.localPath)
    throw new HttpError(
      400,
      'Set up your own local copy of the repository first (Project settings → Code & GitHub; each person has their own folder).',
    );
  if (coded(side)) throw alreadyCoded(ticket);
  const job = await startJob({
    projectId: project.id,
    ticket,
    dev,
    instructions,
    user,
    agentId: await pick(side),
    context: [sideNote(project, ticket, side), ctx].filter(Boolean).join('\n\n'),
    side,
    brainFiles: brain.files,
  });
  return { jobs: { [side]: job } };
}
export const GET = api(async (req, p) => {
  const sp = new URL(req.url).searchParams;
  const remote = await remoteGet(p, sp);
  if (remote) return remote;
  await guard(p, []);
  const id = sp.get('jobId');
  if (id && sp.get('diff'))
    return new Response(await jobDiff(id, sp.get('file') || ''), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  if (id && sp.get('compare')) {
    // everyone with access to the project can review the changes (no extra permission)
    const j = getJob(id);
    if (!j || j.projectId !== p.id)
      throw new HttpError(404, 'That code job is gone (the server restarted).');
    return compareJob(id, compareTarget(sp.get('compare')), await specAtFor(p.id, j.ticketId));
  }
  if (sp.get('list')) return { jobs: listJobs(p.id), queue: queueInfo() };
  if (id) {
    const j = getJob(id, Number(sp.get('since') || 0));
    if (!j || j.projectId !== p.id)
      throw new HttpError(404, 'That code job is gone (the server restarted).');
    return j;
  }
  const { agents } = await publicAgents();
  const project = await store.getProject(p.id);
  const ticketId = String(sp.get('ticketId') || '');
  return {
    job: jobForTicket(p.id, ticketId),
    jobs: jobsForTicket(p.id, ticketId),
    backend: Boolean(backendDev(project)),
    agents: agents.filter(
      (a: any) => (a.runner === 'code' && !a.broken) || a.id === 'review-panel',
    ),
    roles: {
      build: await agentForRole('build'),
      frontend: await agentForRole('frontend'),
      backend: await agentForRole('backend'),
      review: await agentForRole('review'),
    },
  };
});
