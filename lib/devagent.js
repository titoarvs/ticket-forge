// Code generation and pull requests for an issue, on a local clone of the project's GitHub repository.
// Each job works in its own git worktree and branch (your checkout is never touched): a TicketForge agent (lib/agents.js) runs as a Claude Code agent and
// implements the issue there, you review the diff in TicketForge, then TicketForge commits, pushes and opens the pull request.
// Local only: it needs the repository folder, git and Claude Code on the machine running TicketForge.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { DATA_DIR } from './db.js';
import { claudeCodeCommand } from './claude.js';
import { resolveAgent, claudeAgentsJson, CODE_AGENT_IDS, ensureAgent, REVIEW_LENSES } from './agents.js';

const G = globalThis;
G.__tfDevJobs ??= new Map();
const JOBS = G.__tfDevJobs;
const WT_ROOT = path.join(/*turbopackIgnore: true*/ DATA_DIR, 'worktrees');
const MAX_DIFF = 400_000;

function git(cwd, args, { timeout = 120000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd, timeout, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(new Error(String(stderr || err.message).trim().split('\n').slice(-3).join(' ')), { status: 400 }));
      else resolve(String(stdout));
    });
    if (input !== undefined) child.stdin.end(input);
  });
}
const repoFromRemote = (url) => (String(url).trim().match(/github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/i) || [])[1] || '';
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'change';

/** Checks a local folder: is it a git repository, which GitHub repo, which default branch, anything uncommitted. */
/**
 * A typed folder as a real path: ~ is the home folder, and a path that doesn't exist from the root but does inside
 * the home folder (/desktop/Practice → ~/Desktop/Practice) is taken from there.
 */
const real = (p) => { try { return fs.realpathSync.native(/*turbopackIgnore: true*/ p); } catch { return p; } };
export function resolveFolder(input) { return real(findFolder(input)); }
function findFolder(input) {
  const home = os.homedir();
  const raw = String(input || '').trim().replace(/^~(?=$|\/)/, home);
  const dir = path.resolve(/*turbopackIgnore: true*/ raw || home);
  if (fs.existsSync(/*turbopackIgnore: true*/ dir)) return dir;
  const inHome = path.join(/*turbopackIgnore: true*/ home, raw.replace(/^\/+/, ''));
  if (raw && fs.existsSync(/*turbopackIgnore: true*/ inHome)) return inHome;
  // Same, ignoring letter case of each part (macOS folders such as Desktop and Documents).
  let cur = home;
  for (const part of raw.replace(/^\/+/, '').split('/').filter(Boolean)) {
    const hit = fs.existsSync(/*turbopackIgnore: true*/ cur) && fs.readdirSync(/*turbopackIgnore: true*/ cur).find((n) => n.toLowerCase() === part.toLowerCase());
    if (!hit) return dir;
    cur = path.join(/*turbopackIgnore: true*/ cur, hit);
  }
  return cur;
}

/** The folders inside one folder, for picking the repository (names only; files are never listed). */
export function listFolders(input) {
  const home = os.homedir();
  const dir = resolveFolder(input || home);
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir) || !fs.statSync(/*turbopackIgnore: true*/ dir).isDirectory()) throw Object.assign(new Error(`There’s no folder at ${dir}.`), { status: 400 });
  let names = [];
  try { names = fs.readdirSync(/*turbopackIgnore: true*/ dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && !['node_modules', 'Library', '__pycache__'].includes(d.name)).map((d) => d.name); }
  catch { throw Object.assign(new Error(`TicketForge can’t open ${dir} (permission denied).`), { status: 400 }); }
  const isGit = (p) => fs.existsSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ p, '.git'));
  const entries = names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).slice(0, 500).map((name) => ({ name, path: path.join(/*turbopackIgnore: true*/ dir, name), git: isGit(path.join(/*turbopackIgnore: true*/ dir, name)) }));
  const places = [['Home', home], ['Desktop', path.join(/*turbopackIgnore: true*/ home, 'Desktop')], ['Documents', path.join(/*turbopackIgnore: true*/ home, 'Documents')], ['Developer', path.join(/*turbopackIgnore: true*/ home, 'Developer')], ['Projects', path.join(/*turbopackIgnore: true*/ home, 'Projects')], ['code', path.join(/*turbopackIgnore: true*/ home, 'code')]]
    .filter(([, p]) => fs.existsSync(/*turbopackIgnore: true*/ p)).map(([name, p]) => ({ name, path: p }));
  return { path: dir, parent: path.dirname(dir) !== dir ? path.dirname(dir) : null, git: isGit(dir), entries, places, home };
}

