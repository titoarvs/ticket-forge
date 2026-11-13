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
import { claudeCodeCommand, askJson, agentModel, noteAgentUsage } from './claude.js';
import { reviewWorktree } from './coderabbit.js';
import { resolveAgent, claudeAgentsJson, codeAgentIds, ensureAgent, REVIEW_LENSES, requireRole } from './agents.js';

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
  const ri = await remoteInfo(top);
  return { path: top, remote: remote.replace(/\/\/[^@/]+@/, '//'), repo: repoFromRemote(remote) || ri.path, provider: ri.provider, host: ri.host, defaultBranch: base, currentBranch: current, uncommitted: dirty };
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
  side: j.side || 'frontend', localOnly: Boolean(j.localOnly), provider: j.provider || 'GitHub', target: j.target || null, repoPath: j.repoPath, committedAt: j.committedAt || null,
  kind: j.kind || null, posted: j.posted || null, updateLabel: j.updateLabel || null,
  coderabbit: j.cr ? { ...j.cr, log: (j.cr.log || []).slice(-30) } : null,
});
export const getJob = (id, since) => publicJob(JOBS.get(id), since);
/** Every job of a project (newest first, without logs), for the jobs overview. */
export function listJobs(projectId) {
  return [...JOBS.values()].filter((j) => j.projectId === projectId && j.status !== 'discarded')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((j) => { const { log, summary, reviews, todos, ...rest } = publicJob(j); return { ...rest, last: j.log[j.log.length - 1]?.text || '', reviewCount: (reviews || []).length, todosDone: (todos || []).filter((x) => x.status === 'completed').length, todosTotal: (todos || []).length }; });
}
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
// Dependency folders that are installed, not committed. A fresh worktree has none of them, so the check command
// (tests, lint, type check) can't run and the agent guesses instead of verifying. They are linked from your checkout.
const DEP_DIRS = ['node_modules', 'vendor', '.venv', 'venv'];
const WORKSPACE_PARENTS = ['packages', 'apps', 'services', 'libs', 'modules'];
function linkDependencies(j) {
  const linked = [];
  const link = (rel) => {
    const src = path.join(/*turbopackIgnore: true*/ j.repoPath, rel), dst = path.join(/*turbopackIgnore: true*/ j.dir, rel);
    try {
      if (!fs.statSync(src).isDirectory() || fs.existsSync(dst) || !fs.existsSync(path.dirname(dst))) return;
      fs.symlinkSync(src, dst, 'dir');
      linked.push(rel);
    } catch { /* not installed here */ }
  };
  for (const d of DEP_DIRS) link(d);
  for (const parent of WORKSPACE_PARENTS) {
    let subs = [];
    try { subs = fs.readdirSync(/*turbopackIgnore: true*/ path.join(j.repoPath, parent)); } catch { continue; }
    for (const sub of subs.slice(0, 80)) link(path.join(parent, sub, 'node_modules'));
  }
  j.linked = linked;
  return linked;
}
/** Stages the agent's changes, never the linked dependency folders. */
const stageAll = (j) => git(j.dir, ['add', '-A', '--', '.', ...(j.linked || []).map((p) => `:(exclude)${p}`)]);

/** Claude Code permission rules for the check command: one per part of `a && b; c`, plus read-only git. */
export function checkTools(check) {
  const parts = String(check || '').split(/&&|\|\||;|\|/).map((x) => x.trim()).filter(Boolean)
    .map((x) => x.replace(/^(\w+=\S*\s+)+/, '')) // FOO=1 npm test → npm test
    .filter((x) => !/^(cd|rm|git|sudo)\b/.test(x));
  const rules = parts.map((x) => `Bash(${x.split(/\s+/).slice(0, 2).join(' ')}:*)`);
  return [...new Set([...rules, 'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(git log:*)', 'Bash(git show:*)'])];
}

/** What the agent needs to know about verifying its work, added to every round. */
function verifyNote(j, writes) {
  const check = String(j.dev.checkCommand || '').trim();
  const deps = j.linked?.length ? `Dependencies are already installed (${j.linked.slice(0, 4).join(', ')}${j.linked.length > 4 ? '…' : ''} linked from the main checkout): don't install packages.` : '';
  if (!writes) return deps;
  return [check ? `Check command for this repository: \`${check}\`. Run it before you finish and fix what fails (at most 3 fix-and-rerun cycles; if it still fails, explain why).`
    : 'No check command is configured, so you can\'t run tests here. Re-read your changes against each acceptance criterion instead, and say in your summary which tests a person should run.',
  deps, 'You can run `git diff` and `git status` to review your own changes.'].filter(Boolean).join('\n');
}

const say = (j, text, kind = 'info') => { j.log.push({ at: new Date().toISOString(), kind, text: String(text).slice(0, 500) }); if (j.log.length > 800) j.log.splice(0, j.log.length - 800); };

const TOOL_VERB = { Read: 'Reading', Edit: 'Editing', MultiEdit: 'Editing', Write: 'Writing', Glob: 'Finding files', Grep: 'Searching', LS: 'Listing', Bash: 'Running', TodoWrite: 'Planning', Task: 'Delegating to', Agent: 'Delegating to' };

