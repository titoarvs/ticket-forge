// CodeRabbit's review comments on a linked pull request (GitHub) or merge request (GitLab), read as
// findings in the same shape as `coderabbit review --agent` (lib/coderabbit.ts): severity,
// category, file, lines, title, comment and the "Prompt for AI Agents" fix instructions. Resolved
// and outdated threads are marked so the report can skip them.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';

const GH_BOTS = ['coderabbitai[bot]', 'coderabbitai'];
const GL_BOTS = ['coderabbitai', 'coderabbit', 'coderabbit-ai'];
const SEV = ['critical', 'major', 'minor', 'trivial', 'info'];
const MAX_PAGES = 5;

const run: any = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 20000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
/**
 * GitHub REST JSON with the project's token, then the signed-in `gh` CLI, then GITHUB_TOKEN / no
 * token.
 */
async function gh(path, token) {
  const tok = token || process.env.GITHUB_TOKEN || '';
  if (!token) {
    try {
      return JSON.parse(await run('gh', ['api', path]));
    } catch {
      /* gh missing or not signed in */
    }
  }
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      'User-Agent': 'TicketForge',
      Accept: 'application/vnd.github+json',
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
    },
  });
  if (!res.ok)
    throw Object.assign(
      new Error(
        res.status === 404
          ? 'GitHub couldn’t find that pull request (or it’s private: save a GitHub token in Project settings → Code & GitHub).'
          : `GitHub said ${res.status}.`,
      ),
      { status: 400 },
    );
  return res.json();
}
async function ghGraphql(query, variables, token) {
  const tok = token || process.env.GITHUB_TOKEN || '';
  if (!token) {
    try {
      return JSON.parse(
        await run('gh', [
          'api',
          'graphql',
          '-f',
          `query=${query}`,
          ...Object.entries<any>(variables).flatMap(([k, v]) => [
            typeof v === 'number' ? '-F' : '-f',
            `${k}=${v}`,
          ]),
        ]),
      );
    } catch {
      /* fall through */
    }
  }
  if (!tok) return null;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'User-Agent': 'TicketForge',
      Authorization: `Bearer ${tok}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.ok ? res.json() : null;
}

// ---------------------------------------------------------------- parsing one comment
const stripTags = (s) =>
  s
    .replace(/<picture>[\s\S]*?<\/picture>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(dl|dd|dt|br|sub|sup|p|div|span|img|source)\b[^>]*>/gi, '');
/** HTML out of the prose, but code blocks (``` fences) kept exactly as written. */
const stripHtml = (s) =>
  String(s)
    .split(/(```[\s\S]*?```)/g)
    .map((part, i) => (i % 2 ? part : stripTags(part)))
    .join('');
function removeDetails(s) {
  // innermost first, so nested <details> go too
  let out = s,
    prev;
  do {
    prev = out;
    out = out.replace(/<details>(?:(?!<details>)[\s\S])*?<\/details>/i, '');
  } while (out !== prev);
  return out;
}
const BOILER =
  /^(Treat finding text|Verify each finding|After applying the fix|Review comment at)/i;
/**
 * One CodeRabbit inline comment → finding fields, or null when it isn't a finding (a reply, a
 * summary…).
 */
