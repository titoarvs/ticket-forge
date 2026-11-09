// Code generation and pull requests for an issue, on a local clone of the project's GitHub repository.
// Each job works in its own git worktree and branch (your checkout is never touched): Claude Code implements the
// issue there, you review the diff in TicketForge, then TicketForge commits, pushes and opens the pull request.
// Local only: it needs the repository folder, git and Claude Code on the machine running TicketForge.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { DATA_DIR } from './db.js';
import { claudeCodeCommand } from './claude.js';

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
});
export const getJob = (id, since) => publicJob(JOBS.get(id), since);
/** The newest job for an issue (so the panel can show it again after a reload). */
export function jobForTicket(projectId, ticketId) {
  const all = [...JOBS.values()].filter((j) => j.projectId === projectId && j.ticketId === ticketId && j.status !== 'discarded');
  return publicJob(all.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]);
}
const say = (j, text, kind = 'info') => { j.log.push({ at: new Date().toISOString(), kind, text: String(text).slice(0, 500) }); if (j.log.length > 800) j.log.splice(0, j.log.length - 800); };

function prompt(t, dev, extra, round) {
  const lines = [
    round > 1 ? `Continue the work on issue ${t.key} in this repository. The previous changes are already in the working tree; adjust them as asked below.` : `Implement issue ${t.key} in this repository.`,
    '',
    `Title: ${t.title}`,
    t.userStory && `User story: ${t.userStory}`,
    t.description && `Description:\n${t.description}`,
    t.acceptanceCriteria?.length && `Acceptance criteria:\n${t.acceptanceCriteria.map((a, i) => `${i + 1}. ${a}`).join('\n')}`,
    t.testCases?.length && `Test cases it must pass:\n${t.testCases.slice(0, 12).map((c) => `- ${c.title}${c.expected ? ` (expected: ${c.expected})` : ''}`).join('\n')}`,
    dev.notes && `Team conventions for this repository:\n${dev.notes}`,
    extra && `${round > 1 ? 'What to change now' : 'Extra instructions'}:\n${extra}`,
    '',
    'Rules:',
    '- Read the code around the change first and follow the existing structure, style and libraries.',
    '- Keep the change focused on this issue. Add or update tests when the project has them.',
    dev.checkCommand ? `- Run \`${dev.checkCommand}\` to check your work and fix what fails.` : '- You cannot run commands; check your work by reading the code carefully.',
    '- Do not commit, push, create branches or change git settings: TicketForge does that after review.',
    '- Finish with a short summary of what you changed and anything a reviewer should check.',
  ];
  return lines.filter(Boolean).join('\n');
}

/** Runs Claude Code in the job's worktree until it finishes; streams its steps into the job log. */
async function runAgent(j, text) {
  const { bin, env } = await claudeCodeCommand();
  const tools = ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'];
  if (j.dev.checkCommand) tools.push(`Bash(${j.dev.checkCommand.trim().split(/\s+/).slice(0, 2).join(' ')}:*)`);
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
    '--allowedTools', tools.join(' '), '--disallowedTools', 'Bash(git push:*) Bash(git commit:*) Bash(rm -rf:*) WebFetch WebSearch',
    '--model', j.dev.model || 'opus'];
  await new Promise((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ bin, args, { cwd: j.dir, env, stdio: ['pipe', 'pipe', 'pipe'] });
    j.child = child;
    let buf = '', stderr = '', result = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'assistant') {
          for (const c of ev.message?.content || []) {
            if (c.type === 'tool_use') {
              const inp = c.input || {};
              const what = inp.file_path ? path.relative(j.dir, inp.file_path) : inp.pattern || inp.command || inp.path || '';
              say(j, `${{ Read: 'Reading', Edit: 'Editing', MultiEdit: 'Editing', Write: 'Writing', Glob: 'Finding files', Grep: 'Searching', LS: 'Listing', Bash: 'Running', TodoWrite: 'Planning' }[c.name] || c.name} ${what}`.trim(), 'tool');
            } else if (c.type === 'text' && c.text.trim()) say(j, c.text.trim().split('\n')[0], 'text');
          }
        } else if (ev.type === 'result') { result = ev.result || ''; if (ev.is_error) stderr += ` ${ev.result || ''}`; }
      }
    });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      j.child = null;
      if (j.status === 'cancelled') return resolve();
      if (code !== 0 && !result) return reject(new Error(stderr.trim().split('\n').slice(-2).join(' ') || `Claude Code stopped (code ${code})`));
      j.summary = [j.summary, result.trim()].filter(Boolean).join('\n\n---\n\n');
      resolve();
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

async function work(j, text) {
  j.status = 'running'; j.error = null;
  try {
    say(j, j.rounds === 1 ? `Claude Code is implementing ${j.ticketKey} on ${j.branch}…` : 'Claude Code is making the requested changes…');
    await runAgent(j, text);
    if (j.status === 'cancelled') return;
    await collectDiff(j);
    j.status = j.files.length ? 'review' : 'empty';
    say(j, j.files.length ? `Done: ${j.files.length} file${j.files.length === 1 ? '' : 's'} changed. Review the diff, then open the pull request.` : 'Claude Code finished without changing any files.', 'done');
  } catch (e) {
    j.status = 'failed'; j.error = e.message; say(j, e.message, 'error');
  } finally { j.finishedAt = new Date().toISOString(); }
}

