import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DATA_DIR } from '../db';
import { reviewWorktree } from '../coderabbit';
import { resolveAgent, requireRole, ensureAgent, REVIEW_LENSES } from '../agents';
import { isSaas } from '../platform';
import { appEnv } from '../childenv';
import { migrationCheck } from '../dbschema';
import { type CompareTarget, compareResult, baseJobFor, noBaseReason } from '../codecompare';
import { remoteInfo } from './start-pr-review';
import { outputOf, say, runAgent, collectDiff, jobDiff, stageAll } from './api-contract';

const G = globalThis;
G.__tfDevJobs ??= new Map();
export const JOBS = G.__tfDevJobs;
export const WT_ROOT = path.join(/*turbopackIgnore: true*/ DATA_DIR, 'worktrees');
export const MAX_DIFF = 400_000;
export function git(cwd, args, { timeout = 120000, input }: any = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      { cwd, timeout, maxBuffer: 32 * 1024 * 1024, env: { ...appEnv(), GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => {
        if (err)
          reject(
            Object.assign(
              new Error(
                String(stderr || err.message)
                  .trim()
                  .split('\n')
                  .slice(-3)
                  .join(' '),
              ),
              { status: 400 },
            ),
          );
        else resolve(String(stdout));
      },
    );
    if (input !== undefined) child.stdin.end(input);
  });
}
const repoFromRemote = (url) =>
  (String(url)
    .trim()
    .match(/github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/i) || [])[1] || '';
export const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'change';
/**
 * Checks a local folder: is it a git repository, which GitHub repo, which default branch, anything
 * uncommitted.
 */
/**
 * A typed folder as a real path: ~ is the home folder, and a path that doesn't exist from the root
 * but does inside the home folder (/desktop/Practice → ~/Desktop/Practice) is taken from there.
 */
const real = (p) => {
  try {
    return fs.realpathSync.native(/*turbopackIgnore: true*/ p);
  } catch {
    return p;
  }
};
export function resolveFolder(input) {
  return real(findFolder(input));
}
function findFolder(input) {
  const home = os.homedir();
  const raw = String(input || '')
    .trim()
    .replace(/^~(?=$|\/)/, home);
  const dir = path.resolve(/*turbopackIgnore: true*/ raw || home);
  if (fs.existsSync(/*turbopackIgnore: true*/ dir)) return dir;
  const inHome = path.join(/*turbopackIgnore: true*/ home, raw.replace(/^\/+/, ''));
  if (raw && fs.existsSync(/*turbopackIgnore: true*/ inHome)) return inHome;
  // Same, ignoring letter case of each part (macOS folders such as Desktop and Documents).
  let cur = home;
  for (const part of raw.replace(/^\/+/, '').split('/').filter(Boolean)) {
    const hit =
      fs.existsSync(/*turbopackIgnore: true*/ cur) &&
      fs
        .readdirSync(/*turbopackIgnore: true*/ cur)
        .find((n) => n.toLowerCase() === part.toLowerCase());
    if (!hit) return dir;
    cur = path.join(/*turbopackIgnore: true*/ cur, hit);
  }
  return cur;
}
/**
 * The folders inside one folder, for picking the repository (names only; files are never listed).
 */