export async function inspectRepo(localPath) {
  const dir = resolveFolder(localPath);
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir) || !fs.statSync(/*turbopackIgnore: true*/ dir).isDirectory()) throw Object.assign(new Error(`There’s no folder at ${dir} on this computer. Use Browse… to pick it.`), { status: 400 });
  const top = (await git(dir, ['rev-parse', '--show-toplevel']).catch(() => { throw Object.assign(new Error(`${dir} isn’t a git repository. Clone the project’s GitHub repository there first.`), { status: 400 }); })).trim();
  const remote = (await git(top, ['remote', 'get-url', 'origin']).catch(() => '')).trim();
  let base = (await git(top, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(() => '')).trim().replace(/^origin\//, '');
  if (!base) base = (await git(top, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'main')).trim();
  const current = (await git(top, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim();
  const dirty = (await git(top, ['status', '--porcelain']).catch(() => '')).trim().split('\n').filter(Boolean).length;
  return { path: top, remote: remote.replace(/\/\/[^@/]+@/, '//'), repo: repoFromRemote(remote), defaultBranch: base, currentBranch: current, uncommitted: dirty };
}

/** A GitHub token: the project's saved one, GITHUB_TOKEN, or the signed-in `gh` CLI. */
export async function githubToken(saved) {
  if (saved) return saved;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  return new Promise((resolve) => execFile('gh', ['auth', 'token'], { timeout: 10000 }, (err, out) => resolve(err ? '' : String(out).trim())));
}

const publicJob = (j, since = 0) => j && ({
  id: j.id, projectId: j.projectId, ticketId: j.ticketId, ticketKey: j.ticketKey, status: j.status, branch: j.branch, base: j.base, repo: j.repo,
  startedAt: j.startedAt, finishedAt: j.finishedAt, error: j.error, summary: j.summary, files: j.files, pr: j.pr, rounds: j.rounds,
  log: j.log.slice(since), logSize: j.log.length, startedBy: j.startedBy,
  agentId: j.agentId, agentName: j.agentName, reviews: j.reviews || [], todos: j.todos || [], costUsd: j.costUsd || 0,
  side: j.side || 'frontend', localOnly: Boolean(j.localOnly), repoPath: j.repoPath, committedAt: j.committedAt || null,
});
export const getJob = (id, since) => publicJob(JOBS.get(id), since);
/** The newest job for an issue (so the panel can show it again after a reload). */
export function jobForTicket(projectId, ticketId, side = null) {
  const all = [...JOBS.values()].filter((j) => j.projectId === projectId && j.ticketId === ticketId && j.status !== 'discarded' && (!side || (j.side || 'frontend') === side));
  return publicJob(all.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]);
}
/** The newest job per repository for an issue: { frontend, backend }. */
export const jobsForTicket = (projectId, ticketId) => ({ frontend: jobForTicket(projectId, ticketId, 'frontend') || null, backend: jobForTicket(projectId, ticketId, 'backend') || null });
/** The newest backend job's summary for an issue, for the frontend job to build on. */
export function backendSummary(projectId, ticketId) {
  const j = [...JOBS.values()].filter((x) => x.projectId === projectId && x.ticketId === ticketId && x.side === 'backend' && x.summary && x.status !== 'discarded')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  return j ? { summary: j.summary, branch: j.branch, status: j.status } : null;
}
const say = (j, text, kind = 'info') => { j.log.push({ at: new Date().toISOString(), kind, text: String(text).slice(0, 500) }); if (j.log.length > 800) j.log.splice(0, j.log.length - 800); };

const TOOL_VERB = { Read: 'Reading', Edit: 'Editing', MultiEdit: 'Editing', Write: 'Writing', Glob: 'Finding files', Grep: 'Searching', LS: 'Listing', Bash: 'Running', TodoWrite: 'Planning', Task: 'Delegating to', Agent: 'Delegating to' };

/** What the issue asks for, as the agent's task. The agent's role and rules are its system prompt (lib/agents.js). */
function prompt(t, agent, extra, round, context = '') {
  const lines = [
    round > 1 ? `Continue the work on issue ${t.key}. Your previous changes are already in the working tree; adjust them as asked below.`
      : agent.id === 'feature-tests' ? `Write and run the automated tests for issue ${t.key}.`
      : agent.id === 'architecture-record' ? `Write the Architecture Record Design for the feature that issue ${t.key} belongs to.`
      : agent.id === 'free-worker' ? `Work on this task in the context of issue ${t.key}.`
      : agent.id === 'bug-fix' ? `Fix the bug described in issue ${t.key}.`
      : agent.id === 'test-automation' ? `Write the end-to-end tests for issue ${t.key}.`
      : agent.id === 'ui-review' ? `Audit the UI of the screens and components that issue ${t.key} touches. Find them in the repository first.`
      : agent.id === 'frontend' ? `Build the UI for issue ${t.key} in this repository.`
      : agent.id === 'backend' ? `Build the server side (APIs, data, rules) for issue ${t.key} in this repository.`
      : `Implement issue ${t.key} in this repository.`,
    '',
    `Title: ${t.title}`,
    t.type && `Type: ${t.type}${t.points ? ` · ${t.points} points` : ''}`,
    t.userStory && `User story: ${t.userStory}`,
    t.description && `Description:\n${t.description}`,
    t.acceptanceCriteria?.length && `Acceptance criteria:\n${t.acceptanceCriteria.map((a, i) => `${i + 1}. ${a}`).join('\n')}`,
    t.testCases?.length && `Test cases it must pass:\n${t.testCases.slice(0, 20).map((c) => `- ${c.title}${c.expected ? ` (expected: ${c.expected})` : ''}`).join('\n')}`,
    extra && `${round > 1 ? 'What to change now' : 'Extra instructions'}:\n${extra}`,
    round === 1 && context,
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * Runs one TicketForge agent as a Claude Code agent in the job's worktree (`--agents` + `--agent`), streaming its
 * steps into the job log. A follow-up round resumes the same Claude Code session, so the agent keeps its context.
 * Returns the agent's final message.
 */
async function runAgent(j, agentId, text, { resume = false } = {}) {
  const agent = await resolveAgent(agentId);
  if (!agent.enabled) throw Object.assign(new Error(`The ${agent.name} agent is turned off in Administration → Agents.`), { status: 400 });
  const { bin, env } = await claudeCodeCommand();
  const check = String(j.dev.checkCommand || '').trim();
  const checkTool = check ? `Bash(${check.split(/\s+/).slice(0, 2).join(' ')}:*)` : '';
  const agents = await claudeAgentsJson({ notes: j.dev.notes || '', checkTool });
  if (!agents[agentId]) throw Object.assign(new Error(`The ${agent.name} agent isn’t available.`), { status: 400 });
  const tools = [...agent.tools, ...(checkTool ? [checkTool] : [])];
  const model = j.dev.model || agent.model || 'opus';
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config',
    '--permission-mode', agent.writes ? 'acceptEdits' : 'default',
    '--agents', JSON.stringify(agents), '--agent', agentId,
    '--allowedTools', tools.join(' '),
    '--disallowedTools', 'Bash(git push:*) Bash(git commit:*) Bash(git checkout:*) Bash(git switch:*) Bash(git reset:*) Bash(git rebase:*) Bash(rm -rf:*) WebFetch WebSearch',
    '--model', model];
  if (agent.effort) args.push('--effort', agent.effort);
  if (resume && j.sessions?.[agentId]) args.push('--resume', j.sessions[agentId]);
  return new Promise((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ bin, args, { cwd: j.dir, env, stdio: ['pipe', 'pipe', 'pipe'] });
    j.child = child;
    (j.children ??= new Set()).add(child);
    let buf = '', stderr = '', result = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) { j.sessions = { ...(j.sessions || {}), [agentId]: ev.session_id }; }
        if (ev.type === 'assistant') {
          const sub = ev.parent_tool_use_id ? '  ↳ ' : '';
          for (const c of ev.message?.content || []) {
            if (c.type === 'tool_use') {
              const inp = c.input || {};
              const what = inp.file_path ? path.relative(j.dir, inp.file_path) : inp.subagent_type || inp.pattern || inp.command || inp.path || '';
              if (c.name === 'TodoWrite' && Array.isArray(inp.todos)) { j.todos = inp.todos.map((x) => ({ content: x.content, status: x.status })); say(j, `${sub}Planning: ${inp.todos.filter((x) => x.status === 'completed').length}/${inp.todos.length} steps done`, 'tool'); continue; }
              say(j, `${sub}${TOOL_VERB[c.name] || c.name} ${what}`.trim(), 'tool');
            } else if (c.type === 'text' && c.text.trim() && !sub) say(j, c.text.trim().split('\n')[0], 'text');
          }
        } else if (ev.type === 'result') {
          result = ev.result || '';
          if (ev.session_id) j.sessions = { ...(j.sessions || {}), [agentId]: ev.session_id };
          if (typeof ev.total_cost_usd === 'number') j.costUsd = (j.costUsd || 0) + ev.total_cost_usd;
          if (ev.is_error) stderr += ` ${ev.result || ''}`;
        }
      }
    });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      j.child = null; j.children?.delete(child);
      if (j.status === 'cancelled') return resolve('');
      if (code !== 0 && !result) return reject(new Error(stderr.trim().split('\n').slice(-2).join(' ') || `Claude Code stopped (code ${code})`));
      resolve(result.trim());
    });
    child.stdin.end(text);
  });
}

