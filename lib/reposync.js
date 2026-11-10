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
  const log = (await git(root, ['log', '-n', '800', '--date=short', '--format=%h%x09%ad%x09%an%x09%s%x09%b%x1e']))
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
  const doneNames = new Set(project.workflow?.length ? project.workflow.filter((w) => w.category === 'done').map((w) => w.name) : ['Done']); // no saved workflow: the default one
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

// ---------------------------------------------------------------- AI: map of what's built, by epic (pages + .md docs + history)
const MD_SKIP = /(^|\/)(test-results|playwright-report|coverage|node_modules|dist|build|\.[^/]+)\//i;
const MD_NOT_FEATURES = /(^|\/)(CLAUDE|AGENTS|CONTRIBUTING|CODE_OF_CONDUCT|LICENSE|SECURITY)\.md$|template/i;
/** The repository's Markdown documents that describe the product (feature notes, change records, release notes, READMEs). */
async function featureDocs(root, files, budget = 70000) {
  const fs = await import('node:fs/promises');
  const docs = files.filter((f) => /\.mdx?$/i.test(f) && !MD_SKIP.test(f) && !MD_NOT_FEATURES.test(f))
    // Feature folders first ("done" before "todo"), then release notes / changelogs, then the rest.
    .sort((a, b) => {
      const rank = (f) => (/features?\/|change-?records?|adr|decisions?/i.test(f) ? (/(^|\/)(done|shipped|released)\//i.test(f) ? 0 : 1) : /release|changelog/i.test(f) ? 2 : /readme/i.test(f) ? 3 : 4);
      return rank(a) - rank(b) || a.localeCompare(b);
    });
  const out = [];
  let used = 0;
  for (const f of docs) {
    if (used >= budget) { out.push({ file: f, text: '(not read: too many documents)', skipped: true }); continue; }
    let text = '';
    try { text = await fs.readFile(path.join(root, f), 'utf8'); } catch { continue; }
    const t = clip(text.replace(/\n{3,}/g, '\n\n'), Math.min(4000, budget - used));
    used += t.length;
    out.push({ file: f, text: t });
  }
  return out;
}

/**
 * Everything already built, organized by epic: reads every page (route + its main files), the Markdown documents and the
 * git history; pass 1 outlines epics and features, pass 2 writes each epic's features as issues. Existing epics and
 * issues are reused (matched), the rest proposed. Returns { epics: [...] } for review; nothing is saved here.
 */
export async function builtFeatureMap({ project, dir, ai = {}, emit = (_m) => {} }) {
  const repo = await readRepo(dir, project.automation?.repoSync?.sha || null);
  const reader = localReader(dir);
  const files = await reader.list();
  emit(`Reading ${repo.pages.length} pages, the Markdown documents and ${repo.log.length} commits…`);
  const docs = await featureDocs(repo.root, files);
  const rules = await getRules();
  const system = systemWith(rules, ['tickets'], await getGuide());
  const pagesText = repo.pages.map((p) => `- ${p.path} (${p.name}) — ${[p.file, ...(p.depFiles || []).filter((f) => f !== p.file && /components|features|views|pages|screens|modules/.test(f)).slice(0, 4)].filter(Boolean).join(', ')}`).join('\n');
  const docsText = docs.map((d) => `### ${d.file}\n${d.text}`).join('\n\n');
  const history = repo.log.filter((c) => !/^merge branch|^wip\b|^chore|bump|^format/i.test(c.subject)).map((c) => `${c.sha} ${c.date} ${c.subject}${c.body && c.body !== c.subject ? ` — ${c.body}` : ''}`).join('\n');
  const backlog = project.tickets.filter((t) => !t.parentId).map((t) => `${t.key} [${t.status}]${t.epicId ? ` (${project.epics.find((e) => e.id === t.epicId)?.key || ''})` : ''} ${t.title}`).join('\n');
  const epicsText = project.epics.map((e) => `${e.key} ${e.title}${e.description ? ` — ${clip(e.description, 160)}` : ''}`).join('\n');

  // Pass 1: the outline.
  emit('AI is grouping what’s built into epics and features…');
  const outline = await askJson({ ...ai, reasoning: rules.reasoning, system, prompt: `Map everything this app ALREADY does, from its code and documents.

APP: ${project.name} — repository ${repo.root} (branch ${repo.branch})

PAGES (route — files):
${clip(pagesText, 20000)}

MARKDOWN DOCUMENTS (feature notes, change records, release notes; folder names often name the area and whether it's done):
${clip(docsText, 70000)}

GIT HISTORY (newest first):
${clip(history, 25000)}

EXISTING EPICS:
${epicsText || '(none)'}

EXISTING BACKLOG (key [status] (epic) title):
${clip(backlog, 15000) || '(empty)'}

Group the delivered functionality into EPICS and, inside each, FEATURES. Rules for epics:
- Epics are BROAD product areas (e.g. "Access & Security", "People & Employment", "Leave & Time Off", "Compensation",
  "Performance Reviews", "Platform & Settings"), usually 4–10 for a whole app. An epic holds at least 3 features.
- Never make an epic for a single feature, a single fix or a single page: put it in the closest broad area.
FEATURES are user-facing capabilities (they will be split into small tickets later). Rules:
- Reuse an existing epic when it fits (give its key); otherwise propose a new epic with a short title and one-sentence description.
- A feature already in the backlog: give its key in "existingKey" (it will be marked done if it isn't). Don't duplicate it.
- Only what is really built (pages exist, docs say done/shipped, release notes or merged work). Skip plans, TODOs and ideas.
- Skip chores, refactors and pure styling. Security fixes and hardening count when they change behaviour.
- "sources": the pages, document files and commit shas that prove it.
Return JSON: { "epics": [ { "existingKey": "T2-E1" | null, "title": "…", "description": "…", "features": [ { "title": "…", "existingKey": "T2-12" | null, "pages": ["/path"], "sources": ["docs/…md", "a1b2c3d"] } ] } ] }` });
  const epicByKey = new Map(project.epics.map((e) => [e.key, e]));
  const ticketByKey = new Map(project.tickets.map((t) => [t.key, t]));
  const doneNames = new Set(project.workflow?.length ? project.workflow.filter((w) => w.category === 'done').map((w) => w.name) : ['Done']); // no saved workflow: the default one
  let epics = (outline.epics || []).filter((e) => e?.title && Array.isArray(e.features) && e.features.length).slice(0, 25);
  // Small epics (one or two features) fold into the closest broad area, so the backlog isn't a long list of tiny epics.
  const tiny = epics.filter((e) => e.features.length < 2);
  if (tiny.length && epics.length > 3) {
    emit(`Folding ${tiny.length} small epic${tiny.length > 1 ? 's' : ''} into broader ones…`);
    try {
      const fold = await askJson({ ...ai, reasoning: 'fast', system, prompt: `These epics are too small to stand alone. For each, pick the best broader epic to move its features into.

SMALL EPICS:
${tiny.map((e) => `- "${e.title}": ${e.features.map((f) => f.title).join('; ')}`).join('\n')}

BROADER EPICS (choose one of these titles exactly):
${epics.filter((e) => !tiny.includes(e)).map((e) => `- "${e.title}"${e.description ? `: ${clip(e.description, 140)}` : ''}`).join('\n')}

Return JSON: { "moves": [ { "from": "small epic title", "to": "broader epic title" } ] }` });
      const byTitle = new Map(epics.map((e) => [e.title, e]));
      for (const m of fold.moves || []) {
        const from = byTitle.get(String(m.from)), to = byTitle.get(String(m.to));
        if (from && to && from !== to && tiny.includes(from)) { to.features.push(...from.features); from.features = []; }
      }
      epics = epics.filter((e) => e.features.length);
    } catch { /* keep them as they are */ }
  }

  // Pass 2: small tickets, per epic (in parallel), from the documents and pages behind each feature.
  const scale = rules.tickets?.pointScale?.length ? rules.tickets.pointScale : [1, 2, 3, 5, 8, 13];
  const maxPts = Math.min(5, rules.tickets?.maxPoints || 5);
  const small = scale.filter((x) => x <= Math.min(3, maxPts));
  const acRange = rules.tickets?.acMin ? `${rules.tickets.acMin}–${rules.tickets.acMax || rules.tickets.acMin}` : '2–4';
  const acMax = rules.tickets?.acMax || 5;
  let done = 0;
  const detailed = new Array(epics.length);
  const queue = epics.map((e, i) => ({ e, i }));
  const docByFile = new Map(docs.map((d) => [d.file, d.text]));
  const worker = async () => {
    while (queue.length) {
      if (ai.signal?.aborted) return;
      const { e, i } = queue.shift();
      emit(`Writing the features of “${e.title}”… ${done}/${epics.length}`);
      const feats = e.features.slice(0, 30);
      const evidence = [...new Set(feats.flatMap((f) => f.sources || []))].filter((s) => docByFile.has(s)).map((s) => `### ${s}\n${docByFile.get(s)}`).join('\n\n');
      let res = {};
      try {
        res = await askJson({ ...ai, reasoning: rules.reasoning, system, prompt: `Write these ALREADY DELIVERED features of "${project.name}" as SMALL backlog tickets (they will be marked done).

EPIC: ${e.title}${e.description ? ` — ${e.description}` : ''}

FEATURES:
${feats.map((f, n) => `${n + 1}. ${f.title}${f.existingKey ? ` (existing issue ${f.existingKey}: keep it as ONE ticket, don't split)` : ''} — pages: ${(f.pages || []).join(', ') || 'n/a'}; sources: ${(f.sources || []).join(', ') || 'n/a'}`).join('\n')}

DOCUMENTS BEHIND THEM:
${clip(evidence, 30000) || '(none: use the page names and commits)'}

Split each feature into small tickets: one independently testable behaviour each (e.g. "Create an evaluation template",
"Assign a template to a team", "Archive a template"), ${small.join(', ')} story points (${maxPts} at most). A feature that is
already that small stays one ticket. Don't make tickets for trivia (a label, one field) — fold those into the ticket they belong to.
Each ticket: a user story, a short description of what exists now, ${acRange} acceptance criteria for the delivered behaviour.
Use the documents' facts; never invent behaviour.
Return JSON: { "tickets": [ { "feature": 1, "title": "…", "type": "Story|Task|Bug", "storyPoints": 2, "userStory": "…", "description": "…", "acceptanceCriteria": ["…"] } ] }` });
      } catch (err) { res = { error: err.message }; }
      const byIndex = new Map((res.features || []).map((f) => [Number(f.index), f]));
      const ex = e.existingKey && epicByKey.get(String(e.existingKey));
      detailed[i] = {
        epicId: ex?.id || null, epicKey: ex?.key || null, title: ex ? ex.title : clip(e.title, 120), description: clip(e.description || '', 400), isNew: !ex, error: res.error || null,
        // One entry per small ticket; `group` is the feature it came from. Existing issues stay one ticket each.
        features: feats.flatMap((f, n) => {
          const t = f.existingKey ? ticketByKey.get(String(f.existingKey)) : null;
          const base = { group: clip(f.title, 200), pages: (f.pages || []).map(String).slice(0, 8), sources: (f.sources || []).map(String).slice(0, 10) };
          const mine = (res.tickets || []).filter((x) => Number(x.feature) === n + 1 && x?.title);
          const pts = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? scale.reduce((b, c) => (Math.abs(c - x) < Math.abs(b - x) ? c : b), scale[0]) : null; };
          const one = (d, title) => ({ ...base, title: clip(title, 200), type: ['Story', 'Task', 'Bug'].includes(d.type) ? d.type : 'Story', storyPoints: pts(d.storyPoints),
            userStory: clip(d.userStory || '', 600), description: clip(d.description || '', 1500), acceptanceCriteria: (Array.isArray(d.acceptanceCriteria) ? d.acceptanceCriteria : []).map((a) => clip(a, 400)).slice(0, acMax) });
          if (t) return [{ ...one(mine[0] || {}, t.title), existingId: t.id, existingKey: t.key, existingStatus: t.status, alreadyDone: doneNames.has(t.status), existingEpicId: t.epicId || null, storyPoints: t.storyPoints ?? pts(mine[0]?.storyPoints) }];
          if (!mine.length) return [{ ...one({}, f.title), existingId: null, existingKey: null, existingStatus: null, alreadyDone: false, existingEpicId: null }];
          return mine.slice(0, 8).map((d) => ({ ...one(d, d.title), existingId: null, existingKey: null, existingStatus: null, alreadyDone: false, existingEpicId: null }));
        }),
      };
      done++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, epics.length) }, worker));
  return { repo: { root: repo.root, branch: repo.branch, head: repo.head }, pages: repo.pages.length, docs: docs.map((d) => d.file), commits: repo.log.length, epics: detailed.filter(Boolean) };
}
