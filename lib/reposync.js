// Repository sync for Test automation (local only): reads the project's local repository and
//  1. finds the app's pages from its routes (lib/routes.js), with the source files each page is built from;
//  2. works out which pages changed since the last sync (git diff, including uncommitted work);
//  3. asks the AI which existing test cases those changes affect and rewrites them (two passes: pick, then rewrite);
//  4. reads the git history and asks the AI which features are already built: existing issues to mark Done, and
//     delivered work that has no issue yet (added to the backlog as Done).
// Nothing is saved here: the app shows the result for review and saves what the person applies.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { localReader } from './codebase.js';
import { scanCodebase } from './routes.js';
import { askJson } from './claude.js';
import { getRules, getGuide } from './genrules.js';
import { systemWith } from './prompts.js';

const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };
const git = (cwd, args, timeout = 60000) => new Promise((resolve, reject) => execFile('git', args, { cwd, timeout, maxBuffer: 32 * 1024 * 1024 },
  (e, out, err) => (e ? reject(new Error(String(err || e.message).trim().split('\n')[0])) : resolve(String(out)))));
const FIRST_SYNC_COMMITS = 30;

// ---------------------------------------------------------------- pages and what they're built from
const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
/** The repo files a page uses: its route files and what they import, two levels deep (relative, ~/ and @/ imports). */
async function pageDeps(route, fileSet, read, cache) {
  const seen = new Set(route.files?.length ? route.files : route.file ? [route.file] : []);
  let frontier = [...seen];
  for (let depth = 0; depth < 2 && frontier.length; depth++) {
    const next = [];
    for (const f of frontier) {
      let text = cache.get(f);
      if (text === undefined) { try { text = await read(f); } catch { text = ''; } cache.set(f, text); }
      for (const m of text.matchAll(IMPORT_RE)) {
        const spec = m[1] || m[2] || m[3];
        let base = null;
        if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(f), spec));
        else if (/^[~@]\//.test(spec)) base = `src/${spec.slice(2)}`;
        if (!base) continue;
        const hit = EXTS.map((e) => base + e).find((c) => fileSet.has(c));
        if (hit && !seen.has(hit)) { seen.add(hit); next.push(hit); }
      }
    }
    frontier = next;
  }
  return [...seen];
}

/** Reads the repository: pages, changes since `lastSha`, and recent history. */
export async function readRepo(dir, lastSha) {
  const reader = localReader(dir);
  const root = reader.label;
  await git(root, ['rev-parse', '--is-inside-work-tree']).catch(() => { throw Object.assign(new Error(`${root} isn’t a git repository.`), { status: 400 }); });
  const files = await reader.list();
  const scan = await scanCodebase(files, reader.read);
  const fileSet = new Set(files);
  const cache = new Map();
  const routes = [];
  for (const r of scan.routes) routes.push({ ...r, deps: await pageDeps(r, fileSet, reader.read, cache) });
  // Files most pages use (layout, UI kit…) are "shared": a change there isn't pinned on every page.
  const uses = new Map();
  for (const r of routes) for (const f of r.deps) uses.set(f, (uses.get(f) || 0) + 1);
  const shared = new Set([...uses].filter(([, n]) => routes.length >= 4 && n > routes.length / 2).map(([f]) => f));

  const head = (await git(root, ['rev-parse', 'HEAD'])).trim();
  const branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  let base = lastSha && (await git(root, ['cat-file', '-e', `${lastSha}^{commit}`]).then(() => lastSha, () => null));
  let baseNote = base ? `since the last sync (${base.slice(0, 7)})` : '';
  if (!base) {
    base = (await git(root, ['rev-list', '--max-count=1', `--skip=${FIRST_SYNC_COMMITS}`, 'HEAD']).catch(() => '')).trim()
      || (await git(root, ['rev-list', '--max-parents=0', 'HEAD'])).trim().split('\n')[0];
    baseNote = lastSha ? `the last synced commit is gone (rebased?), so: the last ${FIRST_SYNC_COMMITS} commits` : `first sync: the last ${FIRST_SYNC_COMMITS} commits`;
  }
  // Committed since base + uncommitted edits + new untracked files.
  const changed = new Set([
    ...(await git(root, ['diff', '--name-only', base])).split('\n'),
    ...(await git(root, ['ls-files', '--others', '--exclude-standard'])).split('\n'),
  ].map((f) => f.trim()).filter(Boolean));
  const uncommitted = (await git(root, ['status', '--porcelain'])).split('\n').filter(Boolean).length;

  const pages = [];
  for (const r of routes) {
    const own = r.deps.filter((f) => changed.has(f) && !shared.has(f));
    let diff = '';
    if (own.length) diff = clip(await git(root, ['diff', '--unified=2', base, '--', ...own.slice(0, 12)]).catch(() => ''), 5000);
    pages.push({ path: r.path, name: r.name, file: r.file, framework: r.framework, params: r.params, deps: r.deps.length, depFiles: r.deps.filter((f) => !shared.has(f)), changedFiles: own, diff });
  }
  const sharedChanged = [...changed].filter((f) => shared.has(f));
  const log = (await git(root, ['log', '-n', '400', '--date=short', '--format=%h%x09%ad%x09%an%x09%s%x09%b%x1e']))
    .split('\x1e').map((x) => x.trim()).filter(Boolean)
    .map((x) => { const [sha, date, author, subject, body] = x.split('\t'); return { sha, date, author, subject, body: clip(String(body || '').split('\n').find((l) => l.trim()) || '', 160) }; });
  return { root, head, branch, base, baseNote, frameworks: scan.frameworks, pages, changedFiles: [...changed].length, sharedChanged, uncommitted, log };
}

