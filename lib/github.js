// Pull-request lookup for the Development panel.
// GitHub: uses the `gh` CLI when it is signed in (works for private repos), otherwise the public API.
// GitLab / Bitbucket / others: parsed from the URL only.
import { execFile } from 'node:child_process';

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});

/** GitHub API JSON: through the signed-in `gh` CLI (private repos, higher limits), else the public API. null on failure. */
async function ghJson(path) {
  try { return JSON.parse(await run('gh', ['api', path])); } catch { /* gh missing or not authorised */ }
  try {
    const res = await fetch(`https://api.github.com/${path}`, { headers: { 'User-Agent': 'TicketForge', Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) } });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
const clipBody = (s) => { const t = String(s || '').trim(); return t.length > 2000 ? `${t.slice(0, 2000)}…` : t; };
const CHECK_STATE = (c) => (c.status && c.status !== 'completed' ? 'pending'
  : ['success', 'neutral', 'skipped'].includes(c.conclusion) ? 'passed' : c.conclusion ? 'failed' : 'pending');
function summarizeChecks(items) {
  const n = (st) => items.filter((x) => x.state === st).length;
  const failed = n('failed'), pending = n('pending'), passed = n('passed');
  return { state: !items.length ? 'none' : failed ? 'failing' : pending ? 'pending' : 'passing', passed, failed, pending, total: items.length, items: items.slice(0, 25) };
}
/** Size, reviews, checks, conflicts and the description of a GitHub pull request (best effort: missing parts are left out). */
async function githubDetails(owner, repo, number, pr) {
  const out = {
    size: { additions: pr.additions ?? null, deletions: pr.deletions ?? null, files: pr.changed_files ?? null, commits: pr.commits ?? null },
    comments: (pr.comments || 0) + (pr.review_comments || 0),
    labels: (pr.labels || []).map((l) => l.name).filter(Boolean).slice(0, 10),
    reviewers: (pr.requested_reviewers || []).map((u) => u.login).filter(Boolean),
    createdAt: pr.created_at || null, mergedAt: pr.merged_at || null, closedAt: pr.closed_at || null,
    conflicts: pr.mergeable === false ? true : pr.mergeable === true ? false : null,
    mergeState: pr.mergeable_state || '',
    body: clipBody(pr.body),
  };
  const reviews = await ghJson(`repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`);
  if (Array.isArray(reviews)) {
    const last = new Map();
    for (const r of reviews) if (r.user?.login && r.state !== 'COMMENTED' && r.state !== 'PENDING') last.set(r.user.login, r.state);
    const users = [...last].map(([login, state]) => ({ login, state: state === 'APPROVED' ? 'approved' : state === 'CHANGES_REQUESTED' ? 'changes' : 'dismissed' }));
    const approved = users.filter((u) => u.state === 'approved').length, changes = users.filter((u) => u.state === 'changes').length;
    out.review = { approved, changes, users, state: changes ? 'changes' : approved ? 'approved' : out.reviewers.length ? 'pending' : 'none' };
  }
  if (pr.state === 'open' && pr.head?.sha) {
    const items = [];
    const runs = await ghJson(`repos/${owner}/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`);
    for (const c of runs?.check_runs || []) items.push({ name: c.name, state: CHECK_STATE(c), url: c.html_url || c.details_url || '' });
    const st = await ghJson(`repos/${owner}/${repo}/commits/${pr.head.sha}/status`);
    for (const c of st?.statuses || []) items.push({ name: c.context, state: c.state === 'success' ? 'passed' : c.state === 'pending' ? 'pending' : 'failed', url: c.target_url || '' });
    if (runs || st) out.checks = summarizeChecks(items);
  }
  return out;
}

function githubStatus(pr) {
  if (pr.merged || pr.merged_at) return 'Merged';
  if (pr.state === 'closed') return 'Declined';
  if (pr.draft) return 'Draft';
  return 'Open';
}

export async function prInfo(rawUrl, { gitlabToken = '' } = {}) {
  const url = String(rawUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('Enter a full pull request URL starting with https://');

  const gh = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (gh) {
    const [, owner, repo, number] = gh;
    const pr = await ghJson(`repos/${owner}/${repo}/pulls/${number}`);
    if (pr) {
      return {
        url, provider: 'GitHub', repo: `${owner}/${repo}`, number: Number(number), title: pr.title,
        status: githubStatus(pr), author: pr.user?.login || '', branch: pr.head?.ref || '', base: pr.base?.ref || '',
        updatedAt: pr.updated_at || null, fetched: true, ...(await githubDetails(owner, repo, number, pr)),
      };
    }
    return { url, provider: 'GitHub', repo: `${owner}/${repo}`, number: Number(number), title: `${repo} #${number}`, status: 'Open', fetched: false };
  }

  const gl = url.match(/^https?:\/\/([^/]*gitlab[^/]*)\/(.+?)\/-\/merge_requests\/(\d+)/i);
  if (gl) {
    const [, host, repo, iid] = gl;
    // GitLab's API: needs a token for private projects (Project settings → Code & GitHub → Backend repository, or GITLAB_TOKEN).
    const tok = gitlabToken || process.env.GITLAB_TOKEN || '';
    try {
      const res = await fetch(`https://${host}/api/v4/projects/${encodeURIComponent(repo)}/merge_requests/${iid}`, { headers: { 'User-Agent': 'TicketForge', ...(tok ? { 'PRIVATE-TOKEN': tok } : {}) } });
      if (res.ok) {
        const mr = await res.json();
        const status = mr.state === 'merged' ? 'Merged' : mr.state === 'closed' ? 'Declined' : mr.draft || mr.work_in_progress ? 'Draft' : 'Open';
        const pipe = mr.head_pipeline?.status || mr.pipeline?.status || '';
        const pstate = !pipe ? null : pipe === 'success' ? 'passed' : ['failed', 'canceled'].includes(pipe) ? 'failed' : pipe === 'skipped' ? 'passed' : 'pending';
        const reviewers = (mr.reviewers || []).map((u) => u.username).filter(Boolean);
        return {
          url, provider: 'GitLab', repo, number: Number(iid), title: mr.title, status, author: mr.author?.username || '', branch: mr.source_branch || '', base: mr.target_branch || '', updatedAt: mr.updated_at || null, fetched: true,
          size: { additions: null, deletions: null, files: mr.changes_count ? Number(String(mr.changes_count).replace(/\D/g, '')) || null : null, commits: null },
          comments: mr.user_notes_count || 0, labels: (mr.labels || []).slice(0, 10), reviewers,
          createdAt: mr.created_at || null, mergedAt: mr.merged_at || null, closedAt: mr.closed_at || null,
          conflicts: typeof mr.has_conflicts === 'boolean' ? mr.has_conflicts : null, mergeState: mr.detailed_merge_status || mr.merge_status || '',
          review: { approved: mr.upvotes || 0, changes: mr.downvotes || 0, users: [], state: mr.downvotes ? 'changes' : mr.upvotes ? 'approved' : reviewers.length ? 'pending' : 'none' },
          ...(pstate && { checks: summarizeChecks([{ name: 'Pipeline', state: pstate, url: mr.head_pipeline?.web_url || '' }]) }),
          body: clipBody(mr.description),
        };
      }
    } catch { /* unreachable: fall back to the URL */ }
    return { url, provider: 'GitLab', repo, number: Number(iid), title: `${repo.split('/').pop()} !${iid}`, status: 'Open', fetched: false };
  }

  const bb = url.match(/bitbucket\.org\/([^/]+\/[^/]+)\/pull-requests\/(\d+)/i);
  if (bb) return { url, provider: 'Bitbucket', repo: bb[1], number: Number(bb[2]), title: `${bb[1].split('/').pop()} #${bb[2]}`, status: 'Open', fetched: false };

  return { url, provider: 'Link', repo: new URL(url).host, number: null, title: url, status: 'Open', fetched: false };
}
