import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { askJson, claudeCodeCommand, agentModel, noteAgentUsage } from '../claude';
import { resolveAgent, claudeAgentsJson } from '../agents';
import { appEnv } from '../childenv';
import { testDatabase } from '../appdb';
import { BRAIN_DIR, git, JOBS, MAX_DIFF } from './review-job';

/**
 * Stages the agent's changes, never the linked dependency folders or the brain notes. Only paths
 * git doesn't already ignore get an exclude: naming an ignored path (a .gitignore with
 * "node_modules" without the trailing slash) makes git add fail with "The following paths are
 * ignored by one of your .gitignore files", which stopped the job.
 */
export async function stageAll(j) {
  const skip: any[] = [];
  for (const p of [...(j.linked || []), BRAIN_DIR]) {
    const ignored = await git(j.dir, ['check-ignore', '-q', '--no-index', '--', p]).then(
      () => true,
      () => false,
    );
    if (!ignored) skip.push(p);
  }
  return git(j.dir, ['add', '-A', '--', '.', ...skip.map((p) => `:(exclude)${p}`)]);
}
/**
 * Claude Code permission rules for the check command: one per part of `a && b; c`, plus read-only
 * git.
 */
export function checkTools(check) {
  const parts = String(check || '')
    .split(/&&|\|\||;|\|/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/^(\w+=\S*\s+)+/, '')) // FOO=1 npm test → npm test
    .filter((x) => !/^(cd|rm|git|sudo)\b/.test(x));
  const rules = parts.map((x) => `Bash(${x.split(/\s+/).slice(0, 2).join(' ')}:*)`);
  return [
    ...new Set([
      ...rules,
      'Bash(git diff:*)',
      'Bash(git status:*)',
      'Bash(git log:*)',
      'Bash(git show:*)',
    ]),
  ];
}
/** What the agent needs to know about verifying its work, added to every round. */
export function verifyNote(j, writes) {
  const check = String(j.dev.checkCommand || '').trim();
  const deps = j.linked?.length
    ? `Dependencies are already installed (${j.linked.slice(0, 4).join(', ')}${j.linked.length > 4 ? '…' : ''} linked from the main checkout): don't install packages.`
    : '';
  if (!writes) return deps;
  return [
    check
      ? `Check command for this repository: \`${check}\`. Run it before you finish and fix what fails (at most 3 fix-and-rerun cycles; if it still fails, explain why).`
      : "No check command is configured, so you can't run tests here. Re-read your changes against each acceptance criterion instead, and say in your summary which tests a person should run.",
    deps,
    'You can run `git diff` and `git status` to review your own changes.',
  ]
    .filter(Boolean)
    .join('\n');
}
export const say = (j, text, kind = 'info') => {
  j.log.push({ at: new Date().toISOString(), kind, text: String(text).slice(0, 500) });
  if (j.log.length > 800) j.log.splice(0, j.log.length - 800);
};
export const TOOL_VERB = {
  Read: 'Reading',
  Edit: 'Editing',
  MultiEdit: 'Editing',
  Write: 'Writing',
  Glob: 'Finding files',
  Grep: 'Searching',
  LS: 'Listing',
  Bash: 'Running',
  TodoWrite: 'Planning',
  Task: 'Delegating to',
  Agent: 'Delegating to',
};
const clipText = (x, n) => {
  const t = String(x || '').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
/**
 * The feature around an issue, so the agent builds the right thing: the epic, the issue's
 * sub-tasks, and the other issues in the epic (so it doesn't build their parts).
 */
export function issueContext(project, ticket) {
  const epic = (project.epics || []).find((e) => e.id === ticket.epicId);
  const subtasks = project.tickets.filter((t) => t.parentId === ticket.id);
  const siblings = epic
    ? project.tickets.filter((t) => t.epicId === epic.id && !t.parentId && t.id !== ticket.id)
    : [];
  return [
    `PROJECT: ${project.name}${project.description ? ` — ${clipText(project.description, 600)}` : ''}`,
    epic &&
      `FEATURE (epic) this issue belongs to: ${epic.key || ''} ${epic.title}${epic.description ? `\n${clipText(epic.description, 1200)}` : ''}`,
    subtasks.length &&
      `Sub-tasks of this issue (all part of this job):\n${subtasks
        .slice(0, 30)
        .map(
          (t) =>
            `- ${t.key || ''} ${t.title}${t.description ? `: ${clipText(t.description, 300)}` : ''}`,
        )
        .join('\n')}`,
    siblings.length &&
      `Other issues in the same feature (separate jobs: don't build them, but stay compatible with them):\n${siblings
        .slice(0, 30)
        .map((t) => `- ${t.key || ''} ${t.title}`)
        .join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
/**
 * One API contract for an issue built in both repositories at once, so the backend and frontend
 * jobs can run in parallel and still meet: the backend implements exactly this, the frontend calls
 * exactly this. Markdown.
 */
export async function apiContract({ project, ticket, ai = {} }: any) {
  const t = ticket;
  const res = await askJson({
    ...ai,
    task: 'repo',
    reasoning: 'fast',
    system: `You are a senior engineer agreeing the API between a frontend and a backend
before two developers build one issue in parallel. Keep it minimal: only the endpoints this issue needs. Use REST and JSON,
plural resource paths, consistent field names in camelCase. When the issue extends an endpoint that probably
already exists (for example a list the app already shows), never redesign it: keep its current response shape and
describe only what is added ("existing response; each item gains stock: integer"). Return JSON only.`,
    prompt: `Project: ${project.name}
Issue ${t.key}: ${t.title}
${t.userStory ? `User story: ${t.userStory}\n` : ''}${t.description ? `Description: ${clipText(t.description, 2500)}\n` : ''}${t.acceptanceCriteria?.length ? `Acceptance criteria:\n${t.acceptanceCriteria.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n` : ''}
Return {"endpoints":[{"method":"GET|POST|PUT|PATCH|DELETE","path":"/api/...","purpose":"...","request":"JSON shape or query params, or none","response":"JSON shape on success, with status","errors":"status codes and when"}],"notes":"shared rules: auth, validation, pagination, money/date formats (short)"}`,
  });
  const eps = Array.isArray(res?.endpoints) ? res.endpoints.slice(0, 12) : [];
  if (!eps.length) return '';
  return [
    ...eps.map(
      (e) =>
        `- **${String(e.method || 'GET').toUpperCase()} ${e.path}**: ${e.purpose || ''}\n  Request: ${e.request || 'none'}\n  Response: ${e.response || ''}\n  Errors: ${e.errors || 'n/a'}`,
    ),
    res.notes ? `\nShared rules: ${res.notes}` : '',
  ].join('\n');
}
/**
 * What the issue asks for, as the agent's task. The agent's role and rules are its system prompt
 * (lib/agents.ts).
 */
export function prompt(t, agent, extra, round, context = '') {
  const lines = [
    round > 1
      ? `Continue the work on issue ${t.key}. Your previous changes are already in the working tree; adjust them as asked below.`
      : agent.id === 'feature-tests'
        ? `Write and run the automated tests for issue ${t.key}.`
        : agent.id === 'free-worker'
          ? `Work on this task in the context of issue ${t.key}.`
          : agent.id === 'bug-fix'
            ? `Fix the bug described in issue ${t.key}.`
            : agent.id === 'test-automation'
              ? `Write the end-to-end tests for issue ${t.key}.`
              : agent.id === 'ui-review'
                ? `Audit the UI of the screens and components that issue ${t.key} touches. Find them in the repository first.`
                : agent.id === 'frontend'
                  ? `Build the UI for issue ${t.key} in this repository.`
                  : agent.id === 'backend'
                    ? `Build the server side (APIs, data, rules) for issue ${t.key} in this repository.`
                    : `Implement issue ${t.key} in this repository.`,
    '',
    `Title: ${t.title}`,
    t.type && `Type: ${t.type}${t.points ? ` · ${t.points} points` : ''}`,
    t.userStory && `User story: ${t.userStory}`,
    t.description && `Description:\n${t.description}`,
    t.acceptanceCriteria?.length &&
      `Acceptance criteria:\n${t.acceptanceCriteria.map((a, i) => `${i + 1}. ${a}`).join('\n')}`,
    t.testCases?.length &&
      `Test cases it must pass:\n${t.testCases
        .slice(0, 20)
        .map((c) => `- ${c.title}${c.expected ? ` (expected: ${c.expected})` : ''}`)
        .join('\n')}`,
    extra && `${round > 1 ? 'What to change now' : 'Extra instructions'}:\n${extra}`,
    round === 1 && context,
  ];
  return lines.filter(Boolean).join('\n');
}
/**
 * Runs one TicketForge agent as a Claude Code agent in the job's worktree (`--agents` + `--agent`),
 * streaming its steps into the job log. A follow-up round resumes the same Claude Code session, so
 * the agent keeps its context.
 * Returns the agent's final message.
 */
export async function runAgent(j, agentId, text, { resume = false }: any = {}) {
  const agent = await resolveAgent(agentId);
  if (!agent.enabled)
    throw Object.assign(
      new Error(`The ${agent.name} agent is turned off in Administration → Agents.`),
      { status: 400 },
    );
  const { bin, env: baseEnv } = await claudeCodeCommand();
  // The project's Test database (or the person's own), never TicketForge's own database or secrets.
  // Looked up each round, so the connection string is never kept on the job (which is saved and
  // shown in the app).
  const db = await testDatabase(j.projectId, j.userId, { local: true }).catch(() => null);
  const env = appEnv(baseEnv, db?.url || '');
  const extra = checkTools(j.dev.checkCommand);
  const agents = await claudeAgentsJson({ notes: j.dev.notes || '', checkTool: extra });
  if (!agents[agentId])
    throw Object.assign(new Error(`The ${agent.name} agent isn’t available.`), { status: 400 });
  const tools = [...agent.tools, ...extra];
  const note = verifyNote(j, agent.writes);
  if (note) text = `${text}\n\n${note}`;
  if (!resume)
    text = `${text}\n\n${
      db
        ? `DATABASE: DATABASE_URL and TEST_DATABASE_URL in your environment point to ${db.name} (${db.engineLabel}: ${db.database} on ${db.host}), a test database for this app. Run migrations, seeds and tests against it when the work needs a database. Never connect to any other database, and never print or write the connection string into files.`
        : 'DATABASE: no test database is set up for this project (Project settings → Database), so DATABASE_URL is not set. Don’t run migrations or tests that need a database; say in your summary what should be run against one.'
    }`;
  // The Repository Profile (Learn from repository): how this codebase is built, for the first round
  // of a job.
  const profile = String(j.dev.repoProfile?.markdown || '').trim();
  if (profile && !resume)
    text = `${text}\n\nREPOSITORY PROFILE (learned from this repository${j.dev.repoProfile.commit ? ` at ${j.dev.repoProfile.commit}` : ''}; follow its structure, conventions and patterns, and check it against the code when something looks different):\n${profile}`;
  const routed = await agentModel(agentId, agent);
  const model = j.dev.model || routed.model;
  if (agents[agentId]) agents[agentId].model = model; // the agent definition's model would win over --model
  const started = Date.now(),
    costBefore = j.costUsd || 0;
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--strict-mcp-config',
    '--permission-mode',
    agent.writes ? 'acceptEdits' : 'default',
    '--agents',
    JSON.stringify(agents),
    '--agent',
    agentId,
    '--allowedTools',
    tools.join(' '),
    '--disallowedTools',
    'Bash(git push:*) Bash(git commit:*) Bash(git checkout:*) Bash(git switch:*) Bash(git reset:*) Bash(git rebase:*) Bash(rm -rf:*) WebFetch WebSearch',
    '--model',
    model,
  ];
  if (agent.effort) args.push('--effort', agent.effort);
  if (resume && j.sessions?.[agentId]) args.push('--resume', j.sessions[agentId]);
  return new Promise((resolve, reject) => {
    // Its own process group (not on Windows): Stop then ends the agent and everything it started
    // (tests, servers).
    const child = spawn(/*turbopackIgnore: true*/ bin, args, {
      cwd: j.dir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    j.child = child;
    (j.children ??= new Set()).add(child);
    let buf = '',
      stderr = '',
      result = '';
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
        if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) {
          j.sessions = { ...(j.sessions || {}), [agentId]: ev.session_id };
        }
        if (ev.type === 'assistant') {
          const sub = ev.parent_tool_use_id ? '  ↳ ' : '';
          for (const c of ev.message?.content || []) {
            if (c.type === 'tool_use') {
              const inp = c.input || {};
              const what = inp.file_path
                ? path.relative(j.dir, inp.file_path)
                : inp.subagent_type || inp.pattern || inp.command || inp.path || '';
              if (c.name === 'TodoWrite' && Array.isArray(inp.todos)) {
                j.todos = inp.todos.map((x) => ({ content: x.content, status: x.status }));
                say(
                  j,
                  `${sub}Planning: ${inp.todos.filter((x) => x.status === 'completed').length}/${inp.todos.length} steps done`,
                  'tool',
                );
                continue;
              }
              say(j, `${sub}${TOOL_VERB[c.name] || c.name} ${what}`.trim(), 'tool');
            } else if (c.type === 'text' && c.text.trim() && !sub)
              say(j, c.text.trim().split('\n')[0], 'text');
          }
        } else if (ev.type === 'result') {
          result = ev.result || '';
          if (ev.session_id) j.sessions = { ...(j.sessions || {}), [agentId]: ev.session_id };
          if (typeof ev.total_cost_usd === 'number')
            j.costUsd = (j.costUsd || 0) + ev.total_cost_usd;
          if (ev.is_error) stderr += ` ${ev.result || ''}`;
        }
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      j.child = null;
      j.children?.delete(child);
      noteAgentUsage({
        task: routed.task,
        model,
        ms: Date.now() - started,
        costUsd: (j.costUsd || 0) - costBefore,
      });
      if (j.status === 'cancelled') return resolve('');
      if (code !== 0 && !result)
        return reject(
          new Error(
            stderr.trim().split('\n').slice(-2).join(' ') || `Claude Code stopped (code ${code})`,
          ),
        );
      resolve(result.trim());
    });
    child.stdin.end(text);
  });
}
export async function collectDiff(j) {
  await stageAll(j);
  const stat: any = await git(j.dir, ['diff', '--cached', '--numstat']);
  j.files = stat
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [a, d, f] = l.split('\t');
      return { path: f, added: Number(a) || 0, removed: Number(d) || 0 };
    });
}
export async function jobDiff(id, file?) {
  const j = JOBS.get(id);
  if (!j)
    throw Object.assign(
      new Error('That code job is gone (the server restarted). Start it again.'),
      { status: 404 },
    );
  const out: any = await git(j.dir, [
    'diff',
    '--cached',
    '--no-color',
    ...(file ? ['--', file] : []),
  ]);
  return out.length > MAX_DIFF
    ? `${out.slice(0, MAX_DIFF)}\n… (diff cut at ${MAX_DIFF.toLocaleString()} characters)`
    : out;
}
/**
 * A job's output as a git tree: what its worktree holds now, or its branch once the worktree is
 * gone (after the pull request opened).
 */
export async function outputOf(j) {
  if (j.dir && fs.existsSync(/*turbopackIgnore: true*/ j.dir)) {
    await stageAll(j);
    return { tree: (await git(j.dir, ['write-tree'])).trim(), cwd: j.dir, head: 'HEAD' };
  }
  return { tree: j.branch, cwd: j.repoPath, head: j.branch };
}