// ---------------------------------------------------------------- AI: test cases the changes affect
const tcRef = (t, i) => t.testCases[i].key || `${t.key}#${i + 1}`;
/** @param {{ project: any, repo: any, ai?: any, emit?: (message: string) => void }} o */
export async function testCaseUpdates({ project, repo, ai = {}, emit = (_m) => {} }) {
  const changedPages = repo.pages.filter((p) => p.changedFiles.length);
  const tickets = project.tickets.filter((t) => t.testCases?.length);
  if (!changedPages.length || !tickets.length) return { updates: [], additions: [] };
  const rules = await getRules();
  const system = systemWith(rules, ['tests'], await getGuide());
  const changes = changedPages.map((p) => `### Page "${p.name}" (${p.path})\nChanged files: ${p.changedFiles.join(', ')}\n${p.diff ? `Diff:\n${p.diff}` : ''}`).join('\n\n');
  // Pass 1: which test cases do these changes touch? (titles only, so all 300+ fit)
  emit('AI is checking which test cases the code changes affect…');
  const catalog = tickets.map((t) => `${t.key} ${t.title}\n${t.testCases.map((c, i) => `  [${tcRef(t, i)}] ${clip(c.title, 140)}`).join('\n')}`).join('\n');
  const pick = await askJson({ ...ai, reasoning: 'balanced', system,
    prompt: `The web app's code changed on these pages:\n\n${clip(changes, 40000)}\n\nThese are the project's issues and their test cases:\n${clip(catalog, 60000)}

Which test cases are now out of date because of these changes (different screens, fields, labels, steps, rules or results)?
Also: which issues need a NEW test case for behaviour the change added that no test covers?
Only pick ones the changes really affect. Return JSON: { "affected": ["TC-…"], "needsNew": ["PR-…"] }` });
  const affected = new Set((pick.affected || []).map(String));
  const needsNew = new Set((pick.needsNew || []).map(String));
  const hits = tickets.map((t) => ({ t, idx: t.testCases.map((_, i) => i).filter((i) => affected.has(tcRef(t, i))) })).filter((x) => x.idx.length || needsNew.has(x.t.key));
  if (!hits.length) return { updates: [], additions: [] };
  // Pass 2: rewrite those, with their full steps.
  emit(`AI is updating ${affected.size} test case${affected.size === 1 ? '' : 's'}${needsNew.size ? ` and adding new ones for ${needsNew.size} issue${needsNew.size === 1 ? '' : 's'}` : ''}…`);
  const detail = hits.slice(0, 25).map(({ t, idx }) => `## ${t.key} ${t.title}
Acceptance criteria: ${(t.acceptanceCriteria || []).map((a, i) => `AC${i + 1} ${clip(a, 200)}`).join(' | ')}
${idx.map((i) => { const c = t.testCases[i]; return `[${tcRef(t, i)}] ${c.title}\n  Preconditions: ${clip(c.preconditions, 200)}\n  Steps: ${(Array.isArray(c.steps) ? c.steps : [c.steps]).map((s, n) => `${n + 1}. ${clip(s, 160)}`).join(' ')}\n  Expected: ${clip(c.expected, 300)}`; }).join('\n')}${needsNew.has(t.key) ? '\n(needs a new test case)' : ''}`).join('\n\n');
  const res = await askJson({ ...ai, reasoning: rules.reasoning, system,
    prompt: `The web app's code changed:\n\n${clip(changes, 40000)}\n\nUpdate these test cases so they match the app as it is now, and add the new test cases noted:\n\n${clip(detail, 50000)}

Rules: keep each test case's intent and the acceptance criterion it proves. Change only what the code change requires.
Steps are short imperative sentences using the screen's real labels from the diff. Say in "why" what changed in the app.
Return JSON: { "updates": [ { "ref": "TC-…", "title": "…", "preconditions": "…", "steps": ["…"], "expected": "…", "why": "…" } ],
"additions": [ { "ticketKey": "PR-…", "title": "…", "type": "Functional|Negative|Edge|UI", "priority": "High|Medium|Low", "preconditions": "…", "steps": ["…"], "expected": "…", "why": "…" } ] }` });
  const byRef = new Map(tickets.flatMap((t) => t.testCases.map((c, i) => [tcRef(t, i), { t, c }])));
  const updates = (res.updates || []).map((u) => { const hit = byRef.get(String(u.ref)); return hit && {
    ticketId: hit.t.id, ticketKey: hit.t.key, tcId: hit.c.id, ref: String(u.ref), why: clip(u.why, 300),
    before: { title: hit.c.title, preconditions: hit.c.preconditions || '', steps: hit.c.steps || [], expected: hit.c.expected || '' },
    after: { title: clip(u.title || hit.c.title, 300), preconditions: clip(u.preconditions ?? hit.c.preconditions ?? '', 600), steps: (Array.isArray(u.steps) ? u.steps : []).map((s) => clip(s, 300)).slice(0, 20), expected: clip(u.expected || hit.c.expected, 800) },
  }; }).filter((u) => u && u.after.steps.length);
  const keyed = new Map(tickets.map((t) => [t.key, t]));
  const additions = (res.additions || []).map((a) => { const t = keyed.get(String(a.ticketKey)); return t && {
    ticketId: t.id, ticketKey: t.key, why: clip(a.why, 300),
    tc: { title: clip(a.title, 300), type: ['Functional', 'Negative', 'Edge', 'UI'].includes(a.type) ? a.type : 'Functional', priority: ['High', 'Medium', 'Low'].includes(a.priority) ? a.priority : 'Medium',
      preconditions: clip(a.preconditions || '', 600), steps: (Array.isArray(a.steps) ? a.steps : []).map((s) => clip(s, 300)).slice(0, 20), expected: clip(a.expected || '', 800) },
  }; }).filter((a) => a && a.tc.title && a.tc.steps.length);
  return { updates, additions };
}

