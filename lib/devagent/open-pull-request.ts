import { execFile } from 'node:child_process';
import { appEnv } from '../childenv';
import { remoteInfo, prApi, writePrText, prNoun, compareUrl, pushBranch } from './start-pr-review';
import { git, JOBS, publicJob, githubToken } from './review-job';
import { stageAll, say } from './api-contract';

/**
 * Review comments on an open pull/merge request (for "Address review comments"). Returns [{ author,
 * file, line, body }].
 */
export async function reviewComments({ repoPath, target, token, gitlabToken }: any) {
  const remote = await remoteInfo(repoPath);
  if (remote.provider === 'GitLab') {
    const notes = await prApi(
      remote,
      target,
      { token, gitlabToken },
      'GET',
      '/notes?sort=asc&per_page=100',
    );
    return (notes || [])
      .filter((n) => !n.system && !/^\*\*Updated by TicketForge\*\*/.test(n.body || ''))
      .map((n) => ({
        author: n.author?.username || '',
        file: n.position?.new_path || '',
        line: n.position?.new_line || null,
        body: String(n.body || '').slice(0, 2000),
        resolved: Boolean(n.resolved),
      }))
      .filter((n) => !n.resolved);
  }
  const [inline, reviews, general] = await Promise.all([
    prApi(remote, target, { token }, 'GET', '/comments?per_page=100').catch(() => []),
    prApi(remote, target, { token }, 'GET', '/reviews?per_page=100').catch(() => []),
    prApi(remote, target, { token }, 'GET', '/issues/comments?per_page=100').catch(() => []),
  ]);
  return [
    ...(reviews || [])
      .filter((r) => r.body)
      .map((r) => ({
        author: r.user?.login || '',
        file: '',
        line: null,
        body: String(r.body).slice(0, 2000),
      })),
    ...(inline || []).map((c) => ({
      author: c.user?.login || '',
      file: c.path || '',
      line: c.line || c.original_line || null,
      body: String(c.body || '').slice(0, 2000),
    })),
    ...(general || [])
      .filter((c) => !/^\*\*Updated by TicketForge\*\*/.test(c.body || ''))
      .map((c) => ({
        author: c.user?.login || '',
        file: '',
        line: null,
        body: String(c.body || '').slice(0, 2000),
      })),
  ];
}
/**
 * Rewrites an open pull/merge request's title and description from its real diff against the base
 * branch.
 */
