import { after } from 'next/server';
import { HttpError, authed } from '@/lib/server/http';
import * as store from '@/lib/store';
import { SERVERLESS, currentContext } from '@/lib/db';
import { issueContext } from '@/lib/devagent';
import { compareTarget, remoteCompare } from '@/lib/codecompare';
import { requireRole, publicAgents, agentForRole } from '@/lib/agents';
import { getProjectSecret } from '@/lib/secrets';
import { codeTask, branchFor } from '@/lib/devagent';
import { gh as ghApi } from '@/lib/gh-actions';
import { brainForCode } from '@/lib/brain';
import {
  requiredApprovals,
  remoteJobsFor,
  publicRemote,
  startRemoteJob,
  isRemoteId,
  loadJob,
  remoteDiff,
  refreshJob,
  remoteJobsForProject,
} from '@/lib/remote-jobs';
import { sideNote } from './get';

// ---------------------------------------------------------------- code jobs through the AI API and
// GitHub Deployed TicketForge (serverless, or opened from another computer) can't run Claude Code
// next to a checkout, so code jobs ask your AI provider for the change and commit it through the
// GitHub API (lib/api-code.ts). On your computer they run here with Claude Code, unless you
// switched to the API (the X-TF-Run-On header from the browser; see runPlace in client/core.ts). A
// round runs after the response (after()), so it needs the longest time Vercel allows.
export const localHere = () => !SERVERLESS && Boolean((currentContext() as any).local);
export const remoteMode = (_project?: any) =>
  !localHere() || (currentContext() as any).runOn === 'github';
export async function ghFor(project: any, dev: any) {
  const token =
    (await getProjectSecret(project.id, 'githubToken')) || process.env.GITHUB_TOKEN || '';
  if (!dev?.repo)
    throw new HttpError(
      400,
      'Choose the GitHub repository first: Project settings → Code & GitHub → Repository.',
    );
  if (!token)
    throw new HttpError(
      400,
      'Connect GitHub first (Project settings → Code & GitHub) so TicketForge can read the repository and push the branch.',
    );
  const info: any = await ghApi('GET', `repos/${dev.repo}`, { token }).catch((e: any) => {
    throw new HttpError(400, e.message);
  });
  return { token, ref: info.default_branch, defaultBranch: info.default_branch };
}
/**
 * The project brain for a code job (lib/brain.ts): the notes linked to the issue as a block for the
 * prompt, and for jobs on this computer the notes themselves as files in the worktree's
 * .ticketforge/brain/ folder (never committed).
 */
export async function brainFor(project: any, ticket: any, local: boolean) {
  const r: any = await brainForCode(project.id, ticket, { max: local ? 5000 : 7000 });
  if (!r.block) return { text: '', files: null };
  return {
    text: local
      ? `${r.block}\nMore notes about this issue are in .ticketforge/brain/ (start with README.md there): read them when you need more context. Don't edit, stage or commit that folder.`
      : r.block,
    files: local ? r.files : null,
  };
}
export async function userOk(p: any, perms: string[]) {
  const user = await authed();
  store.requireAccess(user, p.id);
  const missing = perms.filter((x) => !store.has(user, x));
  if (missing.length)
    throw new HttpError(403, `You don't have permission to do this (${missing.join(', ')}).`);
  return user;
}
/**
 * When the issue's current coding spec was generated (the "prior spec version" comparison looks at
 * runs before it), or ''.
 */
export async function specAtFor(projectId: string, ticketId: string) {
  const s = (await store.listSpecs(projectId)).specs.find((x: any) => x.ticketId === ticketId);
  return s?.generatedAt ? new Date(s.generatedAt).toISOString() : '';
}
export const remoteDev = (project: any, side: string) =>
  side === 'backend'
    ? project.devBackend?.enabled && project.devBackend?.repo
      ? { draft: project.dev?.draft, ...project.devBackend }
      : null
    : project.dev || {};
/** The job as the browser gets it, with how many approvals the project asks for (TF-123). */
export const withApprovals = (project: any, pub: any) =>
  pub && { ...pub, required: requiredApprovals(project) };
// An issue whose code is finished doesn't get a second AI job (TF-123): open the existing one, or
// discard it to start over.
export const FINISHED_CODE = ['review', 'pr', 'merged', 'committed'];
export const alreadyCoded = (ticket: any) =>
  new HttpError(
    409,
    `${ticket.key} already has finished code. Open it from the issue to review it; discard it first to write new code.`,
  );