async function collectDiff(j) {
  await git(j.dir, ['add', '-A']);
  const stat = await git(j.dir, ['diff', '--cached', '--numstat']);
  j.files = stat.trim().split('\n').filter(Boolean).map((l) => { const [a, d, f] = l.split('\t'); return { path: f, added: Number(a) || 0, removed: Number(d) || 0 }; });
}
export async function jobDiff(id, file) {
  const j = JOBS.get(id);
  if (!j) throw Object.assign(new Error('That code job is gone (the server restarted). Start it again.'), { status: 404 });
  const out = await git(j.dir, ['diff', '--cached', '--no-color', ...(file ? ['--', file] : [])]);
  return out.length > MAX_DIFF ? `${out.slice(0, MAX_DIFF)}\n… (diff cut at ${MAX_DIFF.toLocaleString()} characters)` : out;
}

async function work(j, text, { resume = false } = {}) {
  j.status = 'running'; j.error = null;
  try {
    const agent = await resolveAgent(j.agentId);
    say(j, j.rounds === 1 ? `${agent.name} agent (Claude Code) is working on ${j.ticketKey} on ${j.branch}…` : `${agent.name} agent is making the requested changes…`);
    const result = await runAgent(j, j.agentId, text, { resume });
    if (j.status === 'cancelled') return;
    if (result) j.summary = [j.summary, result].filter(Boolean).join('\n\n---\n\n');
    await collectDiff(j);
    if (!agent.writes) { j.status = j.files.length ? 'review' : 'report'; say(j, `${agent.name} finished. Read its report below.`, 'done'); return; }
    j.status = j.files.length ? 'review' : 'empty';
    say(j, j.files.length ? `Done: ${j.files.length} file${j.files.length === 1 ? '' : 's'} changed. Review the diff (or ask the Review agent), then open the pull request.` : 'The agent finished without changing any files.', 'done');
  } catch (e) {
    j.status = 'failed'; j.error = e.message; say(j, e.message, 'error');
  } finally { j.finishedAt = new Date().toISOString(); }
}

