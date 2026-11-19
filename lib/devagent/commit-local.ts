import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { codeAgentIds, resolveAgent, requireRole } from '../agents';
import {
  withRepoLock,
  JOBS,
  inspectRepo,
  slug,
  WT_ROOT,
  git,
  linkDependencies,
  writeBrain,
  BRAIN_DIR,
  work,
  publicJob,
} from './review-job';
import { say, prompt, stageAll } from './api-contract';

/**
 * Starts a job: a fresh worktree and branch from the base branch, then Claude Code (queued when the
 * machine is busy).
 */
export function startJob(args) {
  return withRepoLock(path.resolve(String(args.dev?.localPath || '')), () => startJobNow(args));
}
async function startJobNow({
  projectId,
  ticket,
  dev,
  instructions,
  user,
  agentId = 'build',
  context = '',
  side = 'frontend',
  target = null,
  brainFiles = null,
}: any) {
  if (!(await codeAgentIds()).includes(agentId))
    throw Object.assign(new Error(`“${agentId}” isn’t a code agent.`), { status: 400 });
  const agent = await resolveAgent(agentId);
  if (!agent.enabled)
    throw Object.assign(
      new Error(`The ${agent.name} agent is turned off in Administration → Agents.`),
      { status: 400 },
    );
  if (agentId === 'free-worker' && !String(instructions || '').trim())
    throw Object.assign(new Error('Tell the Free Worker what to do in the instructions.'), {
      status: 400,
    });
  const running = [...JOBS.values()].find(
    (x) =>
      x.projectId === projectId &&
      x.ticketId === ticket.id &&
      (x.side || 'frontend') === side &&
      ['running', 'queued', 'starting'].includes(x.status),
  );
  if (running)
    throw Object.assign(new Error(`A code job is already running for this issue's ${side}.`), {
      status: 409,
    });
  const repo = await inspectRepo(dev.localPath);
  // target: an open pull/merge request to update ({ url, number, branch, base, title, provider }) —
  // work on its branch.
  const base = target?.base || dev.baseBranch || repo.defaultBranch;
  const branch =
    target?.branch ||
    `${dev.branchPrefix ?? 'tf/'}${String(ticket.key || 'issue').toLowerCase()}-${slug(ticket.title)}`;
  const id = crypto.randomUUID().slice(0, 12);
  const dir = path.join(
    /*turbopackIgnore: true*/ WT_ROOT,
    projectId,
    `${String(ticket.key || id).toLowerCase()}${side === 'backend' ? '-be' : ''}-${id}`,
  );
  const j: any = {
    id,
    projectId,
    ticketId: ticket.id,
    ticketKey: ticket.key,
    status: 'starting',
    branch,
    base,
    repo: dev.repo || repo.repo,
    repoPath: repo.path,
    dir,
    dev,
    log: [],
    startedAt: new Date().toISOString(),
    startedBy: user?.name,
    userId: user?.id || '',
    rounds: 1,
    files: [],
    summary: '',
    ticket,
    agentId,
    agentName: agent.name,
    sessions: {},
    reviews: [],
    todos: [],
    side,
    localOnly: Boolean(dev.localOnly),
    provider: repo.provider || (dev.repo ? 'GitHub' : null),
    target: target || null,
  };
  JOBS.set(id, j);
  if (target) {
    say(j, `Fetching the pull request branch ${branch} from origin…`);
    await git(
      repo.path,
      ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`, base],
      { timeout: 180000 },
    ).catch((e) => {
      JOBS.delete(id);
      throw Object.assign(
        new Error(`Couldn’t fetch the branch ${branch} of ${target.url}: ${e.message}`),
        { status: 400 },
      );
    });
    fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(dir), { recursive: true });
    // Read-only agents (reviews) use a detached checkout: the branch may already be checked out in
    // your own folder.
    await git(
      repo.path,
      agent.writes
        ? ['worktree', 'add', '-B', branch, dir, `origin/${branch}`]
        : ['worktree', 'add', '--detach', dir, `origin/${branch}`],
    ).catch((e) => {
      JOBS.delete(id);
      throw /already (used|checked out) by worktree/i.test(e.message)
        ? Object.assign(
            new Error(
              `The branch ${branch} is checked out in another folder (${e.message.match(/worktree at '([^']+)'/)?.[1] || 'another worktree'}). Switch that folder to another branch, then try again.`,
            ),
            { status: 409 },
          )
        : e;
    });
    linkDependencies(j);
    if (writeBrain(j, brainFiles))
      say(
        j,
        `Added ${j.brain} project brain notes to ${BRAIN_DIR}/ for the agent to read (not committed).`,
      );
    say(
      j,
      `Checked out ${branch} (the branch of ${target.provider === 'GitLab' ? `!${target.number}` : `#${target.number}`}) in its own worktree. ${agent.writes ? `Changes go to the same ${target.provider === 'GitLab' ? 'merge request' : 'pull request'}.` : 'Read-only: nothing is changed or pushed.'}`,
    );
    if (j.status !== 'cancelled') work(j, prompt(ticket, agent, instructions, 1, context));
    return publicJob(j);
  }
  say(j, `Fetching ${base} from origin…`);
  await git(repo.path, ['fetch', 'origin', base], { timeout: 180000 }).catch((e) =>
    say(j, `Couldn’t fetch (${e.message}); using the local ${base}.`, 'warn'),
  );
  const start = await git(repo.path, ['rev-parse', '--verify', '--quiet', `origin/${base}`]).then(
    () => `origin/${base}`,
    () => base,
  );
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(dir), { recursive: true });
  // -B: reuse the branch name if an earlier job for this issue left it behind.
  await git(repo.path, ['worktree', 'add', '-B', branch, dir, start]);
  const linked = linkDependencies(j);
  say(
    j,
    `Created branch ${branch} from ${start} in its own worktree.${linked.length ? ` Linked the installed dependencies (${linked.join(', ')}) so tests can run.` : ''}`,
  );
  if (writeBrain(j, brainFiles))
    say(
      j,
      `Added ${j.brain} project brain notes to ${BRAIN_DIR}/ for the agent to read (not committed).`,
    );
  if (j.status !== 'cancelled') work(j, prompt(ticket, agent, instructions, 1, context)); // runs in the background
  return publicJob(j);
}
/** Another round on the same worktree: "also handle…", "rename…". */
export async function followUp(id, text) {
  const j = JOBS.get(id);
  if (!j)
    throw Object.assign(
      new Error('That code job is gone (the server restarted). Start it again.'),
      { status: 404 },
    );
  if (['running', 'queued', 'starting'].includes(j.status))
    throw Object.assign(new Error('Wait for the current round to finish.'), { status: 409 });
  if (j.pr)
    throw Object.assign(
      new Error(
        'The pull request is already open. Push further changes from your editor, or start a new job.',
      ),
      {
        status: 409,
      },
    );
  j.rounds++;
  say(j, `You: ${text}`, 'you');
  // The agent that writes code takes follow-ups; after a read-only report, Build continues from it.
  if (!(await resolveAgent(j.agentId).catch(() => ({ writes: false }))).writes) {
    j.agentId = await requireRole(j.side === 'backend' ? 'backend' : 'build');
    j.agentName = (await resolveAgent(j.agentId)).name;
  }
  work(j, prompt(j.ticket, await resolveAgent(j.agentId), text, j.rounds), {
    resume: Boolean(j.sessions?.[j.agentId]),
  });
  return publicJob(j);
}
/**
 * Ends a process and everything it started: its process group when it has one, else the process
 * itself. Anything still running 5 seconds later is killed outright.
 */
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const send = (sig) => {
    try {
      process.kill(-child.pid, sig);
    } catch {
      try {
        child.kill(sig);
      } catch {
        /* already gone */
      }
    }
  };
  send('SIGTERM');
  const t = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) send('SIGKILL');
  }, 5000);
  t.unref?.();
}
const stopProcesses = (j) => {
  for (const c of j.children || []) killTree(c);
  killTree(j.child);
};
/**
 * Stop: works while the job is starting, waiting for a slot, or running (the agent or a review of
 * its changes).
 */
