import { askJson } from '../claude';
import { requireRole } from '../agents';
import { git, JOBS, githubToken, publicJob, inspectRepo, dbCheck } from './review-job';
import { say, stageAll } from './api-contract';
import { startJob } from './commit-local';

/**
 * Where a repository's `origin` is hosted: { provider: 'GitHub' | 'GitLab', host, path } (path =
 * owner/name or group/…/project).
 */
export async function remoteInfo(repoPath) {
  const url = (await git(repoPath, ['remote', 'get-url', 'origin']).catch(() => '')).trim();
  const m = url.match(
    /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/]+@)([^/:]+)(?::\d+)?[:/]+(.+?)(?:\.git)?\/?$/i,
  );
  if (!m) return { provider: null, host: '', path: '', url };
  const host = m[1].toLowerCase();
  return {
    provider: /github\.com$/.test(host)
      ? 'GitHub'
      : /gitlab/.test(host) || host.startsWith('git.')
        ? 'GitLab'
        : null,
    host,
    path: m[2],
    url: url.replace(/\/\/[^@/]+@/, '//'),
  };
}
/**
 * Commits the reviewed changes, pushes the branch and opens the review: a pull request on GitHub, a
 * merge request on GitLab (gitlab.com or self-hosted). The provider comes from the repository's
 * origin remote.
 */
/**
 * A short label for an update job ("Address review comments"), used in its commit message and PR
 * comment.
 */
export function setUpdateLabel(id, label) {
  const j = JOBS.get(id);
  if (j) j.updateLabel = label;
}
/**
 * Pushes the job's branch to the repository's origin the way you would from a terminal: with the
 * repository's own git configuration (its remote, your SSH key, Keychain or credential helper).
 * Only if that is refused does it try again with the project's GitHub/GitLab token, for this one
 * command (never stored in the repository's config).
 */
