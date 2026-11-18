// Code jobs through the AI provider and the GitHub API (lib/api-code.ts), kept in the database (code_jobs) because a
// deployed TicketForge has no long-lived server process. Each job has the same shape the code window uses for local
// jobs, plus { remote: true }. A round runs after the response is sent (`defer`) and records its progress in the job,
// which the browser polls.
import crypto from 'node:crypto';
import { q } from './db';
import { consume } from './limits';
import { runApiCode, openCodePr, deleteBranch } from './api-code';
import { err } from './errors';

const LIVE = ['starting', 'queued', 'running'];
const now = () => new Date().toISOString();
const say = (j, text, kind = 'info') => { j.log = [...(j.log || []), { at: now(), kind, text: String(text).slice(0, 500) }].slice(-200); };

const STALE_MS = 8 * 60000; // a round that has been quiet this long died with its server (serverless time limit)
async function save(j) {
  j.touched = now();
  await q(`insert into code_jobs (id, project_id, ticket_id, data, updated_at) values ($1,$2,$3,$4,now())
    on conflict (id) do update set data = excluded.data, updated_at = now()`, [j.id, j.projectId, j.ticketId, JSON.stringify(j)]);
  return j;
}
export async function loadJob(id) {
  const r = (await q('select data from code_jobs where id = $1', [id])).rows[0];
  return r ? (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) : null;
}
export const isRemoteId = (id) => /^gh-[a-z0-9]+$/.test(String(id || ''));
/** What the browser gets (the diff is fetched separately). */
export const publicRemote = (j, since = 0) => j && ({ ...j, diff: undefined, log: (j.log || []).slice(since), logSize: (j.log || []).length, reviews: [], todos: [] });