/** Starts a job: a fresh worktree and branch from the base branch, then Claude Code. */
export async function startJob({ projectId, ticket, dev, instructions, user }) {
  const running = [...JOBS.values()].find((x) => x.projectId === projectId && x.ticketId === ticket.id && x.status === 'running');
  if (running) throw Object.assign(new Error('A code job is already running for this issue.'), { status: 409 });
  const repo = await inspectRepo(dev.localPath);
  const base = dev.baseBranch || repo.defaultBranch;
  const branch = `${dev.branchPrefix ?? 'tf/'}${String(ticket.key || 'issue').toLowerCase()}-${slug(ticket.title)}`;
  const id = crypto.randomUUID().slice(0, 12);
  const dir = path.join(/*turbopackIgnore: true*/ WT_ROOT, projectId, `${String(ticket.key || id).toLowerCase()}-${id}`);
  const j = { id, projectId, ticketId: ticket.id, ticketKey: ticket.key, status: 'starting', branch, base, repo: dev.repo || repo.repo, repoPath: repo.path,
    dir, dev, log: [], startedAt: new Date().toISOString(), startedBy: user?.name, rounds: 1, files: [], summary: '', ticket };
  JOBS.set(id, j);
  say(j, `Fetching ${base} from origin…`);
  await git(repo.path, ['fetch', 'origin', base], { timeout: 180000 }).catch((e) => say(j, `Couldn’t fetch (${e.message}); using the local ${base}.`, 'warn'));
  const start = await git(repo.path, ['rev-parse', '--verify', '--quiet', `origin/${base}`]).then(() => `origin/${base}`, () => base);
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(dir), { recursive: true });
  // -B: reuse the branch name if an earlier job for this issue left it behind.
  await git(repo.path, ['worktree', 'add', '-B', branch, dir, start]);
  say(j, `Created branch ${branch} from ${start} in its own worktree.`);
  work(j, prompt(ticket, dev, instructions, 1)); // runs in the background
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
  work(j, prompt(j.ticket, j.dev, text, j.rounds));
  return publicJob(j);
}
export function cancelJob(id) {
  const j = JOBS.get(id);
  if (!j) return null;
  if (j.status === 'running') { j.status = 'cancelled'; j.child?.kill('SIGTERM'); say(j, 'Stopped.', 'warn'); }
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

/** Commits the reviewed changes, pushes the branch and opens the pull request. */
export async function openPullRequest(id, { title, body, draft, token, appLink }) {
  const j = JOBS.get(id);
  if (!j) throw Object.assign(new Error('That code job is gone (the server restarted). Start it again.'), { status: 404 });
  if (!['review'].includes(j.status)) throw Object.assign(new Error(j.pr ? 'The pull request is already open.' : 'There are no changes to open a pull request for.'), { status: 409 });
  if (!j.repo) throw Object.assign(new Error('Set the GitHub repository (owner/name) in Project settings → Code & GitHub.'), { status: 400 });
  const t = j.ticket;
  const prTitle = String(title || `${t.key}: ${t.title}`).slice(0, 250);
  await git(j.dir, ['add', '-A']);
  await git(j.dir, ['commit', '-F', '-', '--no-verify'], { input: `${prTitle}\n\n${t.userStory || ''}\n\nRefs ${t.key}${appLink ? ` (${appLink})` : ''}\n`.replace(/\n{3,}/g, '\n\n') });
  say(j, 'Committed the changes.');
  const tok = await githubToken(token);
  // Push with the token for this command only (never written to the repository's config).
  const authArgs = tok ? ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${tok}`).toString('base64')}`] : [];
  await git(j.dir, [...authArgs, 'push', '-u', 'origin', `HEAD:refs/heads/${j.branch}`], { timeout: 180000 });
  say(j, `Pushed ${j.branch}.`);
  if (!tok) throw Object.assign(new Error('Pushed, but there’s no GitHub token to open the pull request with: save one in Project settings → Code & GitHub, sign in with `gh auth login`, or open it on GitHub.'), { status: 400 });
  const prBody = body || [
    `Implements **${t.key}: ${t.title}**${appLink ? ` ([TicketForge](${appLink}))` : ''}.`,
    t.userStory && `\n> ${t.userStory}`,
    t.acceptanceCriteria?.length && `\n### Acceptance criteria\n${t.acceptanceCriteria.map((a) => `- [ ] ${a}`).join('\n')}`,
    j.summary && `\n### What changed\n${j.summary.slice(0, 6000)}`,
    `\n_Written with Claude Code from TicketForge; reviewed by ${j.startedBy || 'the team'} before opening._`,
  ].filter(Boolean).join('\n');
  const res = await fetch(`https://api.github.com/repos/${j.repo}/pulls`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'User-Agent': 'TicketForge', 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: prTitle, head: j.branch, base: j.base, body: prBody, draft: Boolean(draft) }),
  });
  const pr = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = pr.errors?.map((e) => e.message).filter(Boolean).join('; ') || pr.message || `GitHub said ${res.status}`;
    throw Object.assign(new Error(`The branch is pushed, but GitHub didn’t open the pull request: ${why}`), { status: 400 });
  }
  j.pr = { url: pr.html_url, number: pr.number, title: pr.title, draft: pr.draft };
  j.status = 'pr';
  say(j, `Opened pull request #${pr.number}.`, 'done');
  // The worktree isn't needed any more; the branch stays for the pull request.
  git(j.repoPath, ['worktree', 'remove', '--force', j.dir]).catch(() => {});
  return { job: publicJob(j), pr: { url: pr.html_url, number: pr.number, title: pr.title, status: pr.draft ? 'Draft' : 'Open', repo: j.repo, provider: 'GitHub', branch: j.branch, base: j.base } };
}
