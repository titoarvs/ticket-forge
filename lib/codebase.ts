// Reads a web app's code for route scanning: a folder on this computer, or a GitHub repository.
// Only file names and the few router files needed are read; nothing is stored or sent anywhere else.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { skipPath } from './routes';
import { isSaas } from './platform';

const MAX_FILES = 30000;
const MAX_BYTES = 1024 * 1024;
const fail = (msg) => Object.assign(new Error(msg), { status: 400 });

/** A folder on the machine running TicketForge. */
export function localReader(dir) {
  const root = path.resolve(String(dir || '').replace(/^~(?=\/|$)/, process.env.HOME || '~'));
  let real;
  try { real = fs.realpathSync(root); } catch { throw fail(`Folder not found: ${root}`); }
  if (!fs.statSync(real).isDirectory()) throw fail(`That’s a file, not a folder: ${root}`);
  return {
    label: real,
    async list() {
      const out: any[] = [];
      const walk = (rel, depth) => {
        if (out.length >= MAX_FILES || depth > 14) return;
        let entries;
        try { entries = fs.readdirSync(path.join(real, rel), { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (skipPath(r) || e.isSymbolicLink()) continue;
          if (e.isDirectory()) walk(r, depth + 1);
          else if (e.isFile()) out.push(r);
          if (out.length >= MAX_FILES) return;
        }
      };
      walk('', 0);
      return out;
    },
    async read(rel) {
      const full = path.resolve(real, rel);
      if (!full.startsWith(`${real}${path.sep}`)) throw fail('Outside the folder');
      if (fs.statSync(full).size > MAX_BYTES) throw fail('File too large');
      return fs.readFileSync(full, 'utf8');
    },
  };
}

/** "owner/repo", "https://github.com/owner/repo" or ".../tree/<branch>/<subfolder>". */
export function parseRepo(spec) {
  const s = String(spec || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
  let m = s.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)(?:\/tree\/([^/]+)(?:\/(.+))?)?/i);
  if (m) return { owner: m[1], repo: m[2], branch: m[3] || '', sub: m[4] || '' };
  m = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (m) return { owner: m[1], repo: m[2], branch: '', sub: '' };
  throw fail('Enter the repository as owner/name or its GitHub URL.');
}

const gh: any = (args) => new Promise((resolve, reject) => {
  execFile('gh', args, { timeout: 30000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});

/** A GitHub repository. Auth: the project's token, GITHUB_TOKEN, the signed-in `gh` CLI, or public access. */
export async function githubReader(spec, { branch: wantBranch, token }: any = {}) {
  const { owner, repo, branch: urlBranch, sub } = parseRepo(spec);
  const tok = token || process.env.GITHUB_TOKEN || '';
  let useGh = !tok && !isSaas(); // never the server's own gh sign-in on the hosted service
  const api = async (p) => {
    if (useGh) {
      try { return JSON.parse(await gh(['api', p])); } catch (e) { useGh = false; if (/HTTP 404/.test(String(e.stderr || e.message))) throw fail(`GitHub couldn’t find ${owner}/${repo} (or this account can’t see it).`); }
    }
    const res = await fetch(`https://api.github.com/${p}`, {
      headers: { 'User-Agent': 'TicketForge', Accept: 'application/vnd.github+json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 404) throw fail(`GitHub couldn’t find ${owner}/${repo}. If it’s private, add a GitHub token for this project (or sign in with the gh CLI).`);
    if (res.status === 401) throw fail('GitHub rejected the token. Check it, or remove it to use public access.');
    if (res.status === 403 || res.status === 429) throw fail('GitHub’s rate limit was reached. Add a GitHub token for this project, or try again later.');
    if (!res.ok) throw fail(`GitHub error ${res.status}.`);
    return res.json();
  };
  const branch = wantBranch || urlBranch || (await api(`repos/${owner}/${repo}`)).default_branch;
  const tree = await api(`repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const prefix = sub ? `${sub.replace(/\/+$/, '')}/` : '';
  const files = (tree.tree || []).filter((e) => e.type === 'blob' && e.path.startsWith(prefix)).map((e) => e.path.slice(prefix.length)).slice(0, MAX_FILES);
  return {
    label: `${owner}/${repo}@${branch}${sub ? `/${sub}` : ''}`,
    truncated: Boolean(tree.truncated),
    async list() { return files; },
    async read(rel) {
      const j = await api(`repos/${owner}/${repo}/contents/${encodeURIComponent(prefix + rel).replace(/%2F/g, '/')}?ref=${encodeURIComponent(branch)}`);
      if (j.size > MAX_BYTES) throw fail('File too large');
      return Buffer.from(j.content || '', 'base64').toString('utf8');
    },
  };
}