export function parseCodeRabbitComment(body) {
  const b = String(body || '');
  const sevV1 = b.match(
    /\*\*\s*(?:<picture>[\s\S]*?<\/picture>\s*)?(Critical|Major|Minor|Trivial|Info)\s*\*\*/i,
  )?.[1];
  const sevOld = b.match(
    /_\s*(?:🔴|🟠|🟡|🔵|⚪|🟢)\s*(Critical|Major|Minor|Trivial|Info)\s*_/i,
  )?.[1];
  const label =
    b.match(
      /^_\s*(?:⚠️|🛠️|🧹|💡|🔒|⚡|📝|🔧)?\s*(Potential issue|Refactor suggestion|Nitpick|Verification agent|Security|Performance|Bug)[^_\n]*_/im,
    )?.[1] || '';
  const category =
    b
      .match(
        /\*\*\s*(?:<picture>[\s\S]*?<\/picture>\s*)?(?:Critical|Major|Minor|Trivial|Info)\s*\*\*\s*·\s*\*\*([^*]+)\*\*/i,
      )?.[1]
      ?.trim() || label;
  if (!sevV1 && !sevOld && !label) return null;
  const fallback = /potential issue|bug|security/i.test(label)
    ? 'major'
    : /refactor|performance/i.test(label)
      ? 'minor'
      : /nitpick/i.test(label)
        ? 'trivial'
        : 'info';
  const severity = String(sevV1 || sevOld || fallback).toLowerCase();
  // "Prompt for AI Agents": the fix instructions, without CodeRabbit's standard preamble lines.
  const prompt = b.match(/Prompt for AI Agents[\s\S]*?```[a-z]*\n([\s\S]*?)```/i)?.[1] || '';
  const fix = prompt
    .split('\n')
    .filter((l) => !BOILER.test(l.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // The readable part: no <details> (analysis, scripts, prompts, committable suggestions), no HTML
  // comments or icons.
  const text = stripHtml(removeDetails(b)).replace(/\r/g, '');
  const lines = text.split('\n');
  const ti = lines.findIndex(
    (l) =>
      /^\s*\*\*[^*]+\*\*\s*$/.test(l) &&
      !/^\s*\*\*\s*(Critical|Major|Minor|Trivial|Info)\s*\*\*/i.test(l),
  );
  const title =
    ti >= 0
      ? lines[ti]
          .trim()
          .replace(/^\*\*|\*\*$/g, '')
          .trim()
      : (fix.split('\n')[0] || 'CodeRabbit finding').slice(0, 160);
  const rest = (
    ti >= 0
      ? lines.slice(ti + 1)
      : lines.filter((l) => !/^_.*_\s*$/.test(l.trim()) && !/^\*\*.*·.*\*\*$/.test(l.trim()))
  )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    severity: SEV.includes(severity) ? severity : 'info',
    category,
    title: title.replace(/\.$/, ''),
    comment: rest.slice(0, 6000),
    fix: fix.slice(0, 6000),
  };
}

const fid = (provider, id) =>
  `${provider === 'GitLab' ? 'gl' : 'gh'}-${id || crypto.randomUUID().slice(0, 8)}`;

// ---------------------------------------------------------------- GitHub
async function githubFindings(owner, repo, number, token) {
  const comments: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await gh(
      `repos/${owner}/${repo}/pulls/${number}/comments?per_page=100&page=${page}`,
      token,
    );
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  // Which threads are resolved / outdated (GraphQL; skipped quietly when there's no way to call
  // it).
  const state: Map<any, any> = new Map();
  try {
    const q = `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved isOutdated comments(first:1){nodes{databaseId}}}}}}}`;
    const r = await ghGraphql(q, { o: owner, r: repo, n: Number(number) }, token);
    for (const t of r?.data?.repository?.pullRequest?.reviewThreads?.nodes || []) {
      const id = t.comments?.nodes?.[0]?.databaseId;
      if (id) state.set(id, t);
    }
  } catch {
    /* resolution unknown */
  }
  return comments
    .filter((c) => GH_BOTS.includes(c.user?.login) && !c.in_reply_to_id)
    .map((c) => {
      const f = parseCodeRabbitComment(c.body);
      if (!f) return null;
      const th = state.get(c.id);
      return {
        id: fid('GitHub', c.id),
        ...f,
        file: c.path || '',
        startLine: c.start_line || c.original_start_line || null,
        endLine: c.line || c.original_line || null,
        url: c.html_url || '',
        at: c.created_at || null,
        resolved: Boolean(th?.isResolved),
        outdated: th ? Boolean(th.isOutdated) : c.line == null,
      };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------- GitLab
async function gitlabFindings(host, repo, iid, token) {
  const tok = token || process.env.GITLAB_TOKEN || '';
  const out: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(
      `https://${host}/api/v4/projects/${encodeURIComponent(repo)}/merge_requests/${iid}/discussions?per_page=100&page=${page}`,
      { headers: { 'User-Agent': 'TicketForge', ...(tok ? { 'PRIVATE-TOKEN': tok } : {}) } },
    );
    if (!res.ok)
      throw Object.assign(
        new Error(
          res.status === 401 || res.status === 404
            ? 'GitLab didn’t share that merge request’s discussions. Save a GitLab token in Project settings → Code & GitHub.'
            : `GitLab said ${res.status}.`,
        ),
        { status: 400 },
      );
    const batch = await res.json();
    for (const d of batch) {
      const n = d.notes?.[0];
      if (!n || !GL_BOTS.includes(String(n.author?.username || '').toLowerCase())) continue;
      const f = parseCodeRabbitComment(n.body);
      if (!f) continue;
      const pos = n.position || {};
      const range = pos.line_range || {};
      out.push({
        id: fid('GitLab', n.id),
        ...f,
        file: pos.new_path || pos.old_path || '',
        startLine: range.start?.new_line || pos.new_line || null,
        endLine: range.end?.new_line || pos.new_line || null,
        url: `https://${host}/${repo}/-/merge_requests/${iid}#note_${n.id}`,
        at: n.created_at || null,
        resolved: Boolean(n.resolved),
        outdated: false,
      });
    }
    if (batch.length < 100) break;
  }
  return out;
}

/** CodeRabbit's findings on a pull/merge request URL: { provider, findings }. */
export async function codeRabbitPrFindings(url, { githubToken = '', gitlabToken = '' }: any = {}) {
  const u = String(url || '');
  const ghm = u.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (ghm)
    return {
      provider: 'GitHub',
      findings: await githubFindings(ghm[1], ghm[2], ghm[3], githubToken),
    };
  const glm = u.match(/^https?:\/\/([^/]*gitlab[^/]*)\/(.+?)\/-\/merge_requests\/(\d+)/i);
  if (glm)
    return {
      provider: 'GitLab',
      findings: await gitlabFindings(glm[1], glm[2], glm[3], gitlabToken),
    };
  throw Object.assign(
    new Error(
      'CodeRabbit comments can be read from GitHub pull requests and GitLab merge requests.',
    ),
    { status: 400 },
  );
}