/** Runs the Review agent on the job's changes (read-only); its findings are kept on the job. */
/**
 * Runs the Review agent on the job's changes (read-only); its findings are kept on the job. With { panel: true } the
 * Review Panel runs one Review agent per lens (lib/agents.js REVIEW_LENSES) in parallel.
 */
export async function reviewJob(id, { panel = false, agent = 'review' } = {}) {
  const reviewer = agent === 'ui-review' ? 'ui-review' : 'review';
  const rv = await ensureAgent(reviewer);
  const j = JOBS.get(id);
  if (!j) throw Object.assign(new Error('That code job is gone (the server restarted). Start it again.'), { status: 404 });
  if (j.status === 'running') throw Object.assign(new Error('Wait for the current round to finish.'), { status: 409 });
  if (!j.files?.length) throw Object.assign(new Error('There are no changes to review yet.'), { status: 409 });
  if (panel) await ensureAgent('review-panel');
  const before = j.status;
  j.status = 'running'; j.error = null;
  (async () => {
    try {
      say(j, panel ? `Review Panel: ${REVIEW_LENSES.length} Review agents (Claude Code) are reviewing in parallel: ${REVIEW_LENSES.map((l) => l.name).join(', ')}…` : `${rv.name} agent (Claude Code) is reviewing the changes…`);
      const diff = await jobDiff(id);
      const t = j.ticket;
      const text = [`Review the changes made for issue ${t.key}: ${t.title}.`, t.userStory && `User story: ${t.userStory}`,
        t.acceptanceCriteria?.length && `Acceptance criteria:\n${t.acceptanceCriteria.map((a, i) => `${i + 1}. ${a}`).join('\n')}`,
        `Changed files: ${j.files.map((f) => f.path).join(', ')}`, `The diff (staged, uncommitted):\n\`\`\`diff\n${diff.slice(0, 120000)}\n\`\`\``].filter(Boolean).join('\n\n');
      let entry;
      if (panel) {
        const lenses = await Promise.all(REVIEW_LENSES.map(async (l) => {
          try { return { id: l.id, name: l.name, text: await runAgent(j, 'review', `${text}\n\nYou are one reviewer on a panel. Review ONLY through the ${l.name} lens: ${l.focus}. Leave everything else to the other reviewers.`) }; }
          catch (e) { return { id: l.id, name: l.name, text: `_This reviewer failed: ${e.message}_` }; }
        }));
        entry = { at: new Date().toISOString(), round: j.rounds, panel: true, lenses, text: lenses.map((l) => `## ${l.name}\n\n${l.text}`).join('\n\n') };
      } else entry = { at: new Date().toISOString(), round: j.rounds, agent: rv.name, text: await runAgent(j, reviewer, text) };
      if (j.status === 'cancelled') return;
      j.reviews = [...(j.reviews || []), entry];
      j.status = before === 'running' ? 'review' : before;
      say(j, 'Review finished. Ask the Build agent to fix the findings, or open the pull request.', 'done');
    } catch (e) { j.status = before; j.error = e.message; say(j, e.message, 'error'); }
    finally { j.finishedAt = new Date().toISOString(); }
  })();
  return publicJob(j);
}

