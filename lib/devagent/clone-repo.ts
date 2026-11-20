import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../db';
import { claudeCodeCommand, agentModel } from '../claude';
import { resolveAgent, claudeAgentsJson } from '../agents';
import { appEnv } from '../childenv';
import { inspectRepo, git, githubToken, slug } from './review-job';
import { TOOL_VERB, checkTools, prompt, verifyNote } from './api-contract';

// ---------------------------------------------------------------- repository profile "Learn from
// repository" (Project settings → Code & GitHub): a read-only Claude Code agent studies the
// checkout and writes the Repository Profile, which every code job then gets (lib/devagent.ts
// runAgent), so code follows the repo.
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
 * Runs the read-only profile agent in the repository; onStep(text) for progress. Resolves {
 * markdown, commit }.
 * @param {{ localPath: string, model?: string, onStep?: (text: string) => void, signal?:
 *        AbortSignal }} opts
 */
export async function learnRepo({
  localPath,
  model = 'sonnet',
  onStep = (_text) => {},
  signal,
}: any) {
  const repo = await inspectRepo(localPath);
  const { bin, env: baseEnv } = await claudeCodeCommand();
  const env = appEnv(baseEnv); // read-only profile agent: no database at all
  const commit = (await git(repo.path, ['rev-parse', '--short', 'HEAD']).catch(() => '')).trim();
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--strict-mcp-config',
    '--permission-mode',
    'default',
    '--allowedTools',
    'Read Glob Grep LS',
    '--disallowedTools',
    'Bash Edit Write MultiEdit NotebookEdit WebFetch WebSearch Task Agent',
    '--model',
    model,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ bin, args, {
      cwd: repo.path,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    signal?.addEventListener('abort', () => child.kill('SIGTERM'));
    let buf = '',
      stderr = '',
      result = '',
      cost = 0;
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === 'assistant')
          for (const c of ev.message?.content || []) {
            if (c.type === 'tool_use') {
              const inp = c.input || {};
              onStep(
                `${TOOL_VERB[c.name] || c.name} ${inp.file_path ? path.relative(repo.path, inp.file_path) : inp.pattern || inp.path || ''}`.trim(),
              );
            }
          }
        if (ev.type === 'result') {
          result = ev.result || '';
          cost = ev.total_cost_usd || 0;
          if (ev.is_error) stderr += ` ${ev.result || ''}`;
        }
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (signal?.aborted) return reject(Object.assign(new Error('Stopped.'), { status: 499 }));
      const md = String(result)
        .trim()
        .replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/, '$1');
      const start = md.search(/^#\s/m);
      const markdown = (start > 0 ? md.slice(start) : md).trim().slice(0, 14000);
      if (code !== 0 && !markdown)
        return reject(
          new Error(
            stderr.trim().split('\n').slice(-2).join(' ') || `Claude Code stopped (code ${code})`,
          ),
        );
      if (!/^#/.test(markdown))
        return reject(new Error('The agent didn’t return a profile. Try again.'));
      resolve({ markdown, commit, costUsd: cost });
    });
    child.stdin.end(PROFILE_PROMPT);
  });
}
// ---------------------------------------------------------------- repositories cloned by
// TicketForge Project settings → Code & GitHub → Repository → "Clone from Git": instead of pointing
// at a folder you cloned, paste the repository (https URL, SSH URL or owner/name). TicketForge
// clones it into its data folder and keeps it up to date; code jobs then use it like any local
// repository. Tokens are passed per command, never stored in .git.
const CLONE_ROOT = path.join(/*turbopackIgnore: true*/ DATA_DIR, 'repos');
/** "owner/name", https or SSH → { url, host, path, provider } (url is what git clones). */
export function parseRepoSource(input) {
  const raw = String(input || '')
    .trim()
    .replace(/\/+$/, '');
  if (/^[\w.-]+\/[\w.-]+$/.test(raw))
    return {
      url: `https://github.com/${raw.replace(/\.git$/, '')}.git`,
      host: 'github.com',
      path: raw.replace(/\.git$/, ''),
      provider: 'GitHub',
    };
  const m = raw.match(
    /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[\w.-]+@)([^/:]+)(?::\d+)?[:/]+(.+?)(?:\.git)?$/i,
  );
  if (!m)
    throw Object.assign(
      new Error('Paste the repository’s clone URL (https://… or git@…) or owner/name for GitHub.'),
      { status: 400 },
    );
  const [, host, p] = m;
  if (/[\s;&|`$]/.test(raw) || raw.startsWith('-'))
    throw Object.assign(new Error('That doesn’t look like a repository URL.'), { status: 400 });
  return {
    url: /^https?:/i.test(raw)
      ? raw.replace(/\/\/[^@/]+@/, '//') + (raw.endsWith('.git') ? '' : '.git')
      : raw,
    host,
    path: p,
    provider: /gitlab/i.test(host) ? 'GitLab' : /github/i.test(host) ? 'GitHub' : 'Git',
  };
}
/**
 * git -c options that sign in over https with a token for this one command (nothing is written to
 * .git/config).
 */
function authArgs(src, { token = '', gitlabToken = '' }: any = {}) {
  if (!/^https:/i.test(src.url)) return []; // SSH uses your own keys
  const tok = src.provider === 'GitLab' ? gitlabToken : src.provider === 'GitHub' ? token : '';
  if (!tok) return [];
  const user = src.provider === 'GitLab' ? 'oauth2' : 'x-access-token';
  return [
    '-c',
    `http.extraheader=AUTHORIZATION: basic ${Buffer.from(`${user}:${tok}`).toString('base64')}`,
  ];
}
const cleanGitError = (e) =>
  String(e?.message || e)
    .replace(/AUTHORIZATION: basic \S+/gi, 'AUTHORIZATION: ***')
    .replace(/Cloning into '[^']*'\.\.\.\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '') || 'git failed';
/**
 * Clones (or, when already cloned, fetches and fast-forwards) a repository for a project. Returns
 * inspectRepo's details plus { cloned: true, url }. onStep(text) reports progress.
 */
export async function cloneRepo({
  projectId,
  side = 'frontend',
  source,
  branch = '',
  token = '',
  gitlabToken = '',
  onStep = (_t) => {},
}: any) {
  const src = parseRepoSource(source);
  if (!token && src.provider === 'GitHub') token = (await githubToken('').catch(() => '')) || '';
  const dir = path.join(
    CLONE_ROOT,
    `${String(projectId).replace(/[^\w-]/g, '')}-${side === 'backend' ? 'be' : 'fe'}-${slug(src.path.split('/').pop())}`,
  );
  const auth = authArgs(src, { token, gitlabToken });
  fs.mkdirSync(/*turbopackIgnore: true*/ CLONE_ROOT, { recursive: true });
  const has = fs.existsSync(/*turbopackIgnore: true*/ path.join(dir, '.git'));
  try {
    if (has) {
      const cur = (await git(dir, ['remote', 'get-url', 'origin']).catch(() => '')).trim();
      if (cur.replace(/\.git$/, '') !== src.url.replace(/\.git$/, ''))
        await git(dir, ['remote', 'set-url', 'origin', src.url]);
      onStep(`Fetching ${src.path}…`);
      await git(dir, [...auth, 'fetch', '--prune', 'origin'], { timeout: 600000 });
    } else {
      onStep(`Cloning ${src.path} (this can take a minute for big repositories)…`);
      await git(
        CLONE_ROOT,
        [
          ...auth,
          'clone',
          '--no-tags',
          ...(branch ? ['--branch', branch] : []),
          '--',
          src.url,
          dir,
        ],
        {
          timeout: 900000,
        },
      );
    }
    // Keep the checkout on the base branch and current with origin (code jobs branch from
    // origin/<base> anyway).
    await git(dir, ['remote', 'set-head', 'origin', '--auto']).catch(() => {});
    const base =
      branch ||
      (
        await git(dir, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(
          () => '',
        )
      )
        .trim()
        .replace(/^origin\//, '') ||
      'main';
    const dirty = (await git(dir, ['status', '--porcelain']).catch(() => '')).trim();
    if (!dirty) {
      await git(dir, ['checkout', '-q', base]).catch(() =>
        git(dir, ['checkout', '-q', '-b', base, `origin/${base}`]),
      );
      await git(dir, ['merge', '--ff-only', '-q', `origin/${base}`]).catch(() =>
        onStep(`${base} has local commits; left as it is.`),
      );
    } else onStep('The clone has uncommitted changes; left as it is.');
  } catch (e) {
    const msg = cleanGitError(e);
    const authHint =
      /authentication|could not read username|403|not found|repository .* not found|permission denied/i.test(
        msg,
      )
        ? src.provider === 'GitLab'
          ? ' Save a GitLab token (read_repository) in the backend repository settings.'
          : src.provider === 'GitHub'
            ? ' Cloning here uses your own git sign-in: check that git can reach it on this computer (an SSH key or a credential helper, or `gh auth login`). A GitHub token is optional: you can also save one below.'
            : ' Use an SSH URL with a key on this computer.'
        : '';
    throw Object.assign(
      new Error(`Couldn’t ${has ? 'update' : 'clone'} ${src.path}: ${msg}.${authHint}`),
      { status: 400 },
    );
  }
  onStep('Ready.');
  return { ...(await inspectRepo(dir)), cloned: true, url: src.url };
}
/**
 * The same agent instructions and task a local job gets, for a job that runs elsewhere (GitHub
 * Actions): { system, prompt, model, effort, allowedTools, disallowedTools, agentName, writes }.
 */
export async function codeTask({
  ticket,
  agentId,
  instructions = '',
  round = 1,
  context = '',
  dev = {},
  previousSummary = '',
}: any) {
  const agent = await resolveAgent(agentId);
  if (!agent.enabled)
    throw Object.assign(
      new Error(`The ${agent.name} agent is turned off in Administration → Agents.`),
      { status: 400 },
    );
  if (agent.runner !== 'code')
    throw Object.assign(new Error(`${agent.name} isn’t a code agent.`), { status: 400 });
  const extra = checkTools(dev.checkCommand);
  const agents = await claudeAgentsJson({ notes: dev.notes || '', checkTool: extra });
  const routed = await agentModel(agentId, agent);
  let text = prompt(ticket, agent, instructions, round, context);
  if (round > 1 && previousSummary)
    text = `${text}\n\nWhat you did in the earlier rounds (already committed on this branch):\n${String(previousSummary).slice(-6000)}`;
  const note = verifyNote({ dev, linked: [] }, agent.writes);
  if (note)
    text = `${text}\n\n${note}\nThe project's dependencies were installed before you started (when it has a lockfile).`;
  const profile = String(dev.repoProfile?.markdown || '').trim();
  if (profile && round === 1)
    text = `${text}\n\nREPOSITORY PROFILE (follow its structure, conventions and patterns; check it against the code when something looks different):\n${profile}`;
  return {
    system: agents[agentId]?.prompt || agent.prompt || '',
    prompt: text,
    model: dev.model || routed.model,
    effort: agent.effort || '',
    allowedTools: [...agent.tools, ...extra],
    disallowedTools: [
      'Bash(git push:*)',
      'Bash(git commit:*)',
      'Bash(git checkout:*)',
      'Bash(git switch:*)',
      'Bash(git reset:*)',
      'Bash(git rebase:*)',
      'Bash(rm -rf:*)',
      'WebFetch',
      'WebSearch',
    ],
    agentName: agent.name,
    writes: Boolean(agent.writes),
  };
}
export const branchFor = (ticket, dev) =>
  `${dev.branchPrefix ?? 'tf/'}${String(ticket.key || 'issue').toLowerCase()}-${slug(ticket.title)}`;