export async function startRemoteFor(
  project: any,
  ticket: any,
  { side, user, instructions = '', agentId = '', context = '', ai }: any,
) {
  const dev = remoteDev(project, side);
  if (
    (await remoteJobsFor(project.id, ticket.id)).some(
      (j: any) => (j.side || 'frontend') === side && FINISHED_CODE.includes(j.status),
    )
  )
    throw alreadyCoded(ticket);
  if (!dev?.repo)
    throw new HttpError(
      400,
      side === 'backend'
        ? 'Set the backend repository first.'
        : 'Choose the GitHub repository first (Project settings → Code & GitHub).',
    );
  const gh = await ghFor(project, dev);
  const id =
    agentId ||
    (await requireRole(side === 'backend' && project.devBackend?.enabled ? 'backend' : 'build'));
  const brain = await brainFor(project, ticket, false);
  const ctx = [
    context ||
      [sideNote(project, ticket, side), issueContext(project, ticket)].filter(Boolean).join('\n\n'),
    brain.text,
  ]
    .filter(Boolean)
    .join('\n\n');
  const task: any = await codeTask({
    ticket,
    agentId: id,
    instructions,
    round: 1,
    context: ctx,
    dev,
  });
  task.agentId = id;
  task.commitTitle = ticket.title;
  return publicRemote(
    await startRemoteJob({
      projectId: project.id,
      ticket,
      side,
      dev,
      gh,
      task,
      branch: branchFor(ticket, dev),
      user,
      base: dev.baseBranch || gh.defaultBranch,
      ai,
      defer: (fn: any) => after(fn),
    }),
  );
}
/**
 * GET for remote jobs (job, diff, list, an issue's jobs). Returns null when the request isn't for
 * them.
 */
export async function remoteGet(p: any, sp: URLSearchParams) {
  const project: any = await store.getProject(p.id);
  const id = sp.get('jobId');
  if (id && !isRemoteId(id)) return null;
  if (!id && !remoteMode(project)) return null;
  await userOk(p, []);
  if (id) {
    let j = await loadJob(id);
    if (!j || j.projectId !== p.id) throw new HttpError(404, 'That code job is gone.');
    if (sp.get('diff'))
      return new Response(remoteDiff(j, sp.get('file') || ''), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    if (sp.get('compare')) {
      const target = compareTarget(sp.get('compare'));
      const dev = remoteDev(project, j.side);
      // Without a GitHub connection, the stored diff still answers "default", and "job" / "spec"
      // can still say there is nothing earlier to compare with (remoteCompare explains the rest).
      const gh = await ghFor(project, dev).catch(() => null);
      return remoteCompare(j, target, {
        token: gh?.token || '',
        defaultBranch: gh?.defaultBranch || j.base,
        jobs: await remoteJobsFor(p.id, j.ticketId),
        specAt: await specAtFor(p.id, j.ticketId),
        stored: remoteDiff(j, ''),
      });
    }
    if (['starting', 'queued', 'running'].includes(j.status))
      j = await refreshJob(j).catch(() => j);
    return withApprovals(project, publicRemote(j, Number(sp.get('since') || 0)));
  }
  if (sp.get('list')) {
    const jobs = await remoteJobsForProject(p.id);
    return {
      jobs: jobs.map((j: any) => ({
        ...publicRemote(j),
        log: undefined,
        last: j.log?.[j.log.length - 1]?.text || '',
      })),
      queue: {
        running: jobs.filter((j: any) => ['queued', 'running'].includes(j.status)).length,
        waiting: 0,
        max: 'GitHub',
      },
    };
  }
  const ticketId = String(sp.get('ticketId') || '');
  const all = ticketId ? await remoteJobsFor(p.id, ticketId) : [];
  const newest = (side: string) =>
    withApprovals(project, publicRemote(all.find((j: any) => (j.side || 'frontend') === side))) ||
    null;
  const { agents } = await publicAgents();
  return {
    remote: true,
    job: newest('frontend'),
    jobs: { frontend: newest('frontend'), backend: newest('backend') },
    backend: Boolean(remoteDev(project, 'backend')),
    agents: agents.filter((a: any) => a.runner === 'code' && !a.broken && a.writes),
    roles: {
      build: await agentForRole('build'),
      frontend: await agentForRole('frontend'),
      backend: await agentForRole('backend'),
      review: null,
    },
  };
}