export function cancelJob(id) {
  const j = JOBS.get(id);
  if (!j) return null;
  if (j.status === 'starting') {
    j.status = 'cancelled';
    j.finishedAt = new Date().toISOString();
    say(j, 'Stopped before the agent started.', 'warn');
    return publicJob(j);
  }
  if (j.status === 'queued') {
    j.status = 'cancelled';
    j.finishedAt = new Date().toISOString();
    say(j, 'Removed from the queue.', 'warn');
    return publicJob(j);
  }
  if (j.status === 'running') {
    j.status = 'cancelled';
    j.finishedAt = new Date().toISOString();
    stopProcesses(j);
    say(j, j.reviewing ? 'Stopped the review.' : 'Stopped.', 'warn');
  }
  return publicJob(j);
}
/** Removes the worktree (and the branch, unless a pull request uses it). */
export async function discardJob(id) {
  const j = JOBS.get(id);
  if (!j) return null;
  if (['running', 'queued'].includes(j.status)) cancelJob(id);
  await git(j.repoPath, ['worktree', 'remove', '--force', j.dir]).catch(() =>
    fs.rmSync(/*turbopackIgnore: true*/ j.dir, { recursive: true, force: true }),
  );
  if (!j.pr) await git(j.repoPath, ['branch', '-D', j.branch]).catch(() => {});
  j.status = 'discarded';
  return publicJob(j);
}
/**
 * Local-only repositories (the backend, for now): commits the reviewed changes on the job's branch
 * in the local repository. Nothing is pushed. The worktree is removed; the branch stays for you to
 * push or merge.
 */
export async function commitLocal(id, { title, appLink }: any = {}) {
  const j = JOBS.get(id);
  if (!j)
    throw Object.assign(
      new Error('That code job is gone (the server restarted). Start it again.'),
      { status: 404 },
    );
  if (j.status !== 'review')
    throw Object.assign(
      new Error(j.committedAt ? 'Already committed.' : 'There are no changes to commit.'),
      { status: 409 },
    );
  const t = j.ticket;
  const msg = String(title || `${t.key}: ${t.title}`).slice(0, 250);
  await stageAll(j);
  await git(j.dir, ['commit', '-F', '-', '--no-verify'], {
    input:
      `${msg}\n\n${t.userStory || ''}\n\nRefs ${t.key}${appLink ? ` (${appLink})` : ''}\n`.replace(
        /\n{3,}/g,
        '\n\n',
      ),
  });
  const sha = (await git(j.dir, ['rev-parse', '--short', 'HEAD'])).trim();
  j.status = 'committed';
  j.committedAt = new Date().toISOString();
  say(
    j,
    `Committed ${sha} on the local branch ${j.branch} in ${j.repoPath}. Nothing was pushed.`,
    'done',
  );
  await git(j.repoPath, ['worktree', 'remove', '--force', j.dir]).catch(() => {});
  return { job: publicJob(j), commit: { sha, branch: j.branch, repoPath: j.repoPath } };
}
