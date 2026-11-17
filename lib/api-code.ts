// Code jobs through your AI provider and the GitHub API: how "Write code with AI" works from the deployed TicketForge,
// where there is no checkout and no Claude Code. Nothing runs on GitHub Actions and nothing is installed on a server.
//   1. Read the repository's file list on GitHub, and let the AI pick the files that matter for the issue.
//   2. Read those files, then ask the AI (the "Coding agents" model in Administration → AI) for the changes as exact
//      edits ({ find, replace }), new files and deletions, in the agent's own instructions.
//   3. Check every edit against the file (the text to replace must appear exactly once; a failed edit is sent back to
//      the AI once to correct), then commit them to the issue's branch with the GitHub Git Data API.
// The result has the same shape the code window shows for local jobs: summary, changed files and a diff.
import { gh } from './gh-actions';
import { askJson } from './claude';

const err = (message, status = 400) => Object.assign(new Error(message), { status });
const enc = (s) => String(s).split('/').map(encodeURIComponent).join('/');

const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|\.next|out|coverage|vendor|\.venv|venv|__pycache__|\.turbo|\.cache|target)\//;
const SKIP_FILE = /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tgz|woff2?|ttf|eot|otf|mp[34]|mov|webm|lock|map|bin|exe|dll|so|dylib|class|jar|docx?|xlsx?|pptx?|psd|sketch|fig|sqlite3?|db)$|\.min\.(js|css)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/i;
// Paths the agent may not write: git internals, workflows (they could run code with the repository's secrets) and secrets.
const FORBIDDEN = /(^|\/)(\.git\/|\.github\/workflows\/|node_modules\/)|(^|\/)\.env(\.|$)|\.(pem|key|p12|pfx)$/i;
const MAX_TREE_PATHS = 4000, MAX_PICK = 16, MAX_FILE = 60_000, MAX_CONTEXT = 220_000, MAX_CHANGES = 40, MAX_OUT_FILE = 200_000;

const FORMAT = `
HOW YOU WORK HERE: you cannot run commands, tests or a browser. You are given the issue and the repository's most
relevant files, and you answer with the changes as JSON only (no prose outside the JSON, no code fences). Make the
smallest change that fully does the task, in the repository's own style, and include tests when the repository has them.

{
  "summary": "Markdown: what you changed and why, per file, and anything the reviewer must check or run (commands, migrations, new environment variables).",
  "changes": [
    { "path": "src/a.ts", "action": "edit", "edits": [ { "find": "exact text from the file, unique in it", "replace": "new text" } ] },
    { "path": "src/new.ts", "action": "create", "content": "the whole new file" },
    { "path": "src/old.ts", "action": "delete" }
  ]
}
Rules for "edit": every "find" must be copied exactly from the file shown (same spaces and line breaks) and appear exactly
once in it; include enough surrounding lines to make it unique, and keep it short. Several edits in one file are applied in
order. Never touch .github/workflows, .env files or lock files. Use "create" with the whole content for a file that
doesn't exist yet (or to rewrite a small file completely).`;