// ---------------------------------------------------------------- AI: features already built
/** @param {{ project: any, repo: any, ai?: any, emit?: (message: string) => void }} o */
export async function builtFeatures({ project, repo, ai = {}, emit = (_m) => {} }) {
  emit('AI is matching the git history and pages with the backlog…');
  const doneNames = new Set((project.workflow || []).filter((w) => w.category === 'done').map((w) => w.name));
  const rules = await getRules();
  const history = repo.log.map((c) => `${c.sha} ${c.date} ${c.subject}${c.body && c.body !== c.subject ? ` — ${c.body}` : ''}`).join('\n');
  const backlog = project.tickets.filter((t) => !t.parentId).map((t) => `${t.key} [${t.status}] ${t.title}`).join('\n');
  const epics = project.epics.map((e) => `${e.key} ${e.title}`).join('\n');
  const res = await askJson({ ...ai, reasoning: rules.reasoning, system: systemWith(rules, ['tickets'], await getGuide()),
    prompt: `You are reconciling a backlog with the code that already exists.

THE APP'S PAGES (from the code on branch ${repo.branch}):
${repo.pages.map((p) => `- ${p.path} (${p.name})`).join('\n')}

GIT HISTORY (newest first; merged pull requests and feature commits show what was delivered):
${clip(history, 45000)}

THE BACKLOG (key [status] title):
${clip(backlog, 25000)}

EPICS:
${epics}

1. "done": backlog issues that are NOT in a done status but the history clearly shows were delivered (the commit or PR names
   the issue key, or clearly implements exactly that issue). Give the commit(s) as evidence. Be strict: unsure → leave it out.
2. "newIssues": features that were clearly delivered (merged PRs, "feat:" commits, pages that exist) but have NO issue in the
   backlog. One issue per user-facing feature, not per commit; skip chores, refactors, styling-only, CI and dependency updates.
   Each gets a user story, a short description of what exists, 2–5 acceptance criteria describing the delivered behaviour,
   the epic key it fits (or null), the pages it lives on, and the commits as evidence.
Return JSON: { "done": [ { "key": "PR-…", "evidence": "a1b2c3d PR-31: …" } ],
"newIssues": [ { "title": "…", "type": "Story|Task", "epicKey": "PR-E3" | null, "userStory": "As a … I want … so that …", "description": "…",
"acceptanceCriteria": ["…"], "pages": ["/path"], "evidence": "commits…" } ] }` });
  const byKey = new Map(project.tickets.map((t) => [t.key, t]));
  const epicByKey = new Map(project.epics.map((e) => [e.key, e]));
  const done = (res.done || []).map((d) => { const t = byKey.get(String(d.key)); return t && !doneNames.has(t.status) && { ticketId: t.id, key: t.key, title: t.title, status: t.status, evidence: clip(d.evidence, 400) }; }).filter(Boolean);
  const newIssues = (res.newIssues || []).filter((n) => n?.title).slice(0, 40).map((n) => ({
    title: clip(n.title, 200), type: n.type === 'Task' ? 'Task' : 'Story', epicId: epicByKey.get(String(n.epicKey))?.id || null, epicKey: epicByKey.has(String(n.epicKey)) ? String(n.epicKey) : null,
    userStory: clip(n.userStory, 600), description: clip(n.description, 2000), acceptanceCriteria: (Array.isArray(n.acceptanceCriteria) ? n.acceptanceCriteria : []).map((a) => clip(a, 400)).slice(0, 8),
    pages: (Array.isArray(n.pages) ? n.pages : []).map(String).slice(0, 6), evidence: clip(n.evidence, 600),
  }));
  return { done, newIssues };
}

