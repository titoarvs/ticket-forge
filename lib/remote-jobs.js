// Code jobs that run on GitHub Actions (lib/gh-code.js), kept in the database (code_jobs) because a deployed
// TicketForge has no long-lived server process. Each job has the same shape the code window uses for local jobs,
// plus { remote: true, runs: [...] }. Reading a running job checks GitHub once and records what changed.
import crypto from 'node:crypto';
import { q } from './db.js';
import { consume } from './limits.js';
import { dispatchCode, checkCode, cancelCode, openCodePr, deleteBranch } from './gh-code.js';

const err = (message, status = 400) => Object.assign(new Error(message), { status });
const LIVE = ['starting', 'queued', 'running'];
const now = () => new Date().toISOString();
const say = (j, text, kind = 'info') => { j.log = [...(j.log || []), { at: now(), kind, text: String(text).slice(0, 500) }].slice(-200); };

async function save(j) {
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

/** Starts a job: a branch name, then the first round on GitHub Actions. */
export async function startRemoteJob({ projectId, ticket, side, dev, gh, task, branch, user, base }) {
  await consume('codeJobs'); // the plan's monthly AI code jobs (SaaS)
  const id = `gh-${crypto.randomBytes(6).toString('hex')}`;
  const j = { id, projectId, ticketId: ticket.id, ticketKey: ticket.key, status: 'starting', remote: true, branch, base, repo: dev.repo, side, provider: 'GitHub',
    startedAt: now(), startedBy: user?.name || '', rounds: 1, files: [], summary: '', costUsd: 0, agentId: task.agentId, agentName: task.agentName, runs: [], log: [], localOnly: false };
  say(j, `${task.agentName} agent will work on ${ticket.key} on ${branch} (from ${base}) on GitHub Actions.`);
  await save(j);
  return runRound(j, { gh, task, user });
}
async function runRound(j, { gh, task, user }) {
  try {
    const run = await dispatchCode({ repo: j.repo, ref: gh.ref, token: gh.token, key: gh.key, job: {
      branch: j.branch, base: j.base, prompt: task.prompt, system: task.system, model: task.model, effort: task.effort, allowedTools: task.allowedTools, disallowedTools: task.disallowedTools,
      commitMessage: `${j.ticketKey}: ${task.commitTitle || 'changes by the TicketForge agent'}${j.rounds > 1 ? ` (round ${j.rounds})` : ''}`, author: user?.name ? { name: user.name, email: 'ticketforge@users.noreply.github.com' } : null,
      oauthToken: task.oauthToken || undefined,
    } });
    j.claude = task.oauthToken ? 'own' : 'shared';
    j.runs = [...(j.runs || []), run];
    j.status = 'queued';
    say(j, `Sent to GitHub Actions (${task.oauthToken ? 'your own Claude subscription' : 'the repository’s shared Claude subscription'}). It usually starts within a minute, then installs Claude Code and the project’s dependencies.`);
  } catch (e) { j.status = 'failed'; j.error = e.message; say(j, e.message, 'error'); }
  return save(j);
}
/** Checks GitHub once for a running job and records the result when it's done. */
export async function refreshJob(j, gh) {
  if (!j || !LIVE.includes(j.status)) return j;
  const run = j.runs?.[j.runs.length - 1];
  if (!run) return j;
  let st;
  try { st = await checkCode({ repo: j.repo, token: gh.token, key: gh.key, run }); } catch (e) { say(j, `Couldn’t check GitHub: ${e.message}`, 'warn'); return save(j); }
  if (st.url && j.runUrl !== st.url) { j.runUrl = st.url; say(j, `GitHub Actions run: ${st.url}`); }
  if (st.state === 'queued' && j.status !== 'queued') { j.status = 'queued'; return save(j); }
  if (st.state === 'in_progress' && j.status !== 'running') { j.status = 'running'; say(j, 'Claude Code is working on GitHub Actions…'); return save(j); }
  if (st.state === 'failed') { j.status = 'failed'; j.error = st.message; j.finishedAt = now(); say(j, st.message, 'error'); return save(j); }
  if (st.state !== 'done') return j;
  const r = st.data || {};
  j.finishedAt = now();
  j.costUsd = (j.costUsd || 0) + (r.costUsd || 0);
  if (r.summary) j.summary = [j.summary, r.summary].filter(Boolean).join('\n\n---\n\n');
  if (r.files?.length) { j.files = mergeFiles(j.files || [], r.files); j.diff = [j.diff, r.diff].filter(Boolean).join('\n'); j.sha = r.sha; }
  if (r.error) { j.status = 'failed'; j.error = r.error; say(j, r.error, 'error'); }
  else if (r.files?.length) { j.status = 'review'; say(j, `Done: ${r.files.length} file${r.files.length === 1 ? '' : 's'} changed, pushed to ${j.branch} (${r.sha}). Review the diff, then open the pull request.`, 'done'); }
  else { j.status = j.files?.length ? 'review' : 'empty'; say(j, 'The agent finished without changing any files this round.', 'done'); }
  return save(j);
}
function mergeFiles(a, b) {
  const m = new Map(a.map((f) => [f.path, { ...f }]));
  for (const f of b) { const o = m.get(f.path); if (o) { o.added += f.added; o.removed += f.removed; } else m.set(f.path, { ...f }); }
  return [...m.values()];
}
/** Another round on the same branch ("also handle…"). */
export async function followRemote(j, { gh, task, user, text }) {
  if (LIVE.includes(j.status)) throw err('Wait for the current round to finish.', 409);
  if (j.pr) throw err('The pull request is already open. Start a new job to change it.', 409);
  j.rounds = (j.rounds || 1) + 1;
  say(j, `You: ${text}`, 'you');
  j.status = 'starting'; j.error = null;
  await save(j);
  return runRound(j, { gh, task, user });
}
export async function cancelRemote(j, gh) {
  if (!LIVE.includes(j.status)) return j;
  await cancelCode({ repo: j.repo, token: gh.token, run: j.runs?.[j.runs.length - 1] });
  j.status = 'cancelled'; j.finishedAt = now(); say(j, 'Stopped.', 'warn');
  return save(j);
}
export async function discardRemote(j, gh) {
  if (LIVE.includes(j.status)) await cancelRemote(j, gh);
  if (!j.pr) await deleteBranch({ repo: j.repo, token: gh.token, branch: j.branch });
  j.status = 'discarded';
  return save(j);
}
export async function prRemote(j, gh, { title, body, draft }) {
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
