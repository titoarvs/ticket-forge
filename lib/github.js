// Pull-request lookup for the Development panel.
// GitHub: uses the `gh` CLI when it is signed in (works for private repos), otherwise the public API.
// GitLab / Bitbucket / others: parsed from the URL only.
import { execFile } from 'node:child_process';

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});

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
    let pr = null;
    try { pr = JSON.parse(await run('gh', ['api', `repos/${owner}/${repo}/pulls/${number}`])); } catch { /* gh missing or not authorised */ }
    if (!pr) {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, { headers: { 'User-Agent': 'TicketForge', Accept: 'application/vnd.github+json' } });
      if (res.ok) pr = await res.json();
    }
    if (pr) {
      return {
        url, provider: 'GitHub', repo: `${owner}/${repo}`, number: Number(number), title: pr.title,
        status: githubStatus(pr), author: pr.user?.login || '', branch: pr.head?.ref || '', base: pr.base?.ref || '',
        updatedAt: pr.updated_at || null, fetched: true,
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
        return { url, provider: 'GitLab', repo, number: Number(iid), title: mr.title, status, author: mr.author?.username || '', branch: mr.source_branch || '', base: mr.target_branch || '', updatedAt: mr.updated_at || null, fetched: true };
      }
    } catch { /* unreachable: fall back to the URL */ }
    return { url, provider: 'GitLab', repo, number: Number(iid), title: `${repo.split('/').pop()} !${iid}`, status: 'Open', fetched: false };
  }

  const bb = url.match(/bitbucket\.org\/([^/]+\/[^/]+)\/pull-requests\/(\d+)/i);
  if (bb) return { url, provider: 'Bitbucket', repo: bb[1], number: Number(bb[2]), title: `${bb[1].split('/').pop()} #${bb[2]}`, status: 'Open', fetched: false };

  return { url, provider: 'Link', repo: new URL(url).host, number: null, title: url, status: 'Open', fetched: false };
}