export async function pushBranch(j, remote, { token, gitlabToken }: any = {}) {
  const args = ['push', '-u', 'origin', `HEAD:refs/heads/${j.branch}`];
  try {
    await git(j.dir, args, { timeout: 180000 });
    say(j, `Pushed ${j.branch} to ${remote.path || 'origin'} with your git setup.`);
    return;
  } catch (first) {
    let auth: any[] = [];
    if (/^https?:/i.test(remote.url)) {
      if (remote.provider === 'GitLab') {
        const tok = gitlabToken || process.env.GITLAB_TOKEN || '';
        if (tok)
          auth = [
            '-c',
            `http.https://${remote.host}/.extraheader=AUTHORIZATION: basic ${Buffer.from(`oauth2:${tok}`).toString('base64')}`,
          ];
      } else {
        const tok = await githubToken(token);
        if (tok)
          auth = [
            '-c',
            `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${tok}`).toString('base64')}`,
          ];
      }
    }
    if (!auth.length)
      throw Object.assign(
        new Error(
          `Couldn’t push ${j.branch} to origin with your git setup: ${first.message} Check that you can push to this repository from a terminal (git push), or save a token in Project settings → Code & GitHub.`,
        ),
        { status: 400 },
      );
    await git(j.dir, [...auth, ...args], { timeout: 180000 }).catch((e) => {
      throw Object.assign(
        new Error(
          `Couldn’t push ${j.branch}: with your git setup (${first.message}), nor with the project’s token (${e.message}).`,
        ),
        { status: 400 },
      );
    });
    say(
      j,
      `Pushed ${j.branch} with the project’s token (your git setup was refused: ${first.message.slice(0, 160)}).`,
      'warn',
    );
  }
}
/** The page that opens a pull/merge request for a pushed branch, for when the API can't be used. */
export const compareUrl = (remote, j) =>
  remote.provider === 'GitLab'
    ? `https://${remote.host}/${remote.path}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(j.branch)}&merge_request%5Btarget_branch%5D=${encodeURIComponent(j.base)}`
    : `https://github.com/${remote.path || j.repo}/compare/${encodeURIComponent(j.base)}...${encodeURIComponent(j.branch)}?expand=1`;
export const prNoun = (provider) => (provider === 'GitLab' ? 'merge request' : 'pull request');
const prRef = (provider, n) => (provider === 'GitLab' ? `!${n}` : `#${n}`);
/** Calls the GitHub or GitLab API for a pull/merge request. */
export async function prApi(
  remote,
  target,
  { token, gitlabToken }: any,
  method,
  sub = '',
  bodyIn?,
) {
  if (remote.provider === 'GitLab') {
    const tok = gitlabToken || process.env.GITLAB_TOKEN || '';
    if (!tok)
      throw Object.assign(
        new Error(
          'No GitLab token: save one in Project settings → Code & GitHub → Backend repository.',
        ),
        {
          status: 400,
        },
      );
    const res = await fetch(
      `https://${remote.host}/api/v4/projects/${encodeURIComponent(remote.path)}/merge_requests/${target.number}${sub}`,
      {
        method,
        headers: {
          'PRIVATE-TOKEN': tok,
          'Content-Type': 'application/json',
          'User-Agent': 'TicketForge',
        },
        body: bodyIn ? JSON.stringify(bodyIn) : undefined,
      },
    );
    const out = await res.json().catch(() => ({}));
    if (!res.ok)
      throw Object.assign(
        new Error(`GitLab said ${res.status}: ${out.message || out.error || ''}`),
        { status: 400 },
      );
    return out;
  }
  const tok = await githubToken(token);
  if (!tok)
    throw Object.assign(
      new Error(
        'No GitHub token: save one in Project settings → Code & GitHub, or sign in with `gh auth login`.',
      ),
      {
        status: 400,
      },
    );
  const res = await fetch(
    `https://api.github.com/repos/${remote.path}${sub.startsWith('/issues') ? sub.replace('/issues', `/issues/${target.number}`) : `/pulls/${target.number}${sub}`}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${tok}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'TicketForge',
        'Content-Type': 'application/json',
      },
      body: bodyIn ? JSON.stringify(bodyIn) : undefined,
    },
  );
  const out = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(new Error(`GitHub said ${res.status}: ${out.message || ''}`), {
      status: 400,
    });
  return out;
}
/**
 * Writes a pull request's title and description from what changed: the diff, the agent's summary
 * and the issue.
 * Returns { title, body } (Markdown).
 */
export async function writePrText({
  ticket,
  diff,
  summary = '',
  side = '',
  provider = 'GitHub',
  appLink = '',
  ai = {},
}: any) {
  const t = ticket;
  const res = await askJson({
    ...ai,
    task: 'pr',
    reasoning: 'fast',
    system: `You write clear ${prNoun(provider)} descriptions for code review. Plain, specific, short sentences.
Use only what the diff and notes show; never invent behaviour. Return JSON only.`,
    prompt: `Issue ${t.key}: ${t.title}
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
Return JSON: { "title": "…", "body": "…" }`,
  });
  const title = String(res.title || `${t.key}: ${t.title}`).slice(0, 120);
  const body = `${String(res.body || '').trim()}\n\n---\nRefs ${t.key}${appLink ? ` · [Open in TicketForge](${appLink})` : ''} · written with Claude Code from TicketForge`;
  return { title, body };
}
/** A draft title and description for the job's changes, for review before opening the PR. */
export async function prDraft(id, { appLink, ai }: any = {}) {
  const j = JOBS.get(id);
  if (!j)
    throw Object.assign(
      new Error('That code job is gone (the server restarted). Start it again.'),
      { status: 404 },
    );
  const diff = await git(j.dir, ['diff', '--cached', '--no-color']).catch(() => '');
  const remote = await remoteInfo(j.repoPath);
  return writePrText({
    ticket: j.ticket,
    diff,
    summary: j.summary,
    side: j.side === 'backend' ? 'backend' : '',
    provider: remote.provider || 'GitHub',
    appLink,
    ai,
  });
}
/**
 * Updating an open pull/merge request: commits the reviewed changes and pushes them to the
 * request's own branch (the request updates itself), then leaves a short comment saying what
 * changed.
 */
export async function pushToPullRequest(id, { message, token, gitlabToken }: any = {}) {
  const j = JOBS.get(id);
  if (!j)
    throw Object.assign(
      new Error('That code job is gone (the server restarted). Start it again.'),
      { status: 404 },
    );
  if (!j.target)
    throw Object.assign(new Error('This job isn’t updating a pull request.'), { status: 400 });
  if (j.status !== 'review')
    throw Object.assign(new Error('There are no changes to push.'), { status: 409 });
  const remote = await remoteInfo(j.repoPath);
  const t = j.ticket;
  const msg = String(message || `${t.key}: ${j.updateLabel || 'Address requested changes'}`).slice(
    0,
    250,
  );
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
  await (
    remote.provider === 'GitLab'
      ? prApi(remote, j.target, { token, gitlabToken }, 'POST', '/notes', { body: note })
      : prApi(remote, j.target, { token, gitlabToken }, 'POST', '/issues/comments', { body: note })
  )
    .then(() => say(j, 'Left a comment on it describing the update.'))
    .catch((e) => say(j, `Couldn’t leave a comment (${e.message}).`, 'warn'));
  git(j.repoPath, ['worktree', 'remove', '--force', j.dir]).catch(() => {});
  return { job: publicJob(j), commit: sha };
}
/**
 * Reviews an open pull/merge request with a read-only review agent (Review a Pull Request or UI/UX
 * Review): fetches its branch, reads the diff against the base, and runs the agent on the request's
 * own branch. The findings are the job's report; postReview() can then leave them on the request as
 * a comment.
 */
export async function startPrReview({
  projectId,
  ticket,
  dev,
  target,
  user,
  agentId = '',
  side = 'frontend',
  focus = '',
}: any) {
  agentId ||= await requireRole('review');
  const repo = await inspectRepo(dev.localPath);
  await git(
    repo.path,
    [
      'fetch',
      'origin',
      `+refs/heads/${target.branch}:refs/remotes/origin/${target.branch}`,
      target.base,
    ],
    {
      timeout: 180000,
    },
  ).catch((e) => {
    throw Object.assign(
      new Error(`Couldn’t fetch ${target.branch} and ${target.base} from origin: ${e.message}`),
      { status: 400 },
    );
  });
  const range = `origin/${target.base}...origin/${target.branch}`;
  const stat = (await git(repo.path, ['diff', '--numstat', range])).trim();
  if (!stat)
    throw Object.assign(
      new Error(
        `${prNoun(target.provider)} ${prRef(target.provider, target.number)} has no changes against ${target.base}.`,
      ),
      { status: 400 },
    );
  const diff: any = await git(repo.path, ['diff', '--unified=4', range]);
  const files = stat.split('\n').map((l) => {
    const [a, d, f] = l.split('\t');
    return `${f} (+${a}/−${d})`;
  });
  const t = ticket;
  const instructions = [
    `Review ${prNoun(target.provider)} ${prRef(target.provider, target.number)} “${target.title}” (${target.branch} → ${target.base}) for issue ${t.key}: ${t.title}.`,
    t.userStory && `User story: ${t.userStory}`,
    t.acceptanceCriteria?.length &&
      `Acceptance criteria:\n${t.acceptanceCriteria.map((x, i) => `${i + 1}. ${x}`).join('\n')}`,
    `Changed files (${files.length}): ${files.join(', ')}`,
    `The diff against ${target.base}${diff.length > 120000 ? ' (cut to the first 120,000 characters; read the files for the rest)' : ''}:\n\`\`\`diff\n${diff.slice(0, 120000)}\n\`\`\``,
    focus && `Focus especially on: ${focus}`,
    await dbCheck(projectId, diff, files),
    'The working folder is the request’s branch as it is now: read any file you need. Do not change files.',
    'Write the review in Markdown: a one-paragraph verdict (approve / approve with comments / request changes), then findings grouped as Blocking, Should fix and Nits, each with file:line, what is wrong and the fix. End with which acceptance criteria are met, missing or untested.',
  ]
    .filter(Boolean)
    .join('\n\n');
  const job = await startJob({
    projectId,
    ticket,
    dev,
    instructions,
    user,
    agentId,
    side,
    target,
    context: `REVIEWING AN OPEN ${target.provider === 'GitLab' ? 'MERGE' : 'PULL'} REQUEST: ${target.url}. Read-only: report findings, never edit.`,
  });
  const j = JOBS.get(job.id);
  if (j) {
    j.kind = 'pr-review';
    j.updateLabel = 'AI code review';
  }
  return publicJob(j || job);
}
/** Leaves the review job's findings on the pull/merge request as one comment. */
export async function postReview(id, { token, gitlabToken }: any = {}) {
  const j = JOBS.get(id);
  if (!j)
    throw Object.assign(new Error('That review is gone (the server restarted). Run it again.'), {
      status: 404,
    });
  if (!j.target || !j.summary)
    throw Object.assign(new Error('There’s no finished review to post.'), { status: 409 });
  const remote = await remoteInfo(j.repoPath);
  const body = `**AI code review** · ${j.agentName} via TicketForge for ${j.ticketKey}\n\n${j.summary.slice(0, 60000)}`;
  await (remote.provider === 'GitLab'
    ? prApi(remote, j.target, { token, gitlabToken }, 'POST', '/notes', { body })
    : prApi(remote, j.target, { token, gitlabToken }, 'POST', '/issues/comments', { body }));
  j.posted = new Date().toISOString();
  say(
    j,
    `Posted the review on ${prNoun(remote.provider)} ${prRef(remote.provider, j.target.number)}.`,
    'done',
  );
  return publicJob(j);
}