const clipText = (x, n) => { const t = String(x || '').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
/** The `## ` sections of a Markdown document whose heading matches `re`. */
const mdSections = (md, re) => String(md || '').split(/^(?=##\s)/m).filter((sec) => re.test(sec.split('\n')[0])).join('\n').trim();
/**
 * The feature around an issue, so the agent builds the right thing: the epic, the issue's sub-tasks, the other
 * issues in the epic (so it doesn't build their parts), and the epic's Feature Brief requirements and Architecture Record.
 */
export function issueContext(project, ticket) {
  const epic = (project.epics || []).find((e) => e.id === ticket.epicId);
  const subtasks = project.tickets.filter((t) => t.parentId === ticket.id);
  const siblings = epic ? project.tickets.filter((t) => t.epicId === epic.id && !t.parentId && t.id !== ticket.id) : [];
  const fbd = epic?.fbd?.markdown ? mdSections(epic.fbd.markdown, /scope|requirement|acceptance/i) : '';
  const ard = epic?.ard?.markdown || '';
  return [
    `PROJECT: ${project.name}${project.description ? ` — ${clipText(project.description, 600)}` : ''}`,
    epic && `FEATURE (epic) this issue belongs to: ${epic.key || ''} ${epic.title}${epic.description ? `\n${clipText(epic.description, 1200)}` : ''}`,
    subtasks.length && `Sub-tasks of this issue (all part of this job):\n${subtasks.slice(0, 30).map((t) => `- ${t.key || ''} ${t.title}${t.description ? `: ${clipText(t.description, 300)}` : ''}`).join('\n')}`,
    siblings.length && `Other issues in the same feature (separate jobs: don't build them, but stay compatible with them):\n${siblings.slice(0, 30).map((t) => `- ${t.key || ''} ${t.title}`).join('\n')}`,
    fbd && `From the feature's Feature Brief (requirements and acceptance criteria; the parts that concern this issue apply):\n${clipText(fbd, 6000)}`,
    ard && `The feature's Architecture Record Design (follow its decisions):\n${clipText(ard, 8000)}`,
  ].filter(Boolean).join('\n\n');
}

/**
 * One API contract for an issue built in both repositories at once, so the backend and frontend jobs can run in
 * parallel and still meet: the backend implements exactly this, the frontend calls exactly this. Markdown.
 */
export async function apiContract({ project, ticket, ai = {} }) {
  const t = ticket;
  const res = await askJson({ ...ai, task: 'repo', reasoning: 'fast', system: `You are a senior engineer agreeing the API between a frontend and a backend
before two developers build one issue in parallel. Keep it minimal: only the endpoints this issue needs. Use REST and JSON,
plural resource paths, consistent field names in camelCase. When the issue extends an endpoint that probably
already exists (for example a list the app already shows), never redesign it: keep its current response shape and
describe only what is added ("existing response; each item gains stock: integer"). Return JSON only.`, prompt: `Project: ${project.name}
Issue ${t.key}: ${t.title}
${t.userStory ? `User story: ${t.userStory}\n` : ''}${t.description ? `Description: ${clipText(t.description, 2500)}\n` : ''}${t.acceptanceCriteria?.length ? `Acceptance criteria:\n${t.acceptanceCriteria.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n` : ''}
Return {"endpoints":[{"method":"GET|POST|PUT|PATCH|DELETE","path":"/api/...","purpose":"...","request":"JSON shape or query params, or none","response":"JSON shape on success, with status","errors":"status codes and when"}],"notes":"shared rules: auth, validation, pagination, money/date formats (short)"}` });
  const eps = Array.isArray(res?.endpoints) ? res.endpoints.slice(0, 12) : [];
  if (!eps.length) return '';
  return [...eps.map((e) => `- **${String(e.method || 'GET').toUpperCase()} ${e.path}**: ${e.purpose || ''}\n  Request: ${e.request || 'none'}\n  Response: ${e.response || ''}\n  Errors: ${e.errors || 'n/a'}`),
    res.notes ? `\nShared rules: ${res.notes}` : ''].join('\n');
}

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
  const extra = checkTools(j.dev.checkCommand);
  const agents = await claudeAgentsJson({ notes: j.dev.notes || '', checkTool: extra });
  if (!agents[agentId]) throw Object.assign(new Error(`The ${agent.name} agent isn’t available.`), { status: 400 });
  const tools = [...agent.tools, ...extra];
  const note = verifyNote(j, agent.writes);
  if (note) text = `${text}\n\n${note}`;
  // The Repository Profile (Learn from repository): how this codebase is built, for the first round of a job.
  const profile = String(j.dev.repoProfile?.markdown || '').trim();
  if (profile && !resume) text = `${text}\n\nREPOSITORY PROFILE (learned from this repository${j.dev.repoProfile.commit ? ` at ${j.dev.repoProfile.commit}` : ''}; follow its structure, conventions and patterns, and check it against the code when something looks different):\n${profile}`;
  const routed = await agentModel(agentId, agent);
  const model = j.dev.model || routed.model;
  if (agents[agentId]) agents[agentId].model = model; // the agent definition's model would win over --model
  const started = Date.now(), costBefore = j.costUsd || 0;
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
      noteAgentUsage({ task: routed.task, model, ms: Date.now() - started, costUsd: (j.costUsd || 0) - costBefore });
      if (j.status === 'cancelled') return resolve('');
      if (code !== 0 && !result) return reject(new Error(stderr.trim().split('\n').slice(-2).join(' ') || `Claude Code stopped (code ${code})`));
      resolve(result.trim());
    });
    child.stdin.end(text);
  });
}

async function collectDiff(j) {
  await stageAll(j);
  const stat = await git(j.dir, ['diff', '--cached', '--numstat']);
  j.files = stat.trim().split('\n').filter(Boolean).map((l) => { const [a, d, f] = l.split('\t'); return { path: f, added: Number(a) || 0, removed: Number(d) || 0 }; });
}
export async function jobDiff(id, file) {
  const j = JOBS.get(id);
  if (!j) throw Object.assign(new Error('That code job is gone (the server restarted). Start it again.'), { status: 404 });
  const out = await git(j.dir, ['diff', '--cached', '--no-color', ...(file ? ['--', file] : [])]);
  return out.length > MAX_DIFF ? `${out.slice(0, MAX_DIFF)}\n… (diff cut at ${MAX_DIFF.toLocaleString()} characters)` : out;
}