/** The repository's text files on `ref` (a branch): { commit, tree, files: Map(path → { sha, size, mode }) }. */
async function snapshot({ repo, token, ref }: any) {
  const head = await gh('GET', `repos/${repo}/git/ref/heads/${enc(ref)}`, { token });
  const commit = await gh('GET', `repos/${repo}/git/commits/${head.object.sha}`, { token });
  const t = await gh('GET', `repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`, { token });
  const files: Map<any, any> = new Map();
  for (const n of t.tree || []) {
    if (n.type !== 'blob' || SKIP_DIR.test(`${n.path}`) || SKIP_FILE.test(n.path)) continue;
    files.set(n.path, { sha: n.sha, size: n.size || 0, mode: n.mode || '100644' });
  }
  return { commit: head.object.sha, tree: commit.tree.sha, files, truncated: Boolean(t.truncated) };
}
async function branchExists({ repo, token, branch }: any) {
  try { await gh('GET', `repos/${repo}/git/ref/heads/${enc(branch)}`, { token }); return true; } catch { return false; }
}
async function readFile({ repo, token, sha }: any) {
  const b = await gh('GET', `repos/${repo}/git/blobs/${sha}`, { token });
  return Buffer.from(b.content || '', b.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
}
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

/** Which files to read: the AI picks from the file list (the issue's own task text is the guide). */
async function pickFiles({ snap, task, ai }: any) {
  const paths = [...snap.files.keys()].sort();
  if (paths.length <= 12) return paths;
  const list = paths.slice(0, MAX_TREE_PATHS).join('\n');
  const r = await askJson({ ...ai, task: 'quick', system: 'You choose which files of a repository a developer must read and change for a task. Answer with JSON only.',
    prompt: `TASK:\n${String(task.prompt).slice(0, 7000)}\n\nREPOSITORY FILES:\n${list}\n\nChoose up to ${MAX_PICK} files that the developer needs: the files to change, the ones that define the types, helpers and conventions they must follow, and an existing similar feature or test to copy the style from. Answer {"files":["path", …]} using only paths from the list.` }).catch(() => null);
  const picked = (Array.isArray(r?.files) ? r.files : []).map(String).filter((p) => snap.files.has(p)).slice(0, MAX_PICK);
  for (const p of ['package.json']) if (snap.files.has(p) && !picked.includes(p)) picked.push(p);
  return picked;
}

/** Applies one change to the file's current text (null when it doesn't exist). Returns the new text, or throws with why not. */
function apply(change, before) {
  if (change.action === 'delete') return null;
  if (change.action === 'create') {
    if (typeof change.content !== 'string') throw new Error('“create” needs the file’s content.');
    return change.content;
  }
  if (before == null) throw new Error('the file doesn’t exist (use “create”).');
  let text = before;
  for (const [i, e] of (change.edits || []).entries()) {
    const find = String(e?.find ?? ''), rep = String(e?.replace ?? '');
    if (!find) throw new Error(`edit ${i + 1} has no text to find.`);
    const at = text.indexOf(find);
    if (at < 0) throw new Error(`edit ${i + 1}: the text to find isn’t in the file (${JSON.stringify(find.slice(0, 80))}).`);
    if (text.indexOf(find, at + 1) >= 0) throw new Error(`edit ${i + 1}: the text to find appears more than once (${JSON.stringify(find.slice(0, 80))}); include more surrounding lines.`);
    text = text.slice(0, at) + rep + text.slice(at + find.length);
  }
  return text;
}

/** A unified diff of one file as one hunk around what changed, and how many lines were added and removed. */
export function fileDiff(path, before, after) {
  const lines_ = (t) => { if (t == null) return []; const l = t.split('\n'); if (l[l.length - 1] === '') l.pop(); return l; };
  const a = lines_(before), b = lines_(after);
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const removed = a.slice(s, ea), added = b.slice(s, eb);
  const ctx = 3, from = Math.max(0, s - ctx);
  const pre = a.slice(from, s), post = a.slice(ea, Math.min(a.length, ea + ctx));
  const lines = [...pre.map((l) => ` ${l}`), ...removed.slice(0, 3000).map((l) => `-${l}`), ...added.slice(0, 3000).map((l) => `+${l}`), ...post.map((l) => ` ${l}`)];
  const head = [`diff --git a/${path} b/${path}`, before == null ? 'new file mode 100644' : after == null ? 'deleted file mode 100644' : null,
    `--- ${before == null ? '/dev/null' : `a/${path}`}`, `+++ ${after == null ? '/dev/null' : `b/${path}`}`,
    `@@ -${before == null ? 0 : from + 1},${pre.length + removed.length + post.length} +${after == null ? 0 : from + 1},${pre.length + added.length + post.length} @@`].filter(Boolean);
  return { diff: `${head.join('\n')}\n${lines.join('\n')}\n`, added: added.length, removed: removed.length };
}

/**
 * Does one round of a code job: reads the repository, asks the AI for the changes and commits them to `branch`.
 * `step(text)` reports progress, `alive()` says false once the job was stopped (nothing is committed then).
 * Returns { summary, files: [{ path, added, removed }], diff, sha } (files is empty when the AI changed nothing).
 */
export async function runApiCode({ repo, token, base, branch, task, ai = {}, author, message, step = () => {}, alive = async () => true }: any) {
  const existing = await branchExists({ repo, token, branch });
  step(existing ? `Reading ${repo} on ${branch}…` : `Reading ${repo} on ${base}…`);
  const snap = await snapshot({ repo, token, ref: existing ? branch : base });
  if (!snap.files.size) throw err(`There are no readable files in ${repo} on ${existing ? branch : base}.`);
  const picked = await pickFiles({ snap, task, ai });
  step(`Reading ${picked.length} file${picked.length === 1 ? '' : 's'} the change touches…`);
  if (!(await alive())) return null;
  const texts: Map<any, any> = new Map();
  let total = 0;
  await pool(picked, 6, async (p) => {
    const meta = snap.files.get(p);
    if (!meta || meta.size > MAX_FILE) return;
    const t = await readFile({ repo, token, sha: meta.sha });
    if (t.includes('\u0000')) return;
    texts.set(p, t);
  });
  const shown: any[] = [];
  for (const p of picked) {
    const t = texts.get(p);
    if (t == null || total + t.length > MAX_CONTEXT) continue;
    total += t.length;
    shown.push(`===== FILE: ${p} =====\n${t}\n===== END OF ${p} =====`);
  }
  const fileList = [...snap.files.keys()].sort().slice(0, 1500).join('\n');
  const prompt = `${task.prompt}\n\nREPOSITORY FILE LIST${snap.files.size > 1500 ? ' (first 1500)' : ''}:\n${fileList}\n\nTHE FILES YOU CAN SEE (the rest of the repository exists but isn't shown; create new files rather than guessing at ones you can't see):\n\n${shown.join('\n\n')}\n\nNow answer with the JSON.`;
  const system = `${task.system || ''}\n${FORMAT}`;
  step('Asking the AI to write the change…');
  const first = await askJson({ ...ai, task: 'code', system, prompt });
  if (!(await alive())) return null;

  // Check every change against the file; send failures back once.
  const planned: Map<any, any> = new Map(); // path → { change, before, after }
  const problems: any[] = [];
  const consider = (changes) => {
    for (const c of Array.isArray(changes) ? changes : []) {
      const path = String(c?.path || '').replace(/^\.?\//, '');
      if (!path || path.includes('..') || path.length > 300) { problems.push(`${path || '(no path)'}: not a valid path.`); continue; }
      if (FORBIDDEN.test(path)) { problems.push(`${path}: files like this can’t be changed here.`); continue; }
      const action = c.action === 'edit' || c.action === 'delete' || c.action === 'create' ? c.action : (c.edits ? 'edit' : 'create');
      // A file that exists but wasn't shown can only be replaced completely ("create"), never edited.
      let before = planned.has(path) ? planned.get(path).after : texts.get(path) ?? (snap.files.has(path) ? undefined : null);
      try {
        if (before === undefined && action === 'create') before = null;
        if (before === undefined) throw new Error('the file exists but wasn’t shown, so it can’t be edited (use “create” to replace it completely).');
        const after = apply({ ...c, action }, before);
        if (after != null && after.length > MAX_OUT_FILE) throw new Error('the file would be too large.');
        planned.set(path, { before: planned.has(path) ? planned.get(path).before : before, after });
      } catch (e) { problems.push(`${path}: ${e.message}`); }
    }
  };
  consider(first?.changes);
  let summary = String(first?.summary || '').trim();
  if (problems.length) {
    const failed = problems.splice(0);
    step(`${failed.length} edit${failed.length === 1 ? '' : 's'} didn’t match the files; asking the AI to correct them…`);
    const again = await askJson({ ...ai, task: 'code', system, prompt: `${prompt}\n\nYOUR EARLIER ANSWER had changes that could not be applied:\n${failed.map((f) => `- ${f}`).join('\n')}\n\nAnswer with the JSON again, containing ONLY corrected changes for those files (the other changes were applied). Copy "find" text exactly from the files shown.` });
    consider(again?.changes);
    if (again?.summary && !summary) summary = String(again.summary).trim();
    if (problems.length && !planned.size) throw err(`The AI’s changes couldn’t be applied: ${problems.slice(0, 3).join(' ')}`);
  }
  const todo = [...planned].filter(([p, v]) => v.after !== v.before && !(v.after == null && v.before == null)).slice(0, MAX_CHANGES);
  if (problems.length) summary = `${summary}\n\n**Not applied:** ${problems.slice(0, 5).join(' ')}`.trim();
  if (!todo.length) return { summary: summary || 'The AI found nothing to change.', files: [], diff: '', sha: '' };
  if (!(await alive())) return null;

  // Commit: blobs → tree → commit → branch.
  step(`Committing ${todo.length} file${todo.length === 1 ? '' : 's'} to ${branch}…`);
  const entries = await pool(todo, 5, async ([path, v]) => {
    const mode = snap.files.get(path)?.mode || '100644';
    if (v.after == null) return { path, mode, type: 'blob', sha: null };
    const b = await gh('POST', `repos/${repo}/git/blobs`, { token, body: { content: v.after, encoding: 'utf-8' } });
    return { path, mode, type: 'blob', sha: b.sha };
  });
  const tree = await gh('POST', `repos/${repo}/git/trees`, { token, body: { base_tree: snap.tree, tree: entries } });
  const who = author?.name ? { name: author.name, email: author.email || 'ticketforge@users.noreply.github.com', date: new Date().toISOString() } : undefined;
  const commit = await gh('POST', `repos/${repo}/git/commits`, { token, body: { message, tree: tree.sha, parents: [snap.commit], ...(who ? { author: who } : {}) } });
  if (!(await alive())) return null;
  if (existing) await gh('PATCH', `repos/${repo}/git/refs/heads/${enc(branch)}`, { token, body: { sha: commit.sha } });
  else await gh('POST', `repos/${repo}/git/refs`, { token, body: { ref: `refs/heads/${branch}`, sha: commit.sha } });

  const parts = todo.map(([path, v]) => ({ path, ...fileDiff(path, v.before, v.after) }));
  return {
    summary: summary || `Changed ${todo.length} file${todo.length === 1 ? '' : 's'}.`,
    files: parts.map((x) => ({ path: x.path, added: x.added, removed: x.removed })),
    diff: parts.map((x) => x.diff).join('\n').slice(0, 400000), sha: commit.sha.slice(0, 7),
  };
}

/** Opens the pull request for a pushed branch. */
export async function openCodePr({ repo, token, head, base, title, body, draft }: any) {
  const pr = await gh('POST', `repos/${repo}/pulls`, { token, body: { title, head, base, body, draft: Boolean(draft) } });
  return { number: pr.number, url: pr.html_url, title: pr.title, draft: pr.draft };
}
export async function deleteBranch({ repo, token, branch }: any) {
  await gh('DELETE', `repos/${repo}/git/refs/heads/${enc(branch)}`, { token }).catch(() => {});
}