/** Starts a job: a fresh worktree and branch from the base branch, then Claude Code. */
export async function startJob({ projectId, ticket, dev, instructions, user, agentId = 'build', context = '', side = 'frontend' }) {
  if (!CODE_AGENT_IDS.includes(agentId)) throw Object.assign(new Error(`“${agentId}” isn’t a code agent.`), { status: 400 });
  const agent = await resolveAgent(agentId);
  if (!agent.enabled) throw Object.assign(new Error(`The ${agent.name} agent is turned off in Administration → Agents.`), { status: 400 });
  if (agentId === 'free-worker' && !String(instructions || '').trim()) throw Object.assign(new Error('Tell the Free Worker what to do in the instructions.'), { status: 400 });
  const running = [...JOBS.values()].find((x) => x.projectId === projectId && x.ticketId === ticket.id && (x.side || 'frontend') === side && x.status === 'running');
  if (running) throw Object.assign(new Error(`A code job is already running for this issue's ${side}.`), { status: 409 });
  const repo = await inspectRepo(dev.localPath);
  const base = dev.baseBranch || repo.defaultBranch;
  const branch = `${dev.branchPrefix ?? 'tf/'}${String(ticket.key || 'issue').toLowerCase()}-${slug(ticket.title)}`;
  const id = crypto.randomUUID().slice(0, 12);
  const dir = path.join(/*turbopackIgnore: true*/ WT_ROOT, projectId, `${String(ticket.key || id).toLowerCase()}${side === 'backend' ? '-be' : ''}-${id}`);
  const j = { id, projectId, ticketId: ticket.id, ticketKey: ticket.key, status: 'starting', branch, base, repo: dev.repo || repo.repo, repoPath: repo.path,
    dir, dev, log: [], startedAt: new Date().toISOString(), startedBy: user?.name, rounds: 1, files: [], summary: '', ticket, agentId, agentName: agent.name, sessions: {}, reviews: [], todos: [], side, localOnly: Boolean(dev.localOnly) };
  JOBS.set(id, j);
  say(j, `Fetching ${base} from origin…`);
  await git(repo.path, ['fetch', 'origin', base], { timeout: 180000 }).catch((e) => say(j, `Couldn’t fetch (${e.message}); using the local ${base}.`, 'warn'));
  const start = await git(repo.path, ['rev-parse', '--verify', '--quiet', `origin/${base}`]).then(() => `origin/${base}`, () => base);
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(dir), { recursive: true });
  // -B: reuse the branch name if an earlier job for this issue left it behind.
  await git(repo.path, ['worktree', 'add', '-B', branch, dir, start]);
  say(j, `Created branch ${branch} from ${start} in its own worktree.`);
  work(j, prompt(ticket, agent, instructions, 1, context)); // runs in the background
  return publicJob(j);
}
/** Another round on the same worktree: "also handle…", "rename…". */
export async function followUp(id, text) {
  const j = JOBS.get(id);
  if (!j) throw Object.assign(new Error('That code job is gone (the server restarted). Start it again.'), { status: 404 });
  if (j.status === 'running') throw Object.assign(new Error('Wait for the current round to finish.'), { status: 409 });
  if (j.pr) throw Object.assign(new Error('The pull request is already open. Push further changes from your editor, or start a new job.'), { status: 409 });
  j.rounds++;
  say(j, `You: ${text}`, 'you');
  // The agent that writes code takes follow-ups; after a read-only report, Build continues from it.
  if (!(await resolveAgent(j.agentId)).writes) { j.agentId = 'build'; j.agentName = 'Build a Ticket'; }
  work(j, prompt(j.ticket, await resolveAgent(j.agentId), text, j.rounds), { resume: Boolean(j.sessions?.[j.agentId]) });
  return publicJob(j);
}
export function cancelJob(id) {
  const j = JOBS.get(id);
  if (!j) return null;
  if (j.status === 'running') { j.status = 'cancelled'; for (const c of j.children || []) c.kill('SIGTERM'); j.child?.kill('SIGTERM'); say(j, 'Stopped.', 'warn'); }
  return publicJob(j);
}
/** Removes the worktree (and the branch, unless a pull request uses it). */
export async function discardJob(id) {
  const j = JOBS.get(id);
  if (!j) return null;
  if (j.status === 'running') cancelJob(id);
  await git(j.repoPath, ['worktree', 'remove', '--force', j.dir]).catch(() => fs.rmSync(/*turbopackIgnore: true*/ j.dir, { recursive: true, force: true }));
  if (!j.pr) await git(j.repoPath, ['branch', '-D', j.branch]).catch(() => {});
  j.status = 'discarded';
  return publicJob(j);
}