// How many agent rounds run at once on this machine; the rest wait in order (status "queued"). Each round is a
// Claude Code process, so this keeps a batch of tickets from overloading the computer or the account's rate limits.
export const MAX_PARALLEL = Math.max(1, Math.min(10, Number(process.env.TICKETFORGE_CODE_PARALLEL) || 3));
G.__tfDevQueue ??= { running: 0, waiting: [] };
const Q = G.__tfDevQueue;
/** Waits for a free slot. Returns false when the job was stopped while it waited. */
function takeSlot(j) {
  if (Q.running < MAX_PARALLEL) { Q.running++; return Promise.resolve(true); }
  j.status = 'queued';
  say(j, `Waiting for a free slot: ${MAX_PARALLEL} agents already running (${Q.waiting.length + 1} in line).`);
  return new Promise((resolve) => Q.waiting.push({ j, resolve }));
}
function releaseSlot() {
  while (Q.waiting.length) {
    const next = Q.waiting.shift();
    if (next.j.status === 'cancelled') { next.resolve(false); continue; }
    next.resolve(true); return; // the slot passes straight to the next job
  }
  Q.running = Math.max(0, Q.running - 1);
}
/** The queue as numbers, for the jobs overview. */
export const queueInfo = () => ({ running: Q.running, waiting: Q.waiting.length, max: MAX_PARALLEL });

async function work(j, text, opts = {}) {
  j.error = null;
  if (!(await takeSlot(j))) { j.finishedAt = new Date().toISOString(); return; }
  try { await workNow(j, text, opts); } finally { releaseSlot(); }
}
async function workNow(j, text, { resume = false } = {}) {
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
  const reviewer = agent === 'ui-review' || /^custom-/.test(agent) ? agent : await requireRole('review');
  const rv = await ensureAgent(reviewer);
  const j = JOBS.get(id);
  if (!j) throw Object.assign(new Error('That code job is gone (the server restarted). Start it again.'), { status: 404 });
  if (['running', 'queued', 'starting'].includes(j.status)) throw Object.assign(new Error('Wait for the current round to finish.'), { status: 409 });
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
          try { return { id: l.id, name: l.name, text: await runAgent(j, reviewer, `${text}\n\nYou are one reviewer on a panel. Review ONLY through the ${l.name} lens: ${l.focus}. Leave everything else to the other reviewers.`) }; }
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

// git fetch and worktree add in the same repository at the same time can fail on its lock files: one at a time per repo.
G.__tfRepoLocks ??= new Map();
function withRepoLock(key, fn) {
  const prev = G.__tfRepoLocks.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  G.__tfRepoLocks.set(key, run.catch(() => {}));
  return run;
}
/**
 * CodeRabbit review of the job's changes (read-only, in the background; can take many minutes). The findings are
 * kept on the job as j.cr; the browser saves them on the issue so they last and show in Reports.
 */
export async function codeRabbitJob(id, { apiKey = '' } = {}) {
  const j = JOBS.get(id);
  if (!j) throw Object.assign(new Error('That code job is gone (the server restarted). Start it again.'), { status: 404 });
  if (j.cr?.status === 'running') throw Object.assign(new Error('CodeRabbit is already reviewing these changes.'), { status: 409 });
  if (['running', 'queued', 'starting'].includes(j.status)) throw Object.assign(new Error('Wait for the agent to finish first.'), { status: 409 });
  if (!j.files?.length) throw Object.assign(new Error('There are no changes to review yet.'), { status: 409 });
  await stageAll(j);
  j.cr = { status: 'running', startedAt: new Date().toISOString(), round: j.rounds, findings: [], log: [] };
  say(j, 'CodeRabbit is reviewing the changes (this can take several minutes)…');
  (async () => {
    try {
      const r = await reviewWorktree({ dir: j.dir, apiKey,
        register: (child) => (j.children ??= new Set()).add(child),
        onEvent: (kind, data) => { if (kind === 'status' && data) j.cr.log.push(data); if (kind === 'finding') j.cr.findings.push(data); } });
      const order = ['critical', 'major', 'minor', 'trivial', 'info'];
      j.cr = { ...j.cr, status: 'done', finishedAt: new Date().toISOString(), findings: r.findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)), complete: r.complete, warning: r.error || (r.complete?.unreviewedFileCount ? `${r.complete.unreviewedFileCount} file(s) weren't reviewed.` : '') };
      const n = (s2) => r.findings.filter((f) => f.severity === s2).length;
      say(j, r.findings.length ? `CodeRabbit finished: ${r.findings.length} finding${r.findings.length === 1 ? '' : 's'} (${n('critical')} critical, ${n('major')} major).` : 'CodeRabbit finished: no findings.', 'done');
    } catch (e) {
      j.cr = { ...j.cr, status: 'failed', finishedAt: new Date().toISOString(), error: e.message };
      say(j, `CodeRabbit: ${e.message}`, 'error');
    }
  })();
  return publicJob(j);
}

