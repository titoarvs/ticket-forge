// Code jobs through the AI provider and the GitHub API (lib/api-code.ts), kept in the database
// (code_jobs) because a deployed TicketForge has no long-lived server process. Each job has the
// same shape the code window uses for local jobs, plus { remote: true }. A round runs after the
// response is sent (`defer`) and records its progress in the job, which the browser polls.
import crypto from 'node:crypto';
import { orm, codeJobs, eq, and, desc, sql } from './orm';
import { consume } from './limits';
import { runApiCode, openCodePr, mergeCodePr, deleteBranch } from './api-code';
import { err } from './errors';

const LIVE = ['starting', 'queued', 'running'];
const now = () => new Date().toISOString();
const say = (j, text, kind = 'info') => {
  j.log = [...(j.log || []), { at: now(), kind, text: String(text).slice(0, 500) }].slice(-200);
};

const STALE_MS = 8 * 60000; // a round that has been quiet this long died with its server (serverless time limit)
async function save(j) {
  j.touched = now();
  await orm
    .insert(codeJobs)
    .values({
      id: j.id,
      projectId: j.projectId,
      ticketId: j.ticketId,
      data: j,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({ target: codeJobs.id, set: { data: j, updatedAt: sql`now()` } });
  return j;
}
export async function loadJob(id) {
  const [r] = await orm.select({ data: codeJobs.data }).from(codeJobs).where(eq(codeJobs.id, id));
  return r ? (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) : null;
}
export const isRemoteId = (id) => /^gh-[a-z0-9]+$/.test(String(id || ''));
/** What the browser gets (the diff is fetched separately). */
export const publicRemote = (j, since = 0) =>
  j && {
    ...j,
    diff: undefined,
    log: (j.log || []).slice(since),
    logSize: (j.log || []).length,
    reviews: [],
    todos: [],
  };

/**
 * Starts a job: a branch name, then the first round. `defer(fn)` runs it after the response (Next's
 * after()).
 */
export async function startRemoteJob({
  projectId,
  ticket,
  side,
  dev,
  gh,
  task,
  branch,
  user,
  base,
  ai,
  defer = (fn) => fn(),
}: any) {
  const refund = await consume('codeJobs'); // the plan's monthly AI code jobs (SaaS)
  const id = `gh-${crypto.randomBytes(6).toString('hex')}`;
  const j = {
    id,
    projectId,
    ticketId: ticket.id,
    ticketKey: ticket.key,
    status: 'starting',
    remote: true,
    engine: 'api',
    branch,
    base,
    repo: dev.repo,
    side,
    provider: 'GitHub',
    startedAt: now(),
    startedBy: user?.name || '',
    rounds: 1,
    files: [],
    summary: '',
    costUsd: 0,
    agentId: task.agentId,
    agentName: task.agentName,
    log: [],
    localOnly: false,
  };
  say(
    j,
    `${task.agentName} agent will work on ${ticket.key} on ${branch} (from ${base}) through your AI provider and GitHub.`,
  );
  await save(j);
  defer(() => runRound(j, { gh, task, user, ai, refund }));
  return j;
}
/** Is this job still wanted (not stopped while the AI was working)? */
const wanted = async (id) => {
  const r = await loadJob(id);
  return Boolean(r) && LIVE.includes(r.status);
};
/** Saves progress unless the job was stopped meanwhile (a stop is never overwritten). */
const keep = async (j) => {
  if (await wanted(j.id)) await save(j);
};
async function runRound(j, { gh, task, user, ai, refund }: any) {
  try {
    j.status = 'running';
    await keep(j);
    const r = await runApiCode({
      repo: j.repo,
      token: gh.token,
      base: j.base,
      branch: j.branch,
      task,
      ai,
      author: user?.name
        ? { name: user.name, email: 'ticketforge@users.noreply.github.com' }
        : null,
      message: `${j.ticketKey}: ${task.commitTitle || 'changes by the TicketForge agent'}${j.rounds > 1 ? ` (round ${j.rounds})` : ''}`,
      step: (text) => {
        say(j, text);
        keep(j).catch(() => {});
      },
      alive: () => wanted(j.id),
    });
    if (r === null) return; // stopped: the stop already recorded the job's state
    j.finishedAt = now();
    if (r.summary) j.summary = [j.summary, r.summary].filter(Boolean).join('\n\n---\n\n');
    if (r.files.length) {
      j.files = mergeFiles(j.files || [], r.files);
      j.diff = [j.diff, r.diff].filter(Boolean).join('\n');
      j.sha = r.sha;
      j.status = 'review';
      say(
        j,
        `Done: ${r.files.length} file${r.files.length === 1 ? '' : 's'} changed, pushed to ${j.branch} (${r.sha}). Review the diff, then open the pull request.`,
        'done',
      );
    } else {
      j.status = j.files?.length ? 'review' : 'empty';
      say(j, 'The AI finished without changing any files this round.', 'done');
    }
  } catch (e) {
    j.status = 'failed';
    j.error = e.message;
    j.finishedAt = now();
    say(j, e.message, 'error');
    if (j.rounds === 1 && !j.files?.length) refund?.();
  }
  await keep(j);
}
/**
 * Reads a job; a round that went quiet (its server stopped) is marked failed so it never looks
 * stuck.
 */
export async function refreshJob(j) {
  if (!j || !LIVE.includes(j.status)) return j;
  if (!j.engine) {
    j.status = 'failed';
    j.error =
      'This job was started on GitHub Actions, which TicketForge no longer uses. Start a new code job.';
    j.finishedAt = now();
    say(j, j.error, 'error');
    return save(j);
  }
  if (Date.now() - Date.parse(j.touched || j.startedAt) > STALE_MS) {
    j.status = 'failed';
    j.error =
      'The job stopped responding (the server ran out of time). Start it again, or ask for a smaller change.';
    j.finishedAt = now();
    say(j, j.error, 'error');
    return save(j);
  }
  return j;
}
function mergeFiles(a, b) {
  const m = new Map(a.map((f) => [f.path, { ...f }]));
  for (const f of b) {
    const o: any = m.get(f.path);
    if (o) {
      o.added += f.added;
      o.removed += f.removed;
    } else m.set(f.path, { ...f });
  }
  return [...m.values()];
}
/** Another round on the same branch ("also handle…"). */
export async function followRemote(j, { gh, task, user, text, ai, defer = (fn) => fn() }: any) {
  if (LIVE.includes(j.status)) throw err('Wait for the current round to finish.', 409);
  if (j.pr) throw err('The pull request is already open. Start a new job to change it.', 409);
  if (!j.engine)
    throw err(
      'This job ran on GitHub Actions, which TicketForge no longer uses. Start a new code job.',
      409,
    );
  j.rounds = (j.rounds || 1) + 1;
  j.approvals = []; // the code is about to change, so earlier approvals no longer count
  say(j, `You: ${text}`, 'you');
  j.status = 'starting';
  j.error = null;
  await save(j);
  defer(() => runRound(j, { gh, task, user, ai }));
  return j;
}
/** Stop: marks the job stopped. The round in progress notices and commits nothing. */
export async function cancelRemote(j) {
  if (!LIVE.includes(j.status)) return j;
  j.status = 'cancelled';
  j.finishedAt = now();
  say(j, 'Stopped. Nothing more will be committed.', 'warn');
  return save(j);
}
export async function discardRemote(j, gh) {
  if (j.status === 'merged')
    throw err('This code is already merged, so it can’t be discarded.', 409);
  if (LIVE.includes(j.status)) await cancelRemote(j);
  if (!j.pr) await deleteBranch({ repo: j.repo, token: gh.token, branch: j.branch });
  j.status = 'discarded';
  return save(j);
}
export async function prRemote(j, gh, { title, body, draft }: any) {
  if (j.status !== 'review')
    throw err(
      j.pr
        ? 'The pull request is already open.'
        : 'There are no changes to open a pull request for.',
      409,
    );
  const pr = await openCodePr({
    repo: j.repo,
    token: gh.token,
    head: j.branch,
    base: j.base,
    title,
    body,
    draft,
  });
  j.pr = pr;
  j.status = 'pr';
  say(j, `Opened pull request #${pr.number}.`, 'done');
  await save(j);
  return {
    pr: {
      url: pr.url,
      number: pr.number,
      title: pr.title,
      draft: pr.draft,
      repo: j.repo,
      provider: 'GitHub',
      status: pr.draft ? 'Draft' : 'Open',
      branch: j.branch,
      base: j.base,
    },
  };
}

// ---------------------------------------------------------------- approvals and merge (TF-123)
/**
 * Approvals the project asks for before the pull request can be merged (Project settings → Code &
 * GitHub); 1 unless set.
 */
export const requiredApprovals = (project) => {
  const n = Number(project?.dev?.requiredApprovals);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 1;
};
const approvalsOf = (j) => (Array.isArray(j.approvals) ? j.approvals : []);
/** "Approved 1 of 2. 1 more approval needed" (or just "Approved 2 of 2" once there are enough). */
export const approvalNote = (have, need) =>
  `Approved ${have} of ${need}${have < need ? `. ${need - have} more approval${need - have === 1 ? '' : 's'} needed` : ''}`;
/**
 * Records a workspace member's approval on the job (kept in code_jobs.data): once per member, with
 * their name. Any member can approve, including the person who started the job. Changing the code
 * again clears the approvals.
 */
export async function approveRemote(j, user) {
  if (j.status === 'merged') throw err('This code is already merged.', 409);
  if (!['review', 'pr'].includes(j.status))
    throw err('There is no finished code to approve yet.', 409);
  if (approvalsOf(j).some((a) => a.userId === user.id)) return j;
  const name = user.name || user.email || 'A member';
  j.approvals = [...approvalsOf(j), { userId: user.id, name, at: now() }];
  say(j, `${name} approved the code (${approvalsOf(j).length}).`, 'done');
  return save(j);
}
/**
 * Approve and merge: records the member's approval, then merges the pull request when there are
 * enough approvals. `gh()` gives the GitHub token; it is only asked for once the approvals are
 * enough, so a blocked merge never needs GitHub.
 */
export async function mergeRemote(j, { user, required, gh }: any) {
  if (j.status === 'merged') return j;
  if (j.status !== 'pr' || !j.pr)
    throw err('Open the pull request first, then approve and merge it.', 409);
  await approveRemote(j, user);
  const have = approvalsOf(j).length;
  if (have < required) throw err(approvalNote(have, required), 409);
  const r = await mergeCodePr({
    repo: j.repo,
    token: (await gh()).token,
    number: j.pr.number,
    title: j.pr.title,
  });
  j.status = 'merged';
  j.merged = { at: r.mergedAt, by: user.name || user.email || '', sha: r.sha };
  say(
    j,
    `Merged pull request #${j.pr.number}${r.sha ? ` (${r.sha})` : ''} after ${have} of ${required} approvals.`,
    'done',
  );
  return save(j);
}
export async function remoteJobsFor(projectId, ticketId) {
  const rows = await orm
    .select({ data: codeJobs.data })
    .from(codeJobs)
    .where(and(eq(codeJobs.projectId, projectId), eq(codeJobs.ticketId, ticketId)))
    .orderBy(desc(codeJobs.updatedAt))
    .limit(20);
  return rows
    .map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data))
    .filter((j) => j.status !== 'discarded');
}
export async function remoteJobsForProject(projectId) {
  const rows = await orm
    .select({ data: codeJobs.data })
    .from(codeJobs)
    .where(eq(codeJobs.projectId, projectId))
    .orderBy(desc(codeJobs.updatedAt))
    .limit(200);
  return rows
    .map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data))
    .filter((j) => j.status !== 'discarded');
}
export function remoteDiff(j, file) {
  const d = String(j.diff || '');
  if (!file) return d;
  const parts = d.split(/(?=^diff --git )/m);
  return parts
    .filter((p) => p.startsWith(`diff --git a/${file} `) || p.includes(` b/${file}\n`))
    .join('');
}