export async function describePullRequest({
  repoPath,
  target,
  ticket,
  side,
  token,
  gitlabToken,
  appLink,
  ai,
}: any) {
  const remote = await remoteInfo(repoPath);
  await git(
    repoPath,
    [
      'fetch',
      'origin',
      `+refs/heads/${target.branch}:refs/remotes/origin/${target.branch}`,
      target.base,
    ],
    {
      timeout: 180000,
    },
  );
  const diff = await git(repoPath, [
    'diff',
    '--no-color',
    `origin/${target.base}...origin/${target.branch}`,
  ]).catch(() => '');
  const { title, body } = await writePrText({
    ticket,
    diff,
    side,
    provider: remote.provider,
    appLink,
    ai,
  });
  if (remote.provider === 'GitLab')
    await prApi(remote, target, { token, gitlabToken }, 'PUT', '', { title, description: body });
  else await prApi(remote, target, { token }, 'PATCH', '', { title, body });
  return { title, body };
}
export async function openPullRequest(
  id,
  { title, body, draft, token, gitlabToken, appLink }: any,
) {
  const j = JOBS.get(id);
  if (!j)
    throw Object.assign(
      new Error('That code job is gone (the server restarted). Start it again.'),
      { status: 404 },
    );
  if (!['review'].includes(j.status))
    throw Object.assign(
      new Error(
        j.pr
          ? 'The pull request is already open.'
          : 'There are no changes to open a pull request for.',
      ),
      {
        status: 409,
      },
    );
  const remote = await remoteInfo(j.repoPath);
  const provider = remote.provider || (j.repo ? 'GitHub' : null);
  if (!provider)
    throw Object.assign(
      new Error(
        `Can’t tell where ${j.repoPath} is hosted (origin: ${remote.url || 'none'}). Pull requests work with GitHub and GitLab.`,
      ),
      { status: 400 },
    );
  const t = j.ticket;
  const prTitle = String(title || `${t.key}: ${t.title}`).slice(0, 250);
  await stageAll(j);
  // Commit with the repository's own git config (your name and email). Only when there's something
  // new: after a push that failed, the changes are already committed and pressing the button again
  // just pushes.
  const pending = await git(j.dir, ['diff', '--cached', '--quiet']).then(
    () => false,
    () => true,
  );
  if (pending) {
    await git(j.dir, ['commit', '-F', '-', '--no-verify'], {
      input:
        `${prTitle}\n\n${t.userStory || ''}\n\nRefs ${t.key}${appLink ? ` (${appLink})` : ''}\n`.replace(
          /\n{3,}/g,
          '\n\n',
        ),
    }).catch((e) => {
      throw Object.assign(
        new Error(
          /tell me who you are|user\.(name|email)/i.test(e.message)
            ? `Git doesn’t know who you are in ${j.repoPath}. Set it once in a terminal: git config --global user.name "Your Name" and git config --global user.email you@example.com`
            : e.message,
        ),
        { status: 400 },
      );
    });
    say(j, 'Committed the changes with your git name and email.');
  }
  const prBody =
    body ||
    [
      `Implements **${t.key}: ${t.title}**${appLink ? ` ([TicketForge](${appLink}))` : ''}${j.side === 'backend' ? ' — backend part' : ''}.`,
      t.userStory && `\n> ${t.userStory}`,
      t.acceptanceCriteria?.length &&
        `\n### Acceptance criteria\n${t.acceptanceCriteria.map((a) => `- [ ] ${a}`).join('\n')}`,
      j.summary && `\n### What changed\n${j.summary.slice(0, 6000)}`,
      `\n_Written with Claude Code from TicketForge; reviewed by ${j.startedBy || 'the team'} before opening._`,
    ]
      .filter(Boolean)
      .join('\n');
  const done = (pr) => {
    j.pr = pr;
    j.status = 'pr';
    say(
      j,
      pr.compare
        ? `Pushed ${j.branch}. Open the ${prNoun(provider)} on ${provider}: ${pr.url}`
        : `Opened ${provider === 'GitLab' ? `merge request !${pr.number}` : `pull request #${pr.number}`}.`,
      'done',
    );
    git(j.repoPath, ['worktree', 'remove', '--force', j.dir]).catch(() => {}); // the branch stays for the review
    return {
      job: publicJob(j),
      pr: {
        url: pr.url,
        number: pr.number,
        title: pr.title,
        status: pr.compare ? 'Pushed' : pr.draft ? 'Draft' : 'Open',
        repo: pr.repo,
        provider,
        branch: j.branch,
        base: j.base,
        compare: Boolean(pr.compare),
      },
    };
  };
  // Pushed, but no way to open it through the API: the job links to the page that opens it.
  const viaPage = (why) => {
    say(j, why, 'warn');
    return done({
      url: compareUrl(remote, j),
      number: null,
      title: prTitle,
      draft: Boolean(draft),
      repo: remote.path || j.repo,
      compare: true,
    });
  };

  // Push with your own git setup (the project's token only if that's refused), then open the
  // request.
  await pushBranch(j, remote, { token, gitlabToken });

  if (provider === 'GitLab') {
    const tok = gitlabToken || process.env.GITLAB_TOKEN || '';
    if (!tok)
      return viaPage(
        'No GitLab token to open the merge request with, so it opens on GitLab instead (save a token in Project settings → Code & GitHub to have TicketForge open it).',
      );
    const res = await fetch(
      `https://${remote.host}/api/v4/projects/${encodeURIComponent(remote.path)}/merge_requests`,
      {
        method: 'POST',
        headers: {
          'PRIVATE-TOKEN': tok,
          'Content-Type': 'application/json',
          'User-Agent': 'TicketForge',
        },
        body: JSON.stringify({
          source_branch: j.branch,
          target_branch: j.base,
          title: draft ? `Draft: ${prTitle}` : prTitle,
          description: prBody,
          remove_source_branch: true,
        }),
      },
    ).catch(() => null);
    if (!res)
      return viaPage(`GitLab at ${remote.host} couldn’t be reached to open the merge request.`);
    const mr = await res.json().catch(() => ({}));
    if (!res.ok) {
      const why = Array.isArray(mr.message)
        ? mr.message.join('; ')
        : typeof mr.message === 'object'
          ? JSON.stringify(mr.message)
          : mr.message || mr.error || `GitLab said ${res.status}`;
      return viaPage(`GitLab didn’t open the merge request (${why}).`);
    }
    return done({
      url: mr.web_url,
      number: mr.iid,
      title: mr.title,
      draft: Boolean(mr.draft || mr.work_in_progress),
      repo: remote.path,
    });
  }

  // GitHub: the project's token, GITHUB_TOKEN or your gh sign-in; else gh pr create; else the
  // compare page.
  const repo = remote.provider === 'GitHub' ? remote.path : j.repo;
  const tok = await githubToken(token);
  if (!tok) {
    const out: any = await new Promise((resolve) =>
      execFile(
        'gh',
        [
          'pr',
          'create',
          '--repo',
          repo,
          '--head',
          j.branch,
          '--base',
          j.base,
          '--title',
          prTitle,
          '--body',
          prBody,
          ...(draft ? ['--draft'] : []),
        ],
        { cwd: j.dir, timeout: 60000, env: { ...appEnv(), GH_PROMPT_DISABLED: '1' } },
        (err, stdout) => resolve(err ? '' : String(stdout).trim()),
      ),
    );
    const url = out.split('\n').find((l) => /^https:\/\/github\.com\/.+\/pull\/\d+/.test(l));
    if (url)
      return done({
        url,
        number: Number(url.match(/\/pull\/(\d+)/)[1]),
        title: prTitle,
        draft: Boolean(draft),
        repo,
      });
    return viaPage(
      'No GitHub token or gh sign-in to open the pull request with, so it opens on GitHub instead (save a token in Project settings → Code & GitHub, or run gh auth login, to have TicketForge open it).',
    );
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'TicketForge',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: prTitle,
      head: j.branch,
      base: j.base,
      body: prBody,
      draft: Boolean(draft),
    }),
  }).catch(() => null);
  if (!res) return viaPage('GitHub couldn’t be reached to open the pull request.');
  const pr = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why =
      pr.errors
        ?.map((e) => e.message)
        .filter(Boolean)
        .join('; ') ||
      pr.message ||
      `GitHub said ${res.status}`;
    return viaPage(`GitHub didn’t open the pull request (${why}).`);
  }
  return done({ url: pr.html_url, number: pr.number, title: pr.title, draft: pr.draft, repo });
}