/** Starts a job: a branch name, then the first round. `defer(fn)` runs it after the response (Next's after()). */
export async function startRemoteJob({ projectId, ticket, side, dev, gh, task, branch, user, base, ai, defer = (fn) => fn() }: any) {
  const refund = await consume('codeJobs'); // the plan's monthly AI code jobs (SaaS)
  const id = `gh-${crypto.randomBytes(6).toString('hex')}`;
  const j = { id, projectId, ticketId: ticket.id, ticketKey: ticket.key, status: 'starting', remote: true, engine: 'api', branch, base, repo: dev.repo, side, provider: 'GitHub',
    startedAt: now(), startedBy: user?.name || '', rounds: 1, files: [], summary: '', costUsd: 0, agentId: task.agentId, agentName: task.agentName, log: [], localOnly: false };
  say(j, `${task.agentName} agent will work on ${ticket.key} on ${branch} (from ${base}) through your AI provider and GitHub.`);
  await save(j);
  defer(() => runRound(j, { gh, task, user, ai, refund }));
  return j;
}
/** Is this job still wanted (not stopped while the AI was working)? */
const wanted = async (id) => { const r = await loadJob(id); return Boolean(r) && LIVE.includes(r.status); };
/** Saves progress unless the job was stopped meanwhile (a stop is never overwritten). */
const keep = async (j) => { if (await wanted(j.id)) await save(j); };
async function runRound(j, { gh, task, user, ai, refund }: any) {
  try {
    j.status = 'running';
    await keep(j);
    const r = await runApiCode({
      repo: j.repo, token: gh.token, base: j.base, branch: j.branch, task, ai,
      author: user?.name ? { name: user.name, email: 'ticketforge@users.noreply.github.com' } : null,
      message: `${j.ticketKey}: ${task.commitTitle || 'changes by the TicketForge agent'}${j.rounds > 1 ? ` (round ${j.rounds})` : ''}`,
      step: (text) => { say(j, text); keep(j).catch(() => {}); },
      alive: () => wanted(j.id),
    });
    if (r === null) return; // stopped: the stop already recorded the job's state
    j.finishedAt = now();
    if (r.summary) j.summary = [j.summary, r.summary].filter(Boolean).join('\n\n---\n\n');
    if (r.files.length) {
      j.files = mergeFiles(j.files || [], r.files); j.diff = [j.diff, r.diff].filter(Boolean).join('\n'); j.sha = r.sha;
      j.status = 'review';
      say(j, `Done: ${r.files.length} file${r.files.length === 1 ? '' : 's'} changed, pushed to ${j.branch} (${r.sha}). Review the diff, then open the pull request.`, 'done');
    } else {
      j.status = j.files?.length ? 'review' : 'empty';
      say(j, 'The AI finished without changing any files this round.', 'done');
    }
  } catch (e) {
    j.status = 'failed'; j.error = e.message; j.finishedAt = now(); say(j, e.message, 'error');
    if (j.rounds === 1 && !j.files?.length) refund?.();
  }
  await keep(j);
}
/** Reads a job; a round that went quiet (its server stopped) is marked failed so it never looks stuck. */
export async function refreshJob(j) {
  if (!j || !LIVE.includes(j.status)) return j;
  if (!j.engine) { j.status = 'failed'; j.error = 'This job was started on GitHub Actions, which TicketForge no longer uses. Start a new code job.'; j.finishedAt = now(); say(j, j.error, 'error'); return save(j); }
  if (Date.now() - Date.parse(j.touched || j.startedAt) > STALE_MS) {
    j.status = 'failed'; j.error = 'The job stopped responding (the server ran out of time). Start it again, or ask for a smaller change.'; j.finishedAt = now(); say(j, j.error, 'error');
    return save(j);
  }
  return j;
}
function mergeFiles(a, b) {
  const m = new Map(a.map((f) => [f.path, { ...f }]));
  for (const f of b) { const o: any = m.get(f.path); if (o) { o.added += f.added; o.removed += f.removed; } else m.set(f.path, { ...f }); }
  return [...m.values()];
}
/** Another round on the same branch ("also handle…"). */
export async function followRemote(j, { gh, task, user, text, ai, defer = (fn) => fn() }: any) {
  if (LIVE.includes(j.status)) throw err('Wait for the current round to finish.', 409);
  if (j.pr) throw err('The pull request is already open. Start a new job to change it.', 409);
  if (!j.engine) throw err('This job ran on GitHub Actions, which TicketForge no longer uses. Start a new code job.', 409);
  j.rounds = (j.rounds || 1) + 1;
  say(j, `You: ${text}`, 'you');
  j.status = 'starting'; j.error = null;
  await save(j);
  defer(() => runRound(j, { gh, task, user, ai }));
  return j;
}
/** Stop: marks the job stopped. The round in progress notices and commits nothing. */
export async function cancelRemote(j) {
  if (!LIVE.includes(j.status)) return j;
  j.status = 'cancelled'; j.finishedAt = now(); say(j, 'Stopped. Nothing more will be committed.', 'warn');
  return save(j);
}
export async function discardRemote(j, gh) {
  if (LIVE.includes(j.status)) await cancelRemote(j);
  if (!j.pr) await deleteBranch({ repo: j.repo, token: gh.token, branch: j.branch });
  j.status = 'discarded';
  return save(j);
}
export async function prRemote(j, gh, { title, body, draft }: any) {
  if (j.status !== 'review') throw err(j.pr ? 'The pull request is already open.' : 'There are no changes to open a pull request for.', 409);
  const pr = await openCodePr({ repo: j.repo, token: gh.token, head: j.branch, base: j.base, title, body, draft });
  j.pr = pr; j.status = 'pr';
  say(j, `Opened pull request #${pr.number}.`, 'done');
  await save(j);
  return { pr: { url: pr.url, number: pr.number, title: pr.title, draft: pr.draft, repo: j.repo, provider: 'GitHub', status: pr.draft ? 'Draft' : 'Open', branch: j.branch, base: j.base } };
}
export async function remoteJobsFor(projectId, ticketId) {
  const rows = (await q('select data from code_jobs where project_id = $1 and ticket_id = $2 order by updated_at desc limit 20', [projectId, ticketId])).rows;
  return rows.map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)).filter((j) => j.status !== 'discarded');
}
export async function remoteJobsForProject(projectId) {
  const rows = (await q('select data from code_jobs where project_id = $1 order by updated_at desc limit 200', [projectId])).rows;
  return rows.map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)).filter((j) => j.status !== 'discarded');
}
export function remoteDiff(j, file) {
  const d = String(j.diff || '');
  if (!file) return d;
  const parts = d.split(/(?=^diff --git )/m);
  return parts.filter((p) => p.startsWith(`diff --git a/${file} `) || p.includes(` b/${file}\n`)).join('');
}