/**
 * Local-only repositories (the backend, for now): commits the reviewed changes on the job's branch in the local
 * repository. Nothing is pushed. The worktree is removed; the branch stays for you to push or merge.
 */
export async function commitLocal(id, { title, appLink } = {}) {
  const j = JOBS.get(id);
  if (!j) throw Object.assign(new Error('That code job is gone (the server restarted). Start it again.'), { status: 404 });
  if (j.status !== 'review') throw Object.assign(new Error(j.committedAt ? 'Already committed.' : 'There are no changes to commit.'), { status: 409 });
  const t = j.ticket;
  const msg = String(title || `${t.key}: ${t.title}`).slice(0, 250);
  await git(j.dir, ['add', '-A']);
  await git(j.dir, ['commit', '-F', '-', '--no-verify'], { input: `${msg}\n\n${t.userStory || ''}\n\nRefs ${t.key}${appLink ? ` (${appLink})` : ''}\n`.replace(/\n{3,}/g, '\n\n') });
  const sha = (await git(j.dir, ['rev-parse', '--short', 'HEAD'])).trim();
  j.status = 'committed';
  j.committedAt = new Date().toISOString();
  say(j, `Committed ${sha} on the local branch ${j.branch} in ${j.repoPath}. Nothing was pushed.`, 'done');
  await git(j.repoPath, ['worktree', 'remove', '--force', j.dir]).catch(() => {});
  return { job: publicJob(j), commit: { sha, branch: j.branch, repoPath: j.repoPath } };
}