export function listFolders(input) {
  const home = os.homedir();
  const dir = resolveFolder(input || home);
  if (
    !fs.existsSync(/*turbopackIgnore: true*/ dir) ||
    !fs.statSync(/*turbopackIgnore: true*/ dir).isDirectory()
  )
    throw Object.assign(new Error(`There’s no folder at ${dir}.`), { status: 400 });
  let names: any[] = [];
  try {
    names = fs
      .readdirSync(/*turbopackIgnore: true*/ dir, { withFileTypes: true })
      .filter(
        (d) =>
          d.isDirectory() &&
          !d.name.startsWith('.') &&
          !['node_modules', 'Library', '__pycache__'].includes(d.name),
      )
      .map((d) => d.name);
  } catch {
    throw Object.assign(new Error(`TicketForge can’t open ${dir} (permission denied).`), {
      status: 400,
    });
  }
  const isGit = (p) =>
    fs.existsSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ p, '.git'));
  const entries = names
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .slice(0, 500)
    .map((name) => ({
      name,
      path: path.join(/*turbopackIgnore: true*/ dir, name),
      git: isGit(path.join(/*turbopackIgnore: true*/ dir, name)),
    }));
  const places = [
    ['Home', home],
    ['Desktop', path.join(/*turbopackIgnore: true*/ home, 'Desktop')],
    ['Documents', path.join(/*turbopackIgnore: true*/ home, 'Documents')],
    ['Developer', path.join(/*turbopackIgnore: true*/ home, 'Developer')],
    ['Projects', path.join(/*turbopackIgnore: true*/ home, 'Projects')],
    ['code', path.join(/*turbopackIgnore: true*/ home, 'code')],
  ]
    .filter(([, p]) => fs.existsSync(/*turbopackIgnore: true*/ p))
    .map(([name, p]) => ({ name, path: p }));
  return {
    path: dir,
    parent: path.dirname(dir) !== dir ? path.dirname(dir) : null,
    git: isGit(dir),
    entries,
    places,
    home,
  };
}
export async function inspectRepo(localPath) {
  const dir = resolveFolder(localPath);
  if (
    !fs.existsSync(/*turbopackIgnore: true*/ dir) ||
    !fs.statSync(/*turbopackIgnore: true*/ dir).isDirectory()
  )
    throw Object.assign(
      new Error(`There’s no folder at ${dir} on this computer. Use Browse… to pick it.`),
      { status: 400 },
    );
  const top = (
    await git(dir, ['rev-parse', '--show-toplevel']).catch(() => {
      throw Object.assign(
        new Error(
          `${dir} isn’t a git repository. Clone the project’s GitHub repository there first.`,
        ),
        { status: 400 },
      );
    })
  ).trim();
  const remote = (await git(top, ['remote', 'get-url', 'origin']).catch(() => '')).trim();
  let base = (
    await git(top, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(
      () => '',
    )
  )
    .trim()
    .replace(/^origin\//, '');
  if (!base)
    base = (await git(top, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'main')).trim();
  const current = (await git(top, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim();
  const dirty = (await git(top, ['status', '--porcelain']).catch(() => ''))
    .trim()
    .split('\n')
    .filter(Boolean).length;
  const ri = await remoteInfo(top);
  return {
    path: top,
    remote: remote.replace(/\/\/[^@/]+@/, '//'),
    repo: repoFromRemote(remote) || ri.path,
    provider: ri.provider,
    host: ri.host,
    defaultBranch: base,
    currentBranch: current,
    uncommitted: dirty,
  };
}
/** A GitHub token: the project's saved one, GITHUB_TOKEN, or the signed-in `gh` CLI. */
export async function githubToken(saved) {
  if (saved) return saved;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (isSaas()) return ''; // the server's own GitHub CLI sign-in belongs to the operator, not to any workspace
  return new Promise((resolve) =>
    execFile('gh', ['auth', 'token'], { timeout: 10000 }, (err, out) =>
      resolve(err ? '' : String(out).trim()),
    ),
  );
}
export const publicJob = (j, since = 0) =>
  j && {
    id: j.id,
    projectId: j.projectId,
    ticketId: j.ticketId,
    ticketKey: j.ticketKey,
    status: j.status,
    branch: j.branch,
    base: j.base,
    repo: j.repo,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    error: j.error,
    summary: j.summary,
    files: j.files,
    pr: j.pr,
    rounds: j.rounds,
    log: j.log.slice(since),
    logSize: j.log.length,
    startedBy: j.startedBy,
    agentId: j.agentId,
    agentName: j.agentName,
    reviews: j.reviews || [],
    todos: j.todos || [],
    costUsd: j.costUsd || 0,
    side: j.side || 'frontend',
    localOnly: Boolean(j.localOnly),
    provider: j.provider || 'GitHub',
    target: j.target || null,
    repoPath: j.repoPath,
    committedAt: j.committedAt || null,
    kind: j.kind || null,
    posted: j.posted || null,
    updateLabel: j.updateLabel || null,
    coderabbit: j.cr ? { ...j.cr, log: (j.cr.log || []).slice(-30) } : null,
  };
export const getJob = (id, since?) => publicJob(JOBS.get(id), since);
/** Every job of a project (newest first, without logs), for the jobs overview. */
export function listJobs(projectId) {
  return [...JOBS.values()]
    .filter((j) => j.projectId === projectId && j.status !== 'discarded')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((j) => {
      const { log, summary, reviews, todos, ...rest } = publicJob(j);
      return {
        ...rest,
        last: j.log[j.log.length - 1]?.text || '',
        reviewCount: (reviews || []).length,
        todosDone: (todos || []).filter((x) => x.status === 'completed').length,
        todosTotal: (todos || []).length,
      };
    });
}
/** The newest job for an issue (so the panel can show it again after a reload). */
export function jobForTicket(projectId, ticketId, side = null) {
  const all = [...JOBS.values()].filter(
    (j) =>
      j.projectId === projectId &&
      j.ticketId === ticketId &&
      j.status !== 'discarded' &&
      (!side || (j.side || 'frontend') === side),
  );
  return publicJob(all.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]);
}
/** The newest job per repository for an issue: { frontend, backend }. */
export const jobsForTicket = (projectId, ticketId) => ({
  frontend: jobForTicket(projectId, ticketId, 'frontend') || null,
  backend: jobForTicket(projectId, ticketId, 'backend') || null,
});
/** The newest backend job's summary for an issue, for the frontend job to build on. */
export function backendSummary(projectId, ticketId) {
  const j = [...JOBS.values()]
    .filter(
      (x) =>
        x.projectId === projectId &&
        x.ticketId === ticketId &&
        x.side === 'backend' &&
        x.summary &&
        x.status !== 'discarded',
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  return j ? { summary: j.summary, branch: j.branch, status: j.status } : null;
}
// Dependency folders that are installed, not committed. A fresh worktree has none of them, so the
// check command (tests, lint, type check) can't run and the agent guesses instead of verifying.
// They are linked from your checkout.
const DEP_DIRS = ['node_modules', 'vendor', '.venv', 'venv'];
const WORKSPACE_PARENTS = ['packages', 'apps', 'services', 'libs', 'modules'];
export function linkDependencies(j) {
  const linked: any[] = [];
  const link = (rel) => {
    const src = path.join(/*turbopackIgnore: true*/ j.repoPath, rel),
      dst = path.join(/*turbopackIgnore: true*/ j.dir, rel);
    try {
      if (
        !fs.statSync(/*turbopackIgnore: true*/ src).isDirectory() ||
        fs.existsSync(/*turbopackIgnore: true*/ dst) ||
        !fs.existsSync(/*turbopackIgnore: true*/ path.dirname(dst))
      )
        return;
      fs.symlinkSync(/*turbopackIgnore: true*/ src, /*turbopackIgnore: true*/ dst, 'dir');
      linked.push(rel);
    } catch {
      /* not installed here */
    }
  };
  for (const d of DEP_DIRS) link(d);
  for (const parent of WORKSPACE_PARENTS) {
    let subs: any[] = [];
    try {
      subs = fs.readdirSync(
        /*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ j.repoPath, parent),
      );
    } catch {
      continue;
    }
    for (const sub of subs.slice(0, 80)) link(path.join(parent, sub, 'node_modules'));
  }
  j.linked = linked;
  return linked;
}
/**
 * The project brain notes for the job (lib/brain.ts), for reading only: never staged or committed.
 */
export const BRAIN_DIR = '.ticketforge/brain';
export function writeBrain(j, files) {
  const names = Object.keys(files || {});
  if (!names.length) return 0;
  const root = path.join(/*turbopackIgnore: true*/ j.dir, BRAIN_DIR);
  for (const name of names) {
    const rel = path.normalize(name);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const dst = path.join(/*turbopackIgnore: true*/ root, rel);
    fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(dst), { recursive: true });
    fs.writeFileSync(/*turbopackIgnore: true*/ dst, String(files[name]));
  }
  j.brain = names.length;
  return names.length;
}
/**
 * The job's output compared with the previous job run, the repository's default branch or the last
 * run before the prior spec (lib/codecompare.ts). Returns { target, label, available, reason,
 * against, diff } with `diff` as a unified diff.
 */
export async function compareJob(id, target: CompareTarget, specAt = '') {
  const j = JOBS.get(id);
  if (!j)
    throw Object.assign(
      new Error('That code job is gone (the server restarted). Start it again.'),
      { status: 404 },
    );
  try {
    const cur = await outputOf(j);
    if (target === 'default') {
      const def = (await inspectRepo(j.repoPath)).defaultBranch;
      const ref = await git(cur.cwd, ['rev-parse', '--verify', '--quiet', `origin/${def}`]).then(
        () => `origin/${def}`,
        () => def,
      );
      const from = (await git(cur.cwd, ['merge-base', ref, cur.head])).trim();
      return compareResult(target, {
        against: def,
        diff: await git(cur.cwd, ['diff', '--no-color', from, cur.tree]),
      });
    }
    const prev = baseJobFor(j, [...JOBS.values()], target, specAt);
    if (!prev) return compareResult(target, { reason: noBaseReason(target, specAt) });
    const against = `${prev.ticketKey} run of ${String(prev.startedAt).slice(0, 16).replace('T', ' ')} (${prev.branch})`;
    return compareResult(target, {
      against,
      diff: await git(cur.cwd, ['diff', '--no-color', (await outputOf(prev)).tree, cur.tree]),
    });
  } catch (e: any) {
    return compareResult(target, { reason: `Couldn’t compare these changes: ${e.message}` });
  }
}
// How many agent rounds run at once on this machine; the rest wait in order (status "queued"). Each
// round is a Claude Code process, so this keeps a batch of tickets from overloading the computer or
// the account's rate limits.
export const MAX_PARALLEL = Math.max(
  1,
  Math.min(10, Number(process.env.TICKETFORGE_CODE_PARALLEL) || 3),
);
G.__tfDevQueue ??= { running: 0, waiting: [] };
const Q = G.__tfDevQueue;
/** Waits for a free slot. Returns false when the job was stopped while it waited. */
function takeSlot(j) {
  if (j.status === 'cancelled') return Promise.resolve(false);
  if (Q.running < MAX_PARALLEL) {
    Q.running++;
    return Promise.resolve(true);
  }
  j.status = 'queued';
  say(
    j,
    `Waiting for a free slot: ${MAX_PARALLEL} agents already running (${Q.waiting.length + 1} in line).`,
  );
  return new Promise((resolve) => Q.waiting.push({ j, resolve }));
}
function releaseSlot() {
  while (Q.waiting.length) {
    const next = Q.waiting.shift();
    if (next.j.status === 'cancelled') {
      next.resolve(false);
      continue;
    }
    next.resolve(true);
    return; // the slot passes straight to the next job
  }
  Q.running = Math.max(0, Q.running - 1);
}
/** The queue as numbers, for the jobs overview. */
export const queueInfo = () => ({
  running: Q.running,
  waiting: Q.waiting.length,
  max: MAX_PARALLEL,
});
export async function work(j, text, opts: any = {}) {
  j.error = null;
  if (!(await takeSlot(j))) {
    j.finishedAt = new Date().toISOString();
    return;
  }
  try {
    await workNow(j, text, opts);
  } finally {
    releaseSlot();
  }
}
async function workNow(j, text, { resume = false }: any = {}) {
  if (j.status === 'cancelled') return; // stopped while it waited for its slot
  j.status = 'running';
  j.error = null;
  try {
    const agent = await resolveAgent(j.agentId);
    say(
      j,
      j.rounds === 1
        ? `${agent.name} agent (Claude Code) is working on ${j.ticketKey} on ${j.branch}…`
        : `${agent.name} agent is making the requested changes…`,
    );
    const result = await runAgent(j, j.agentId, text, { resume });
    if (j.status === 'cancelled') return;
    if (result) j.summary = [j.summary, result].filter(Boolean).join('\n\n---\n\n');
    await collectDiff(j);
    if (!agent.writes) {
      j.status = j.files.length ? 'review' : 'report';
      say(j, `${agent.name} finished. Read its report below.`, 'done');
      return;
    }
    j.status = j.files.length ? 'review' : 'empty';
    say(
      j,
      j.files.length
        ? `Done: ${j.files.length} file${j.files.length === 1 ? '' : 's'} changed. Review the diff (or ask the Review agent), then open the pull request.`
        : 'The agent finished without changing any files.',
      'done',
    );
  } catch (e) {
    j.status = 'failed';
    j.error = e.message;
    say(j, e.message, 'error');
  } finally {
    j.finishedAt = new Date().toISOString();
  }
}
/** Runs the Review agent on the job's changes (read-only); its findings are kept on the job. */
/**
 * Runs the Review agent on the job's changes (read-only); its findings are kept on the job. With {
 * panel: true } the Review Panel runs one Review agent per lens (lib/agents.ts REVIEW_LENSES) in
 * parallel.
 */
export async function reviewJob(id, { panel = false, agent = 'review' }: any = {}) {
  const reviewer =
    agent === 'ui-review' || /^custom-/.test(agent) ? agent : await requireRole('review');
  const rv = await ensureAgent(reviewer);
  const j = JOBS.get(id);
  if (!j)
    throw Object.assign(
      new Error('That code job is gone (the server restarted). Start it again.'),
      { status: 404 },
    );
  if (['running', 'queued', 'starting'].includes(j.status))
    throw Object.assign(new Error('Wait for the current round to finish.'), { status: 409 });
  if (!j.files?.length)
    throw Object.assign(new Error('There are no changes to review yet.'), { status: 409 });
  if (panel) await ensureAgent('review-panel');
  const before = j.status;
  j.status = 'running';
  j.error = null;
  j.reviewing = true;
  (async () => {
    try {
      say(
        j,
        panel
          ? `Review Panel: ${REVIEW_LENSES.length} Review agents (Claude Code) are reviewing in parallel: ${REVIEW_LENSES.map((l) => l.name).join(', ')}…`
          : `${rv.name} agent (Claude Code) is reviewing the changes…`,
      );
      const diff: any = await jobDiff(id);
      const t = j.ticket;
      const text = [
        `Review the changes made for issue ${t.key}: ${t.title}.`,
        t.userStory && `User story: ${t.userStory}`,
        t.acceptanceCriteria?.length &&
          `Acceptance criteria:\n${t.acceptanceCriteria.map((a, i) => `${i + 1}. ${a}`).join('\n')}`,
        `Changed files: ${j.files.map((f) => f.path).join(', ')}`,
        `The diff (staged, uncommitted):\n\`\`\`diff\n${diff.slice(0, 120000)}\n\`\`\``,
        await dbCheck(
          j.projectId,
          diff,
          j.files.map((f) => f.path),
        ),
      ]
        .filter(Boolean)
        .join('\n\n');
      let entry;
      if (panel) {
        const lenses = await Promise.all(
          REVIEW_LENSES.map(async (l) => {
            try {
              return {
                id: l.id,
                name: l.name,
                text: await runAgent(
                  j,
                  reviewer,
                  `${text}\n\nYou are one reviewer on a panel. Review ONLY through the ${l.name} lens: ${l.focus}. Leave everything else to the other reviewers.`,
                ),
              };
            } catch (e) {
              return { id: l.id, name: l.name, text: `_This reviewer failed: ${e.message}_` };
            }
          }),
        );
        entry = {
          at: new Date().toISOString(),
          round: j.rounds,
          panel: true,
          lenses,
          text: lenses.map((l) => `## ${l.name}\n\n${l.text}`).join('\n\n'),
        };
      } else
        entry = {
          at: new Date().toISOString(),
          round: j.rounds,
          agent: rv.name,
          text: await runAgent(j, reviewer, text),
        };
      if (j.status === 'cancelled') {
        j.status = before;
        j.reviewing = false;
        return;
      } // stopping a review keeps the changes
      j.reviews = [...(j.reviews || []), entry];
      j.status = before === 'running' ? 'review' : before;
      say(
        j,
        'Review finished. Ask the Build agent to fix the findings, or open the pull request.',
        'done',
      );
    } catch (e) {
      j.status = before;
      if (!/cancel/i.test(e.message)) {
        j.error = e.message;
        say(j, e.message, 'error');
      }
    } finally {
      j.reviewing = false;
      j.finishedAt = new Date().toISOString();
    }
  })();
  return publicJob(j);
}
// git fetch and worktree add in the same repository at the same time can fail on its lock files:
// one at a time per repo.
G.__tfRepoLocks ??= new Map();
export function withRepoLock(key, fn) {
  const prev = G.__tfRepoLocks.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  G.__tfRepoLocks.set(
    key,
    run.catch(() => {}),
  );
  return run;
}
/**
 * CodeRabbit review of the job's changes (read-only, in the background; can take many minutes). The
 * findings are kept on the job as j.cr; the browser saves them on the issue so they last and show
 * in Reports.
 */
export async function codeRabbitJob(id, { apiKey = '' }: any = {}) {
  const j = JOBS.get(id);
  if (!j)
    throw Object.assign(
      new Error('That code job is gone (the server restarted). Start it again.'),
      { status: 404 },
    );
  if (j.cr?.status === 'running')
    throw Object.assign(new Error('CodeRabbit is already reviewing these changes.'), {
      status: 409,
    });
  if (['running', 'queued', 'starting'].includes(j.status))
    throw Object.assign(new Error('Wait for the agent to finish first.'), { status: 409 });
  if (!j.files?.length)
    throw Object.assign(new Error('There are no changes to review yet.'), { status: 409 });
  await stageAll(j);
  j.cr = {
    status: 'running',
    startedAt: new Date().toISOString(),
    round: j.rounds,
    findings: [],
    log: [],
  };
  say(j, 'CodeRabbit is reviewing the changes (this can take several minutes)…');
  (async () => {
    try {
      const r: any = await reviewWorktree({
        dir: j.dir,
        apiKey,
        register: (child) => (j.children ??= new Set()).add(child),
        onEvent: (kind, data) => {
          if (kind === 'status' && data) j.cr.log.push(data);
          if (kind === 'finding') j.cr.findings.push(data);
        },
      });
      const order = ['critical', 'major', 'minor', 'trivial', 'info'];
      j.cr = {
        ...j.cr,
        status: 'done',
        finishedAt: new Date().toISOString(),
        findings: r.findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)),
        complete: r.complete,
        warning:
          r.error ||
          (r.complete?.unreviewedFileCount
            ? `${r.complete.unreviewedFileCount} file(s) weren't reviewed.`
            : ''),
      };
      const n = (s2) => r.findings.filter((f) => f.severity === s2).length;
      say(
        j,
        r.findings.length
          ? `CodeRabbit finished: ${r.findings.length} finding${r.findings.length === 1 ? '' : 's'} (${n('critical')} critical, ${n('major')} major).`
          : 'CodeRabbit finished: no findings.',
        'done',
      );
    } catch (e) {
      j.cr = { ...j.cr, status: 'failed', finishedAt: new Date().toISOString(), error: e.message };
      say(j, `CodeRabbit: ${e.message}`, 'error');
    }
  })();
  return publicJob(j);
}
/**
 * The database check for a review: the diff's migrations against the project's saved schema (''
 * when there are none).
 */
export async function dbCheck(projectId: string, diff: string, files: string[]) {
  try {
    const { getProject } = await import('../store');
    return migrationCheck(await getProject(projectId), diff, files);
  } catch {
    return '';
  }
}