/** Starts a job: a fresh worktree and branch from the base branch, then Claude Code (queued when the machine is busy). */
export function startJob(args) { return withRepoLock(path.resolve(String(args.dev?.localPath || '')), () => startJobNow(args)); }
async function startJobNow({ projectId, ticket, dev, instructions, user, agentId = 'build', context = '', side = 'frontend', target = null }) {
  if (!(await codeAgentIds()).includes(agentId)) throw Object.assign(new Error(`“${agentId}” isn’t a code agent.`), { status: 400 });
  const agent = await resolveAgent(agentId);
  if (!agent.enabled) throw Object.assign(new Error(`The ${agent.name} agent is turned off in Administration → Agents.`), { status: 400 });
  if (agentId === 'free-worker' && !String(instructions || '').trim()) throw Object.assign(new Error('Tell the Free Worker what to do in the instructions.'), { status: 400 });
  const running = [...JOBS.values()].find((x) => x.projectId === projectId && x.ticketId === ticket.id && (x.side || 'frontend') === side && ['running', 'queued', 'starting'].includes(x.status));
  if (running) throw Object.assign(new Error(`A code job is already running for this issue's ${side}.`), { status: 409 });
  const repo = await inspectRepo(dev.localPath);
  // target: an open pull/merge request to update ({ url, number, branch, base, title, provider }) — work on its branch.
  const base = target?.base || dev.baseBranch || repo.defaultBranch;
  const branch = target?.branch || `${dev.branchPrefix ?? 'tf/'}${String(ticket.key || 'issue').toLowerCase()}-${slug(ticket.title)}`;
  const id = crypto.randomUUID().slice(0, 12);
  const dir = path.join(/*turbopackIgnore: true*/ WT_ROOT, projectId, `${String(ticket.key || id).toLowerCase()}${side === 'backend' ? '-be' : ''}-${id}`);
  const j = { id, projectId, ticketId: ticket.id, ticketKey: ticket.key, status: 'starting', branch, base, repo: dev.repo || repo.repo, repoPath: repo.path,
    dir, dev, log: [], startedAt: new Date().toISOString(), startedBy: user?.name, rounds: 1, files: [], summary: '', ticket, agentId, agentName: agent.name, sessions: {}, reviews: [], todos: [], side, localOnly: Boolean(dev.localOnly), provider: repo.provider || (dev.repo ? 'GitHub' : null), target: target || null };
  JOBS.set(id, j);
  if (target) {
    say(j, `Fetching the pull request branch ${branch} from origin…`);
    await git(repo.path, ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`, base], { timeout: 180000 }).catch((e) => { JOBS.delete(id); throw Object.assign(new Error(`Couldn’t fetch the branch ${branch} of ${target.url}: ${e.message}`), { status: 400 }); });
    fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(dir), { recursive: true });
    // Read-only agents (reviews) use a detached checkout: the branch may already be checked out in your own folder.
    await git(repo.path, agent.writes ? ['worktree', 'add', '-B', branch, dir, `origin/${branch}`] : ['worktree', 'add', '--detach', dir, `origin/${branch}`])
      .catch((e) => { JOBS.delete(id); throw /already (used|checked out) by worktree/i.test(e.message)
        ? Object.assign(new Error(`The branch ${branch} is checked out in another folder (${e.message.match(/worktree at '([^']+)'/)?.[1] || 'another worktree'}). Switch that folder to another branch, then try again.`), { status: 409 }) : e; });
    linkDependencies(j);
    say(j, `Checked out ${branch} (the branch of ${target.provider === 'GitLab' ? `!${target.number}` : `#${target.number}`}) in its own worktree. ${agent.writes ? `Changes go to the same ${target.provider === 'GitLab' ? 'merge request' : 'pull request'}.` : 'Read-only: nothing is changed or pushed.'}`);
    work(j, prompt(ticket, agent, instructions, 1, context));
    return publicJob(j);
  }
  say(j, `Fetching ${base} from origin…`);
  await git(repo.path, ['fetch', 'origin', base], { timeout: 180000 }).catch((e) => say(j, `Couldn’t fetch (${e.message}); using the local ${base}.`, 'warn'));
  const start = await git(repo.path, ['rev-parse', '--verify', '--quiet', `origin/${base}`]).then(() => `origin/${base}`, () => base);
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(dir), { recursive: true });
  // -B: reuse the branch name if an earlier job for this issue left it behind.
  await git(repo.path, ['worktree', 'add', '-B', branch, dir, start]);
  const linked = linkDependencies(j);
  say(j, `Created branch ${branch} from ${start} in its own worktree.${linked.length ? ` Linked the installed dependencies (${linked.join(', ')}) so tests can run.` : ''}`);
  work(j, prompt(ticket, agent, instructions, 1, context)); // runs in the background
  return publicJob(j);
}
/** Another round on the same worktree: "also handle…", "rename…". */
export async function followUp(id, text) {
  const j = JOBS.get(id);
  if (!j) throw Object.assign(new Error('That code job is gone (the server restarted). Start it again.'), { status: 404 });
  if (['running', 'queued', 'starting'].includes(j.status)) throw Object.assign(new Error('Wait for the current round to finish.'), { status: 409 });
  if (j.pr) throw Object.assign(new Error('The pull request is already open. Push further changes from your editor, or start a new job.'), { status: 409 });
  j.rounds++;
  say(j, `You: ${text}`, 'you');
  // The agent that writes code takes follow-ups; after a read-only report, Build continues from it.
  if (!(await resolveAgent(j.agentId).catch(() => ({ writes: false }))).writes) { j.agentId = await requireRole(j.side === 'backend' ? 'backend' : 'build'); j.agentName = (await resolveAgent(j.agentId)).name; }
  work(j, prompt(j.ticket, await resolveAgent(j.agentId), text, j.rounds), { resume: Boolean(j.sessions?.[j.agentId]) });
  return publicJob(j);
}
export function cancelJob(id) {
  const j = JOBS.get(id);
  if (!j) return null;
  if (j.status === 'queued') { j.status = 'cancelled'; say(j, 'Removed from the queue.', 'warn'); return publicJob(j); }
  if (j.status === 'running') { j.status = 'cancelled'; for (const c of j.children || []) c.kill('SIGTERM'); j.child?.kill('SIGTERM'); say(j, 'Stopped.', 'warn'); }
  return publicJob(j);
}
/** Removes the worktree (and the branch, unless a pull request uses it). */
export async function discardJob(id) {
  const j = JOBS.get(id);
  if (!j) return null;
  if (['running', 'queued'].includes(j.status)) cancelJob(id);
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
  await stageAll(j);
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
/** A short label for an update job ("Address review comments"), used in its commit message and PR comment. */
export function setUpdateLabel(id, label) { const j = JOBS.get(id); if (j) j.updateLabel = label; }

/** Pushes the job's branch to origin, with a token for this command only (never stored in the repository's config). */
async function pushBranch(j, remote, { token, gitlabToken } = {}) {
  let auth = [];
  if (remote.provider === 'GitLab') {
    const tok = gitlabToken || process.env.GITLAB_TOKEN || '';
    if (tok && /^https?:/i.test(remote.url)) auth = ['-c', `http.https://${remote.host}/.extraheader=AUTHORIZATION: basic ${Buffer.from(`oauth2:${tok}`).toString('base64')}`];
  } else {
    const tok = await githubToken(token);
    if (tok) auth = ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${tok}`).toString('base64')}`];
  }
  await git(j.dir, [...auth, 'push', '-u', 'origin', `HEAD:refs/heads/${j.branch}`], { timeout: 180000 });
  say(j, `Pushed ${j.branch}.`);
}
const prNoun = (provider) => (provider === 'GitLab' ? 'merge request' : 'pull request');
const prRef = (provider, n) => (provider === 'GitLab' ? `!${n}` : `#${n}`);

/** Calls the GitHub or GitLab API for a pull/merge request. */
async function prApi(remote, target, { token, gitlabToken }, method, sub = '', bodyIn) {
  if (remote.provider === 'GitLab') {
    const tok = gitlabToken || process.env.GITLAB_TOKEN || '';
    if (!tok) throw Object.assign(new Error('No GitLab token: save one in Project settings → Code & GitHub → Backend repository.'), { status: 400 });
    const res = await fetch(`https://${remote.host}/api/v4/projects/${encodeURIComponent(remote.path)}/merge_requests/${target.number}${sub}`, {
      method, headers: { 'PRIVATE-TOKEN': tok, 'Content-Type': 'application/json', 'User-Agent': 'TicketForge' }, body: bodyIn ? JSON.stringify(bodyIn) : undefined });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`GitLab said ${res.status}: ${out.message || out.error || ''}`), { status: 400 });
    return out;
  }
  const tok = await githubToken(token);
  if (!tok) throw Object.assign(new Error('No GitHub token: save one in Project settings → Code & GitHub, or sign in with `gh auth login`.'), { status: 400 });
  const res = await fetch(`https://api.github.com/repos/${remote.path}${sub.startsWith('/issues') ? sub.replace('/issues', `/issues/${target.number}`) : `/pulls/${target.number}${sub}`}`, {
    method, headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'User-Agent': 'TicketForge', 'Content-Type': 'application/json' }, body: bodyIn ? JSON.stringify(bodyIn) : undefined });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`GitHub said ${res.status}: ${out.message || ''}`), { status: 400 });
  return out;
}

