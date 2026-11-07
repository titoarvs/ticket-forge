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

export async function prInfo(rawUrl) {
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

  const gl = url.match(/^https?:\/\/[^/]*gitlab[^/]*\/(.+?)\/-\/merge_requests\/(\d+)/i);
  if (gl) return { url, provider: 'GitLab', repo: gl[1], number: Number(gl[2]), title: `${gl[1].split('/').pop()} !${gl[2]}`, status: 'Open', fetched: false };

  const bb = url.match(/bitbucket\.org\/([^/]+\/[^/]+)\/pull-requests\/(\d+)/i);
  if (bb) return { url, provider: 'Bitbucket', repo: bb[1], number: Number(bb[2]), title: `${bb[1].split('/').pop()} #${bb[2]}`, status: 'Open', fetched: false };

  return { url, provider: 'Link', repo: new URL(url).host, number: null, title: url, status: 'Open', fetched: false };
}