// ---------------------------------------------------------------- AI: test cases for the pages as built
const TC_TYPES = ['Functional', 'Negative', 'Edge', 'UI', 'Integration', 'Security', 'Performance', 'Accessibility'];
/** A page's own code for the prompt: its route file first, then the components it uses (not the shared UI kit). */
async function pageCode(root, page, budget = 48000) {
  const fs = await import('node:fs/promises');
  const files = [page.file, ...page.depFiles.filter((f) => f !== page.file)]
    .filter(Boolean).filter((f) => !/(^|\/)(components\/ui|ui)\/|\.(css|scss|svg|json|md)$|(^|\/)(utils?|cn)\.[tj]sx?$/.test(f))
    .sort((a, b) => (a === page.file ? -1 : b === page.file ? 1 : (/components|features|views|pages|screens/.test(b) ? 1 : 0) - (/components|features|views|pages|screens/.test(a) ? 1 : 0)));
  let out = '', used = [];
  for (const f of files) {
    if (out.length >= budget) break;
    let text = '';
    try { text = await fs.readFile(path.join(root, f), 'utf8'); } catch { continue; }
    out += `\n// ===== ${f}\n${clip(text, Math.min(16000, budget - out.length))}\n`;
    used.push(f);
  }
  return { code: out, files: used };
}

/**
 * Test cases for the app's existing pages, written from their code: for each page, the backlog issue it implements
 * (or a new issue, Done, for delivered work with none) and its test cases. Returns { pages: [...] } for review.
 */