/**
 * Writes a pull request's title and description from what changed: the diff, the agent's summary and the issue.
 * Returns { title, body } (Markdown).
 */
export async function writePrText({ ticket, diff, summary = '', side = '', provider = 'GitHub', appLink = '', ai = {} }) {
  const t = ticket;
  const res = await askJson({ ...ai, task: 'pr', reasoning: 'fast', system: `You write clear ${prNoun(provider)} descriptions for code review. Plain, specific, short sentences.
Use only what the diff and notes show; never invent behaviour. Return JSON only.`, prompt: `Issue ${t.key}: ${t.title}
User story: ${t.userStory || 'n/a'}
Acceptance criteria:
${(t.acceptanceCriteria || []).map((a, i) => `${i + 1}. ${a}`).join('\n') || 'n/a'}
${side ? `Part: ${side}\n` : ''}${summary ? `Agent's summary of the work:\n${String(summary).slice(0, 5000)}\n` : ''}
DIFF:
${String(diff).slice(0, 45000) || '(empty)'}

Write the ${prNoun(provider)}:
- "title": "${t.key}: " + an imperative summary of what this change does, at most 72 characters in all.
- "body": Markdown with these sections: "## Summary" (2–3 sentences: what and why), "## Changes" (bullets grouped by area, naming key files),
  ${side === 'backend' ? '"## API changes" (method, path, request, response for each endpoint added or changed), ' : ''}"## How to test" (numbered steps a reviewer can follow),
  "## Acceptance criteria" (a "- [ ]" checklist of the issue's criteria this change covers), "## Notes" (risks, migrations, follow-ups; omit if none).
Return JSON: { "title": "…", "body": "…" }` });
  const title = String(res.title || `${t.key}: ${t.title}`).slice(0, 120);
  const body = `${String(res.body || '').trim()}\n\n---\nRefs ${t.key}${appLink ? ` · [Open in TicketForge](${appLink})` : ''} · written with Claude Code from TicketForge`;
  return { title, body };
}
/** A draft title and description for the job's changes, for review before opening the PR. */
export async function prDraft(id, { appLink, ai } = {}) {
  const j = JOBS.get(id);
  if (!j) throw Object.assign(new Error('That code job is gone (the server restarted). Start it again.'), { status: 404 });
  const diff = await git(j.dir, ['diff', '--cached', '--no-color']).catch(() => '');
  const remote = await remoteInfo(j.repoPath);
  return writePrText({ ticket: j.ticket, diff, summary: j.summary, side: j.side === 'backend' ? 'backend' : '', provider: remote.provider || 'GitHub', appLink, ai });
}

/**
 * Updating an open pull/merge request: commits the reviewed changes and pushes them to the request's own branch (the
 * request updates itself), then leaves a short comment saying what changed.
 */
export async function pushToPullRequest(id, { message, token, gitlabToken } = {}) {
  const j = JOBS.get(id);
  if (!j) throw Object.assign(new Error('That code job is gone (the server restarted). Start it again.'), { status: 404 });
  if (!j.target) throw Object.assign(new Error('This job isn’t updating a pull request.'), { status: 400 });
  if (j.status !== 'review') throw Object.assign(new Error('There are no changes to push.'), { status: 409 });
  const remote = await remoteInfo(j.repoPath);
  const t = j.ticket;
  const msg = String(message || `${t.key}: ${j.updateLabel || 'Address requested changes'}`).slice(0, 250);
  await stageAll(j);
  await git(j.dir, ['commit', '-F', '-', '--no-verify'], { input: `${msg}\n\nRefs ${t.key}\n` });
  const sha = (await git(j.dir, ['rev-parse', '--short', 'HEAD'])).trim();
  say(j, `Committed ${sha}.`);
  await pushBranch(j, remote, { token, gitlabToken });
  j.pr = { url: j.target.url, number: j.target.number, title: j.target.title, draft: false };
  j.status = 'pr';
  say(j, `Updated ${prNoun(remote.provider)} ${prRef(remote.provider, j.target.number)}.`, 'done');
  // A short note on the request, so reviewers see what changed.
  const note = `**Updated by TicketForge** (${sha}): ${j.updateLabel || 'requested changes'}.${j.summary ? `\n\n${j.summary.slice(0, 3000)}` : ''}`;
  await (remote.provider === 'GitLab' ? prApi(remote, j.target, { token, gitlabToken }, 'POST', '/notes', { body: note }) : prApi(remote, j.target, { token, gitlabToken }, 'POST', '/issues/comments', { body: note }))
    .then(() => say(j, 'Left a comment on it describing the update.'))
    .catch((e) => say(j, `Couldn’t leave a comment (${e.message}).`, 'warn'));
  git(j.repoPath, ['worktree', 'remove', '--force', j.dir]).catch(() => {});
  return { job: publicJob(j), commit: sha };
}

/**
 * Reviews an open pull/merge request with a read-only review agent (Review a Pull Request or UI/UX Review): fetches its
 * branch, reads the diff against the base, and runs the agent on the request's own branch. The findings are the job's
 * report; postReview() can then leave them on the request as a comment.
 */
export async function startPrReview({ projectId, ticket, dev, target, user, agentId = '', side = 'frontend', focus = '' }) {
  agentId ||= await requireRole('review');
  const repo = await inspectRepo(dev.localPath);
  await git(repo.path, ['fetch', 'origin', `+refs/heads/${target.branch}:refs/remotes/origin/${target.branch}`, target.base], { timeout: 180000 })
    .catch((e) => { throw Object.assign(new Error(`Couldn’t fetch ${target.branch} and ${target.base} from origin: ${e.message}`), { status: 400 }); });
  const range = `origin/${target.base}...origin/${target.branch}`;
  const stat = (await git(repo.path, ['diff', '--numstat', range])).trim();
  if (!stat) throw Object.assign(new Error(`${prNoun(target.provider)} ${prRef(target.provider, target.number)} has no changes against ${target.base}.`), { status: 400 });
  const diff = await git(repo.path, ['diff', '--unified=4', range]);
  const files = stat.split('\n').map((l) => { const [a, d, f] = l.split('\t'); return `${f} (+${a}/−${d})`; });
  const t = ticket;
  const instructions = [`Review ${prNoun(target.provider)} ${prRef(target.provider, target.number)} “${target.title}” (${target.branch} → ${target.base}) for issue ${t.key}: ${t.title}.`,
    t.userStory && `User story: ${t.userStory}`,
    t.acceptanceCriteria?.length && `Acceptance criteria:\n${t.acceptanceCriteria.map((x, i) => `${i + 1}. ${x}`).join('\n')}`,
    `Changed files (${files.length}): ${files.join(', ')}`,
    `The diff against ${target.base}${diff.length > 120000 ? ' (cut to the first 120,000 characters; read the files for the rest)' : ''}:\n\`\`\`diff\n${diff.slice(0, 120000)}\n\`\`\``,
    focus && `Focus especially on: ${focus}`,
    'The working folder is the request’s branch as it is now: read any file you need. Do not change files.',
    'Write the review in Markdown: a one-paragraph verdict (approve / approve with comments / request changes), then findings grouped as Blocking, Should fix and Nits, each with file:line, what is wrong and the fix. End with which acceptance criteria are met, missing or untested.'].filter(Boolean).join('\n\n');
  const job = await startJob({ projectId, ticket, dev, instructions, user, agentId, side, target, context: `REVIEWING AN OPEN ${target.provider === 'GitLab' ? 'MERGE' : 'PULL'} REQUEST: ${target.url}. Read-only: report findings, never edit.` });
  const j = JOBS.get(job.id);
  if (j) { j.kind = 'pr-review'; j.updateLabel = 'AI code review'; }
  return publicJob(j || job);
}
/** Leaves the review job's findings on the pull/merge request as one comment. */
export async function postReview(id, { token, gitlabToken } = {}) {
  const j = JOBS.get(id);
  if (!j) throw Object.assign(new Error('That review is gone (the server restarted). Run it again.'), { status: 404 });
  if (!j.target || !j.summary) throw Object.assign(new Error('There’s no finished review to post.'), { status: 409 });
  const remote = await remoteInfo(j.repoPath);
  const body = `**AI code review** · ${j.agentName} via TicketForge for ${j.ticketKey}\n\n${j.summary.slice(0, 60000)}`;
  await (remote.provider === 'GitLab' ? prApi(remote, j.target, { token, gitlabToken }, 'POST', '/notes', { body }) : prApi(remote, j.target, { token, gitlabToken }, 'POST', '/issues/comments', { body }));
  j.posted = new Date().toISOString();
  say(j, `Posted the review on ${prNoun(remote.provider)} ${prRef(remote.provider, j.target.number)}.`, 'done');
  return publicJob(j);
}

/** Review comments on an open pull/merge request (for "Address review comments"). Returns [{ author, file, line, body }]. */
export async function reviewComments({ repoPath, target, token, gitlabToken }) {
  const remote = await remoteInfo(repoPath);
  if (remote.provider === 'GitLab') {
    const notes = await prApi(remote, target, { token, gitlabToken }, 'GET', '/notes?sort=asc&per_page=100');
    return (notes || []).filter((n) => !n.system && !/^\*\*Updated by TicketForge\*\*/.test(n.body || '')).map((n) => ({ author: n.author?.username || '', file: n.position?.new_path || '', line: n.position?.new_line || null, body: String(n.body || '').slice(0, 2000), resolved: Boolean(n.resolved) }))
      .filter((n) => !n.resolved);
  }
  const [inline, reviews, general] = await Promise.all([
    prApi(remote, target, { token }, 'GET', '/comments?per_page=100').catch(() => []),
    prApi(remote, target, { token }, 'GET', '/reviews?per_page=100').catch(() => []),
    prApi(remote, target, { token }, 'GET', '/issues/comments?per_page=100').catch(() => []),
  ]);
  return [
    ...(reviews || []).filter((r) => r.body).map((r) => ({ author: r.user?.login || '', file: '', line: null, body: String(r.body).slice(0, 2000) })),
    ...(inline || []).map((c) => ({ author: c.user?.login || '', file: c.path || '', line: c.line || c.original_line || null, body: String(c.body || '').slice(0, 2000) })),
    ...(general || []).filter((c) => !/^\*\*Updated by TicketForge\*\*/.test(c.body || '')).map((c) => ({ author: c.user?.login || '', file: '', line: null, body: String(c.body || '').slice(0, 2000) })),
  ];
}

/** Rewrites an open pull/merge request's title and description from its real diff against the base branch. */
export async function describePullRequest({ repoPath, target, ticket, side, token, gitlabToken, appLink, ai }) {
  const remote = await remoteInfo(repoPath);
  await git(repoPath, ['fetch', 'origin', `+refs/heads/${target.branch}:refs/remotes/origin/${target.branch}`, target.base], { timeout: 180000 });
  const diff = await git(repoPath, ['diff', '--no-color', `origin/${target.base}...origin/${target.branch}`]).catch(() => '');
  const { title, body } = await writePrText({ ticket, diff, side, provider: remote.provider, appLink, ai });
  if (remote.provider === 'GitLab') await prApi(remote, target, { token, gitlabToken }, 'PUT', '', { title, description: body });
  else await prApi(remote, target, { token }, 'PATCH', '', { title, body });
  return { title, body };
}

export async function openPullRequest(id, { title, body, draft, token, gitlabToken, appLink }) {
  const j = JOBS.get(id);
  if (!j) throw Object.assign(new Error('That code job is gone (the server restarted). Start it again.'), { status: 404 });
  if (!['review'].includes(j.status)) throw Object.assign(new Error(j.pr ? 'The pull request is already open.' : 'There are no changes to open a pull request for.'), { status: 409 });
  const remote = await remoteInfo(j.repoPath);
  const provider = remote.provider || (j.repo ? 'GitHub' : null);
  if (!provider) throw Object.assign(new Error(`Can’t tell where ${j.repoPath} is hosted (origin: ${remote.url || 'none'}). Pull requests work with GitHub and GitLab.`), { status: 400 });
  const t = j.ticket;
  const prTitle = String(title || `${t.key}: ${t.title}`).slice(0, 250);
  await stageAll(j);
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
    }).catch((e) => { throw Object.assign(new Error(`The branch is pushed, but GitLab at ${remote.host} couldn’t be reached (${e.cause?.code || e.message}). Open the merge request here: ${newMr}`), { status: 502 }); });
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

// ---------------------------------------------------------------- repository profile
// "Learn from repository" (Project settings → Code & GitHub): a read-only Claude Code agent studies the checkout and
// writes the Repository Profile, which every code job then gets (lib/devagent.js runAgent), so code follows the repo.
const PROFILE_PROMPT = `Study this repository and write its REPOSITORY PROFILE: the guide another engineer (an AI coding agent) reads
before changing code here, so new code looks like it was written by this team. Explore first: the manifest files
(package.json, pyproject, go.mod, composer.json, Gemfile…), config, the folder layout, then read two or three existing
features end to end. Only state what you verified in files; cite real paths. Write [unknown] when you couldn't tell.

Output ONLY Markdown with these sections (short, specific bullets; at most about 10,000 characters):
# Repository profile
## Stack
Languages, frameworks and key libraries with versions (from the manifests).
## Structure
Where each kind of code lives (routes/pages, API, services, data access, UI components, styles, tests, config), with paths.
## How a feature is built here
Walk one or two real features end to end (e.g. UI → API → service → data → tests), with the files involved, so a
new feature can copy the same shape.
## Conventions
Naming, file layout, imports and path aliases, styling and design tokens, state management, validation, error
handling, auth and permission checks, logging, i18n, config and environment variables.
## Data
Database/ORM, how models and migrations are added, seeds.
## Tests
Framework, where tests live, naming, helpers and fixtures, how to run one test and all tests.
## Commands
Install, dev, build, test, lint, type check (from the scripts).
## Reuse first
Components, hooks, helpers and utilities a new feature should reuse, with paths.
## Rules for changes
Generated or vendored files, lockfiles, migrations, anything not to touch, and anything the repo's README,
CONTRIBUTING, CLAUDE.md or AGENTS.md asks for.`;

/**
 * Runs the read-only profile agent in the repository; onStep(text) for progress. Resolves { markdown, commit }.
 * @param {{ localPath: string, model?: string, onStep?: (text: string) => void, signal?: AbortSignal }} opts
 */
export async function learnRepo({ localPath, model = 'sonnet', onStep = (_text) => {}, signal }) {
  const repo = await inspectRepo(localPath);
  const { bin, env } = await claudeCodeCommand();
  const commit = (await git(repo.path, ['rev-parse', '--short', 'HEAD']).catch(() => '')).trim();
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--permission-mode', 'default',
    '--allowedTools', 'Read Glob Grep LS', '--disallowedTools', 'Bash Edit Write MultiEdit NotebookEdit WebFetch WebSearch Task Agent', '--model', model];
  return new Promise((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ bin, args, { cwd: repo.path, env, stdio: ['pipe', 'pipe', 'pipe'] });
    signal?.addEventListener('abort', () => child.kill('SIGTERM'));
    let buf = '', stderr = '', result = '', cost = 0;
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'assistant') for (const c of ev.message?.content || []) {
          if (c.type === 'tool_use') { const inp = c.input || {}; onStep(`${TOOL_VERB[c.name] || c.name} ${inp.file_path ? path.relative(repo.path, inp.file_path) : inp.pattern || inp.path || ''}`.trim()); }
        }
        if (ev.type === 'result') { result = ev.result || ''; cost = ev.total_cost_usd || 0; if (ev.is_error) stderr += ` ${ev.result || ''}`; }
      }
    });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (signal?.aborted) return reject(Object.assign(new Error('Stopped.'), { status: 499 }));
      const md = String(result).trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/, '$1');
      const start = md.search(/^#\s/m);
      const markdown = (start > 0 ? md.slice(start) : md).trim().slice(0, 14000);
      if (code !== 0 && !markdown) return reject(new Error(stderr.trim().split('\n').slice(-2).join(' ') || `Claude Code stopped (code ${code})`));
      if (!/^#/.test(markdown)) return reject(new Error('The agent didn’t return a profile. Try again.'));
      resolve({ markdown, commit, costUsd: cost });
    });
    child.stdin.end(PROFILE_PROMPT);
  });
}