/** Where a repository's `origin` is hosted: { provider: 'GitHub' | 'GitLab', host, path } (path = owner/name or group/…/project). */
export async function remoteInfo(repoPath) {
  const url = (await git(repoPath, ['remote', 'get-url', 'origin']).catch(() => '')).trim();
  const m = url.match(/^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/]+@)([^/:]+)(?::\d+)?[:/]+(.+?)(?:\.git)?\/?$/i);
  if (!m) return { provider: null, host: '', path: '', url };
  const host = m[1].toLowerCase();
  return { provider: /github\.com$/.test(host) ? 'GitHub' : /gitlab/.test(host) || host.startsWith('git.') ? 'GitLab' : null, host, path: m[2], url: url.replace(/\/\/[^@/]+@/, '//') };
}

/**
 * Commits the reviewed changes, pushes the branch and opens the review: a pull request on GitHub, a merge request on
 * GitLab (gitlab.com or self-hosted). The provider comes from the repository's origin remote.
 */
export async function openPullRequest(id, { title, body, draft, token, gitlabToken, appLink }) {
  const j = JOBS.get(id);
  if (!j) throw Object.assign(new Error('That code job is gone (the server restarted). Start it again.'), { status: 404 });
  if (!['review'].includes(j.status)) throw Object.assign(new Error(j.pr ? 'The pull request is already open.' : 'There are no changes to open a pull request for.'), { status: 409 });
  const remote = await remoteInfo(j.repoPath);
  const provider = remote.provider || (j.repo ? 'GitHub' : null);
  if (!provider) throw Object.assign(new Error(`Can’t tell where ${j.repoPath} is hosted (origin: ${remote.url || 'none'}). Pull requests work with GitHub and GitLab.`), { status: 400 });
  const t = j.ticket;
  const prTitle = String(title || `${t.key}: ${t.title}`).slice(0, 250);
  await git(j.dir, ['add', '-A']);
  await git(j.dir, ['commit', '-F', '-', '--no-verify'], { input: `${prTitle}\n\n${t.userStory || ''}\n\nRefs ${t.key}${appLink ? ` (${appLink})` : ''}\n`.replace(/\n{3,}/g, '\n\n') });
  say(j, 'Committed the changes.');
  const prBody = body || [
    `Implements **${t.key}: ${t.title}**${appLink ? ` ([TicketForge](${appLink}))` : ''}${j.side === 'backend' ? ' — backend part' : ''}.`,
    t.userStory && `\n> ${t.userStory}`,
    t.acceptanceCriteria?.length && `\n### Acceptance criteria\n${t.acceptanceCriteria.map((a) => `- [ ] ${a}`).join('\n')}`,
    j.summary && `\n### What changed\n${j.summary.slice(0, 6000)}`,
    `\n_Written with Claude Code from TicketForge; reviewed by ${j.startedBy || 'the team'} before opening._`,
  ].filter(Boolean).join('\n');
  const done = (pr) => {
    j.pr = pr;
    j.status = 'pr';
    say(j, `Opened ${provider === 'GitLab' ? `merge request !${pr.number}` : `pull request #${pr.number}`}.`, 'done');
    git(j.repoPath, ['worktree', 'remove', '--force', j.dir]).catch(() => {}); // the branch stays for the review
    return { job: publicJob(j), pr: { url: pr.url, number: pr.number, title: pr.title, status: pr.draft ? 'Draft' : 'Open', repo: pr.repo, provider, branch: j.branch, base: j.base } };
  };

  if (provider === 'GitLab') {
    const tok = gitlabToken || process.env.GITLAB_TOKEN || '';
    // Push with the token for this command only; without one, git uses your own credentials (SSH key or credential helper).
    const authArgs = tok && /^https?:/i.test(remote.url) ? ['-c', `http.https://${remote.host}/.extraheader=AUTHORIZATION: basic ${Buffer.from(`oauth2:${tok}`).toString('base64')}`] : [];
    await git(j.dir, [...authArgs, 'push', '-u', 'origin', `HEAD:refs/heads/${j.branch}`], { timeout: 180000 });
    say(j, `Pushed ${j.branch}.`);
    const newMr = `https://${remote.host}/${remote.path}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(j.branch)}&merge_request%5Btarget_branch%5D=${encodeURIComponent(j.base)}`;
    if (!tok) throw Object.assign(new Error(`Pushed, but there’s no GitLab token to open the merge request with: save one in Project settings → Code & GitHub → Backend repository, or open it on GitLab: ${newMr}`), { status: 400 });
    const res = await fetch(`https://${remote.host}/api/v4/projects/${encodeURIComponent(remote.path)}/merge_requests`, {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': tok, 'Content-Type': 'application/json', 'User-Agent': 'TicketForge' },
      body: JSON.stringify({ source_branch: j.branch, target_branch: j.base, title: draft ? `Draft: ${prTitle}` : prTitle, description: prBody, remove_source_branch: true }),
    });
    const mr = await res.json().catch(() => ({}));
    if (!res.ok) {
      const why = Array.isArray(mr.message) ? mr.message.join('; ') : typeof mr.message === 'object' ? JSON.stringify(mr.message) : mr.message || mr.error || `GitLab said ${res.status}`;
      throw Object.assign(new Error(`The branch is pushed, but GitLab didn’t open the merge request: ${why}. Open it here: ${newMr}`), { status: 400 });
    }
    return done({ url: mr.web_url, number: mr.iid, title: mr.title, draft: Boolean(mr.draft || mr.work_in_progress), repo: remote.path });
  }

  // GitHub
  const repo = remote.provider === 'GitHub' ? remote.path : j.repo;
  const tok = await githubToken(token);
  const authArgs = tok ? ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${tok}`).toString('base64')}`] : [];
  await git(j.dir, [...authArgs, 'push', '-u', 'origin', `HEAD:refs/heads/${j.branch}`], { timeout: 180000 });
  say(j, `Pushed ${j.branch}.`);
  if (!tok) throw Object.assign(new Error('Pushed, but there’s no GitHub token to open the pull request with: save one in Project settings → Code & GitHub, sign in with `gh auth login`, or open it on GitHub.'), { status: 400 });
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'User-Agent': 'TicketForge', 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: prTitle, head: j.branch, base: j.base, body: prBody, draft: Boolean(draft) }),
  });
  const pr = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = pr.errors?.map((e) => e.message).filter(Boolean).join('; ') || pr.message || `GitHub said ${res.status}`;
    throw Object.assign(new Error(`The branch is pushed, but GitHub didn’t open the pull request: ${why}`), { status: 400 });
  }
  return done({ url: pr.html_url, number: pr.number, title: pr.title, draft: pr.draft, repo });
}