export async function pageTestCases({ project, dir, only = null, ai = {}, emit = (_m) => {} }) {
  const repo = await readRepo(dir, project.automation?.repoSync?.sha || null);
  const pages = repo.pages.filter((p) => !only?.length || only.includes(p.path));
  const rules = await getRules();
  const system = systemWith(rules, ['tickets', 'tests'], await getGuide());
  const backlog = project.tickets.filter((t) => !t.parentId).map((t) => `${t.key} [${t.status}] ${t.title}${t.epicId ? ` (epic ${project.epics.find((e) => e.id === t.epicId)?.key || ''})` : ''}`).join('\n');
  const epics = project.epics.map((e) => `${e.key} ${e.title}`).join('\n');
  const roles = (project.automation?.app?.roles || []).map((r) => r.name).filter(Boolean);
  const byKey = new Map(project.tickets.map((t) => [t.key, t]));
  const epicByKey = new Map(project.epics.map((e) => [e.key, e]));
  const results = [];
  let done = 0;
  const queue = [...pages];
  const worker = async () => {
    while (queue.length) {
      if (ai.signal?.aborted) return;
      const pg = queue.shift();
      const { code, files } = await pageCode(repo.root, pg);
      emit(`Reading ${pg.path} (${files.length} file${files.length === 1 ? '' : 's'}) and writing its test cases… ${done}/${pages.length}`);
      try {
        const res = await askJson({ ...ai, reasoning: rules.reasoning, system, prompt: `Write the test cases for this EXISTING page of the web app "${project.name}", from its code as it is now.

PAGE: ${pg.name} — ${pg.path}${pg.params?.length ? ` (dynamic: ${pg.params.join(', ')})` : ''}
USER ROLES in the test setup: ${roles.join(', ') || 'none set up yet'}

ITS CODE (route file first, then the components it uses):
${code}

THE BACKLOG (key [status] title):
${clip(backlog, 20000)}

EPICS:
${epics}

1. "ticketKey": the backlog issue this page implements best (exact key), or null when none fits.
   When null, give "newIssue": the delivered feature as an issue (title, epicKey or null, userStory, 2–5 acceptanceCriteria).
2. "testCases": 3–10 test cases that prove the page works as built. Cover the main flow, validation and error messages,
   empty and loading states, permissions or role differences, and edge cases the code handles. Use the page's REAL labels,
   button texts, field names, messages and routes from the code. Never invent behaviour the code doesn't have.
   Skip pages that only redirect, and placeholder pages that show only a heading or "coming soon" (return an empty list,
   ticketKey null, newIssue null, and say why in "note"): their issue's tests must test the real feature once it's built.
Return JSON: { "ticketKey": "PR-…" | null, "newIssue": { "title": "…", "epicKey": "PR-E…" | null, "userStory": "…", "acceptanceCriteria": ["…"] } | null,
"note": "…", "testCases": [ { "title": "…", "type": "${TC_TYPES.slice(0, 6).join('|')}", "priority": "High|Medium|Low", "preconditions": "…",
"steps": ["…"], "expected": "…"${roles.length ? ', "runAs": "<role>"' : ''} } ] }` });
        const t = res.ticketKey ? byKey.get(String(res.ticketKey)) : null;
        const ni = !t && res.newIssue?.title ? { title: clip(res.newIssue.title, 200), epicId: epicByKey.get(String(res.newIssue.epicKey))?.id || null, epicKey: epicByKey.has(String(res.newIssue.epicKey)) ? String(res.newIssue.epicKey) : null,
          userStory: clip(res.newIssue.userStory, 600), acceptanceCriteria: (Array.isArray(res.newIssue.acceptanceCriteria) ? res.newIssue.acceptanceCriteria : []).map((a) => clip(a, 400)).slice(0, 8) } : null;
        const have = new Set((t?.testCases || []).map((c) => String(c.title).trim().toLowerCase()));
        const tcs = (Array.isArray(res.testCases) ? res.testCases : []).filter((c) => c?.title && Array.isArray(c.steps) && c.steps.length)
          .filter((c) => !have.has(String(c.title).trim().toLowerCase())).slice(0, 12).map((c) => ({
            title: clip(c.title, 300), type: TC_TYPES.includes(c.type) ? c.type : 'Functional', priority: ['High', 'Medium', 'Low'].includes(c.priority) ? c.priority : 'Medium',
            preconditions: clip(c.preconditions || '', 600), steps: c.steps.map((x) => clip(x, 300)).slice(0, 15), expected: clip(c.expected || '', 800),
            ...(roles.includes(c.runAs) ? { runAsName: c.runAs } : {}),
          }));
        results.push({ path: pg.path, name: pg.name, files, note: clip(res.note || '', 300), ticketId: t?.id || null, ticketKey: t?.key || null, ticketTitle: t?.title || null, newIssue: ni, testCases: tcs });
      } catch (e) {
        if (ai.signal?.aborted) return;
        results.push({ path: pg.path, name: pg.name, files, error: clip(e.message, 300), testCases: [] });
      }
      done++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pages.length) }, worker));
  results.sort((a, b) => a.path.localeCompare(b.path));
  return { repo: { branch: repo.branch, head: repo.head, root: repo.root }, pages: results };
}