// ---------------------------------------------------------------- repositories cloned by TicketForge
// Project settings → Code & GitHub → Repository → "Clone from Git": instead of pointing at a folder you cloned,
// paste the repository (https URL, SSH URL or owner/name). TicketForge clones it into its data folder and keeps it
// up to date; code jobs then use it like any local repository. Tokens are passed per command, never stored in .git.
const CLONE_ROOT = path.join(/*turbopackIgnore: true*/ DATA_DIR, 'repos');
/** "owner/name", https or SSH → { url, host, path, provider } (url is what git clones). */
export function parseRepoSource(input) {
  const raw = String(input || '').trim().replace(/\/+$/, '');
  if (/^[\w.-]+\/[\w.-]+$/.test(raw)) return { url: `https://github.com/${raw.replace(/\.git$/, '')}.git`, host: 'github.com', path: raw.replace(/\.git$/, ''), provider: 'GitHub' };
  const m = raw.match(/^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[\w.-]+@)([^/:]+)(?::\d+)?[:/]+(.+?)(?:\.git)?$/i);
  if (!m) throw Object.assign(new Error('Paste the repository’s clone URL (https://… or git@…) or owner/name for GitHub.'), { status: 400 });
  const [, host, p] = m;
  if (/[\s;&|`$]/.test(raw) || raw.startsWith('-')) throw Object.assign(new Error('That doesn’t look like a repository URL.'), { status: 400 });
  return { url: /^https?:/i.test(raw) ? raw.replace(/\/\/[^@/]+@/, '//') + (raw.endsWith('.git') ? '' : '.git') : raw, host, path: p, provider: /gitlab/i.test(host) ? 'GitLab' : /github/i.test(host) ? 'GitHub' : 'Git' };
}
/** git -c options that sign in over https with a token for this one command (nothing is written to .git/config). */
function authArgs(src, { token = '', gitlabToken = '' } = {}) {
  if (!/^https:/i.test(src.url)) return []; // SSH uses your own keys
  const tok = src.provider === 'GitLab' ? gitlabToken : src.provider === 'GitHub' ? token : '';
  if (!tok) return [];
  const user = src.provider === 'GitLab' ? 'oauth2' : 'x-access-token';
  return ['-c', `http.extraheader=AUTHORIZATION: basic ${Buffer.from(`${user}:${tok}`).toString('base64')}`];
}
const cleanGitError = (e) => String(e?.message || e).replace(/AUTHORIZATION: basic \S+/gi, 'AUTHORIZATION: ***').replace(/Cloning into '[^']*'\.\.\.\s*/g, '').replace(/\s+/g, ' ').trim().replace(/\.$/, '') || 'git failed';
/**
 * Clones (or, when already cloned, fetches and fast-forwards) a repository for a project. Returns inspectRepo's
 * details plus { cloned: true, url }. onStep(text) reports progress.
 */
export async function cloneRepo({ projectId, side = 'frontend', source, branch = '', token = '', gitlabToken = '', onStep = (_t) => {} }) {
  const src = parseRepoSource(source);
  if (!token && src.provider === 'GitHub') token = (await githubToken('').catch(() => '')) || '';
  const dir = path.join(CLONE_ROOT, `${String(projectId).replace(/[^\w-]/g, '')}-${side === 'backend' ? 'be' : 'fe'}-${slug(src.path.split('/').pop())}`);
  const auth = authArgs(src, { token, gitlabToken });
  fs.mkdirSync(/*turbopackIgnore: true*/ CLONE_ROOT, { recursive: true });
  const has = fs.existsSync(/*turbopackIgnore: true*/ path.join(dir, '.git'));
  try {
    if (has) {
      const cur = (await git(dir, ['remote', 'get-url', 'origin']).catch(() => '')).trim();
      if (cur.replace(/\.git$/, '') !== src.url.replace(/\.git$/, '')) await git(dir, ['remote', 'set-url', 'origin', src.url]);
      onStep(`Fetching ${src.path}…`);
      await git(dir, [...auth, 'fetch', '--prune', 'origin'], { timeout: 600000 });
    } else {
      onStep(`Cloning ${src.path} (this can take a minute for big repositories)…`);
      await git(CLONE_ROOT, [...auth, 'clone', '--no-tags', ...(branch ? ['--branch', branch] : []), '--', src.url, dir], { timeout: 900000 });
    }
    // Keep the checkout on the base branch and current with origin (code jobs branch from origin/<base> anyway).
    await git(dir, ['remote', 'set-head', 'origin', '--auto']).catch(() => {});
    const base = branch || (await git(dir, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(() => '')).trim().replace(/^origin\//, '') || 'main';
    const dirty = (await git(dir, ['status', '--porcelain']).catch(() => '')).trim();
    if (!dirty) {
      await git(dir, ['checkout', '-q', base]).catch(() => git(dir, ['checkout', '-q', '-b', base, `origin/${base}`]));
      await git(dir, ['merge', '--ff-only', '-q', `origin/${base}`]).catch(() => onStep(`${base} has local commits; left as it is.`));
    } else onStep('The clone has uncommitted changes; left as it is.');
  } catch (e) {
    const msg = cleanGitError(e);
    const authHint = /authentication|could not read username|403|not found|repository .* not found|permission denied/i.test(msg)
      ? (src.provider === 'GitLab' ? ' Save a GitLab token (read_repository) in the backend repository settings.' : src.provider === 'GitHub' ? ' Save a GitHub token with Contents access below, or sign in with `gh auth login` on this computer.' : ' Use an SSH URL with a key on this computer.') : '';
    throw Object.assign(new Error(`Couldn’t ${has ? 'update' : 'clone'} ${src.path}: ${msg}.${authHint}`), { status: 400 });
  }
  onStep('Ready.');
  return { ...(await inspectRepo(dir)), cloned: true, url: src.url };
}
