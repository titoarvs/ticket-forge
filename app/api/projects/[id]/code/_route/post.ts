import { HttpError, aiOpts, api, body, appUrl } from '@/lib/server/http';
import * as store from '@/lib/store';
import {
  listJobs,
  getJob,
  jobForTicket,
  issueContext,
  startJob,
  queueInfo,
  codeRabbitJob,
  followUp,
  reviewJob,
  prDraft,
  pushToPullRequest,
  postReview,
  reviewComments,
  startPrReview,
  describePullRequest,
  setUpdateLabel,
  commitLocal,
  cancelJob,
  discardJob,
  openPullRequest,
} from '@/lib/devagent';
import { checkParallel } from '@/lib/parallel';
import { requireRole } from '@/lib/agents';
import { getProjectSecret } from '@/lib/secrets';
import { markdownToDocx } from '@/lib/md-docx';
import { remoteJobsForProject } from '@/lib/remote-jobs';
import { userOk, localHere, FINISHED_CODE, alreadyCoded, brainFor } from './remote';
import { remotePost, guard, backendDev, sideNote, startForIssue, repoForPr } from './get';

/**
 * Before code jobs start on several issues: which of them touch the same files or modules (coding
 * specs), collide with code jobs already running or not merged, or are blocked by another selected
 * issue, split into rounds (lib/parallel.ts).
 * Works for jobs on this computer and through GitHub alike. Nothing starts here.
 */
async function planParallelFor(p: any, b: any) {
  await userOk(p, b.smart === false ? [] : ['ai.use']);
  const project: any = await store.getProject(p.id);
  const ids: string[] = (Array.isArray(b.ticketIds) ? b.ticketIds : []).map(String).slice(0, 50);
  if (!ids.length) throw new HttpError(400, 'Choose at least one issue.');
  const [{ specs }, remote] = await Promise.all([
    store.listSpecs(p.id),
    remoteJobsForProject(p.id).catch(() => []),
  ]);
  const jobs = [...(localHere() ? listJobs(p.id) : []), ...remote];
  return checkParallel({
    project,
    ticketIds: ids,
    specs,
    jobs,
    ai: aiOpts(b),
    smart: b.smart !== false,
  });
}
export const POST = api(async (req, p) => {
  const b = await body(req);
  if (b.action === 'plan-parallel') return planParallelFor(p, b);
  const remote = await remotePost(req, p, b);
  if (remote !== undefined) return remote;
  const own = (id: string) => {
    const j = getJob(id);
    if (!j || j.projectId !== p.id)
      throw new HttpError(404, 'That code job is gone (the server restarted).');
    return j;
  };
  if (b.action === 'start') {
    const user = await guard(p, ['ai.use', 'issue.edit']);
    const project = await store.getProject(p.id);
    const side = b.side === 'backend' ? 'backend' : 'frontend';
    const dev = side === 'backend' ? backendDev(project) : project.dev || {};
    if (!dev?.localPath)
      throw new HttpError(
        400,
        side === 'backend'
          ? 'Set up your own local copy of the backend repository first (Project settings → Code & GitHub).'
          : 'Set up your own local copy of the repository first (Project settings → Code & GitHub; each person has their own folder).',
      );
    const ticket = project.tickets.find((t: any) => t.id === b.ticketId);
    if (!ticket) throw new HttpError(404, 'That issue isn’t saved yet. Try again in a moment.');
    const prev: any = jobForTicket(p.id, ticket.id, side);
    if (prev && prev.kind !== 'pr-review' && FINISHED_CODE.includes(prev.status))
      throw alreadyCoded(ticket);
    const agentId = String(
      b.agentId ||
        (await requireRole(side === 'backend' && backendDev(project) ? 'backend' : 'build')),
    );
    const brain = await brainFor(project, ticket, true);
    const context = [sideNote(project, ticket, side), issueContext(project, ticket), brain.text]
      .filter(Boolean)
      .join('\n\n');
    return startJob({
      projectId: p.id,
      ticket,
      dev,
      instructions: String(b.instructions || '').slice(0, 4000),
      user,
      agentId,
      context,
      side,
      brainFiles: brain.files,
    });
  }
  // Frontend + Backend issues, both at once: one API contract first (a few seconds), then both jobs
  // in parallel.
  if (b.action === 'start-both') {
    const user = await guard(p, ['ai.use', 'issue.edit']);
    const project = await store.getProject(p.id);
    if (!backendDev(project) || !project.dev?.localPath)
      throw new HttpError(
        400,
        'Building both at once needs the frontend and backend repositories in Project settings → Code & GitHub.',
      );
    const ticket = project.tickets.find((t: any) => t.id === b.ticketId);
    if (!ticket) throw new HttpError(404, 'That issue isn’t saved yet. Try again in a moment.');
    return startForIssue(project, ticket, {
      both: true,
      instructions: String(b.instructions || '').slice(0, 4000),
      user,
      ai: aiOpts(b),
    });
  }
  // Many issues at once: one job per issue (and per repository for Frontend + Backend issues). They
  // run MAX_PARALLEL at a time; the rest wait in line.
  if (b.action === 'start-many') {
    const user = await guard(p, ['ai.use', 'issue.edit']);
    const project = await store.getProject(p.id);
    if (!project.dev?.localPath && !backendDev(project))
      throw new HttpError(
        400,
        'Set up your own local copy of the repository first (Project settings → Code & GitHub; each person has their own folder).',
      );
    const ids: string[] = (Array.isArray(b.ticketIds) ? b.ticketIds : []).map(String).slice(0, 50);
    if (!ids.length) throw new HttpError(400, 'Choose at least one issue.');
    const instructions = String(b.instructions || '').slice(0, 4000);
    const started: any[] = [],
      skipped: { key: string; reason: string }[] = [];
    // All at once: API contracts are written in parallel; git setup takes turns per repository
    // (lib/devagent.ts).
    await Promise.all(
      ids.map(async (id) => {
        const ticket = project.tickets.find((t: any) => t.id === id);
        if (!ticket) {
          skipped.push({ key: id, reason: 'not saved yet' });
          return;
        }
        try {
          const r = await startForIssue(project, ticket, {
            instructions,
            user,
            ai: aiOpts(b),
            agentId: b.agentId ? String(b.agentId) : '',
          });
          started.push(...Object.values<any>(r.jobs).filter(Boolean));
        } catch (e: any) {
          skipped.push({ key: ticket.key, reason: e.message });
        }
      }),
    );
    return { started, skipped, queue: queueInfo() };
  }
  if (b.action === 'coderabbit') {
    await guard(p, ['ai.use']);
    own(b.jobId);
    return codeRabbitJob(b.jobId, {
      apiKey: (await getProjectSecret(p.id, 'coderabbitKey')) || '',
    });
  }
  if (b.action === 'docx') {
    // a read-only agent's report as a Word document
    await guard(p, ['export']);
    const j = own(b.jobId);
    if (!j.summary) throw new HttpError(400, 'This job has no report to download yet.');
    const title = String(j.summary.match(/^#\s+(.+)$/m)?.[1] || `${j.agentName} - ${j.ticketKey}`)
      .replace(/[\\/:*?"<>|]+/g, '')
      .trim()
      .slice(0, 120);
    const buf = await markdownToDocx(j.summary, { title });
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="report.docx"; filename*=UTF-8''${encodeURIComponent(title)}.docx`,
        'Content-Length': String(buf.length),
        'Cache-Control': 'no-store',
      },
    });
  }
  if (b.action === 'follow') {
    await guard(p, ['ai.use', 'issue.edit']);
    own(b.jobId);
    return followUp(b.jobId, String(b.text || '').slice(0, 4000));
  }
  if (b.action === 'review') {
    await guard(p, ['ai.use']);
    own(b.jobId);
    return reviewJob(b.jobId, { panel: Boolean(b.panel), agent: String(b.agent || 'review') });
  }
  // ---------------------------------------------------------------- pull requests: better text,
  // and updating an open one
  if (b.action === 'prDraft') {
    await guard(p, ['ai.use']);
    own(b.jobId);
    return prDraft(b.jobId, { appLink: `${appUrl(req)}/p/${p.id}/backlog`, ai: aiOpts(b) });
  }
  if (b.action === 'push') {
    await guard(p, ['issue.edit']);
    own(b.jobId);
    return pushToPullRequest(b.jobId, {
      message: String(b.message || ''),
      token: await getProjectSecret(p.id, 'githubToken'),
      gitlabToken: await getProjectSecret(p.id, 'gitlabToken'),
    });
  }
  if (b.action === 'postReview') {
    await guard(p, ['ai.use']);
    own(b.jobId);
    return postReview(b.jobId, {
      token: await getProjectSecret(p.id, 'githubToken'),
      gitlabToken: await getProjectSecret(p.id, 'gitlabToken'),
    });
  }
  if (['update', 'describe', 'comments', 'prReview'].includes(b.action)) {
    const user = await guard(
      p,
      b.action === 'comments'
        ? []
        : b.action === 'prReview'
          ? ['ai.use']
          : ['ai.use', 'issue.edit'],
    );
    const project = await store.getProject(p.id);
    const ticket = project.tickets.find((t: any) => t.id === b.ticketId);
    const pr = ticket?.prs?.find((x: any) => x.id === b.prId);
    if (!ticket || !pr)
      throw new HttpError(404, 'That pull request isn’t linked to this issue any more.');
    const where = await repoForPr(project, pr);
    if (!where)
      throw new HttpError(
        400,
        `${pr.repo} isn’t this project’s repository or its backend repository (Project settings → Code & GitHub), so it can’t be updated from here.`,
      );
    if (!pr.branch)
      throw new HttpError(
        400,
        'TicketForge doesn’t know this request’s branch yet. Click refresh on it first.',
      );
    const target = {
      url: pr.url,
      number: pr.number,
      branch: pr.branch,
      base: pr.base || where.dev.baseBranch || 'main',
      title: pr.title,
      provider: pr.provider,
    };
    const tokens = {
      token: await getProjectSecret(p.id, 'githubToken'),
      gitlabToken: await getProjectSecret(p.id, 'gitlabToken'),
    };
    if (b.action === 'comments')
      return {
        comments: await reviewComments({ repoPath: where.dev.localPath, target, ...tokens }),
      };
    if (b.action === 'prReview')
      return startPrReview({
        projectId: p.id,
        ticket,
        dev: where.dev,
        target,
        user,
        side: where.side,
        agentId:
          b.agent === 'ui-review' || /^custom-[a-z0-9-]+$/.test(String(b.agent || ''))
            ? String(b.agent)
            : await requireRole('review'),
        focus: String(b.focus || '').slice(0, 1000),
      });
    if (b.action === 'describe')
      return describePullRequest({
        repoPath: where.dev.localPath,
        target,
        ticket,
        side: where.side,
        ...tokens,
        appLink: `${appUrl(req)}/p/${p.id}/backlog`,
        ai: aiOpts(b),
      });
    // update: an agent works on the request's own branch; the person reviews, then pushes to the
    // same request.
    const mode = String(b.mode || 'prompt');
    let ask = String(b.prompt || '')
      .trim()
      .slice(0, 6000);
    let label = 'Apply requested changes';
    if (mode === 'enhance') {
      label = 'Enhance tests, edge cases and error handling';
      ask = `Enhance this ${pr.provider === 'GitLab' ? 'merge request' : 'pull request'} without changing what it does: add or improve automated tests for its behaviour and the issue's acceptance criteria, handle edge cases and errors it misses, and tidy names and structure where it helps a reviewer. Keep the change focused.${ask ? `\n\nAlso: ${ask}` : ''}`;
    }
    if (mode === 'review') {
      label = 'Address review comments';
      const cs = await reviewComments({ repoPath: where.dev.localPath, target, ...tokens });
      if (!cs.length) throw new HttpError(400, 'There are no open review comments on it.');
      ask = `Address these review comments on the ${pr.provider === 'GitLab' ? 'merge request' : 'pull request'}. Change what each asks; if you disagree with one, leave the code and say why in your summary.\n\n${cs.map((c: any, i: number) => `${i + 1}. ${c.author ? `@${c.author}` : 'Reviewer'}${c.file ? ` on ${c.file}${c.line ? `:${c.line}` : ''}` : ''}: ${c.body}`).join('\n')}${ask ? `\n\nAlso: ${ask}` : ''}`;
    }
    if (!ask) throw new HttpError(400, 'Say what to change.');
    const context = [
      sideNote(project, ticket, where.side),
      `UPDATING AN OPEN ${pr.provider === 'GitLab' ? 'MERGE' : 'PULL'} REQUEST: ${pr.url} (branch ${target.branch} → ${target.base}). The request's changes are already committed on this branch. Make only the changes asked for below; don't redo the original work.`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const brain = await brainFor(project, ticket, true);
    const job = await startJob({
      projectId: p.id,
      ticket,
      dev: where.dev,
      instructions: ask,
      user,
      agentId: String(
        b.agentId ||
          (await requireRole(
            where.side === 'backend' && project.devBackend?.enabled ? 'backend' : 'build',
          )),
      ),
      context: [context, brain.text].filter(Boolean).join('\n\n'),
      side: where.side,
      target,
      brainFiles: brain.files,
    });
    setUpdateLabel(job.id, label);
    return job;
  }
  if (b.action === 'commit') {
    await guard(p, ['issue.edit']);
    own(b.jobId);
    return commitLocal(b.jobId, {
      title: String(b.title || ''),
      appLink: `${appUrl(req)}/p/${p.id}/backlog`,
    });
  }
  if (b.action === 'cancel') {
    await guard(p, ['issue.edit']);
    own(b.jobId);
    return cancelJob(b.jobId);
  }
  if (b.action === 'discard') {
    await guard(p, ['issue.edit']);
    own(b.jobId);
    return discardJob(b.jobId);
  }
  if (b.action === 'pr') {
    await guard(p, ['issue.edit']);
    const j = own(b.jobId);
    const link = `${appUrl(req)}/p/${p.id}/backlog?issue=${encodeURIComponent(j.ticketId)}`;
    return openPullRequest(b.jobId, {
      title: b.title,
      body: b.body,
      draft: b.draft,
      token: await getProjectSecret(p.id, 'githubToken'),
      gitlabToken: await getProjectSecret(p.id, 'gitlabToken'),
      appLink: link,
    });
  }
  throw new HttpError(400, 'Unknown action');
});
