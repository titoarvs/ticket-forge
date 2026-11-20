import { execFile } from 'node:child_process';
import path from 'node:path';
import { localReader } from '../codebase';
import { scanCodebase } from '../routes';
import { askJson } from '../claude';
import { getRules, getGuide } from '../genrules';
import { systemWith } from '../prompts';

export const clip = (s, n) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const git: any = (cwd, args, timeout = 60000) =>
  new Promise((resolve, reject) =>
    execFile('git', args, { cwd, timeout, maxBuffer: 32 * 1024 * 1024 }, (e, out, err) =>
      e
        ? reject(
            new Error(
              String(err || e.message)
                .trim()
                .split('\n')[0],
            ),
          )
        : resolve(String(out)),
    ),
  );
const FIRST_SYNC_COMMITS = 30;
// ---------------------------------------------------------------- pages and what they're built
// from
const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXTS = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.vue',
  '.svelte',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
];
/**
 * The repo files a page uses: its route files and what they import, two levels deep (relative, ~/
 * and @/ imports).
 */
async function pageDeps(route, fileSet, read, cache) {
  const seen = new Set(route.files?.length ? route.files : route.file ? [route.file] : []);
  let frontier = [...seen];
  for (let depth = 0; depth < 2 && frontier.length; depth++) {
    const next: any[] = [];
    for (const f of frontier) {
      let text = cache.get(f);
      if (text === undefined) {
        try {
          text = await read(f);
        } catch {
          text = '';
        }
        cache.set(f, text);
      }
      for (const m of text.matchAll(IMPORT_RE)) {
        const spec: string = m[1] || m[2] || m[3];
        let base = null;
        if (spec.startsWith('.'))
          base = path.posix.normalize(path.posix.join(path.posix.dirname(f as string), spec));
        else if (/^[~@]\//.test(spec)) base = `src/${spec.slice(2)}`;
        if (!base) continue;
        const hit = EXTS.map((e) => base + e).find((c) => fileSet.has(c));
        if (hit && !seen.has(hit)) {
          seen.add(hit);
          next.push(hit);
        }
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
  await git(root, ['rev-parse', '--is-inside-work-tree']).catch(() => {
    throw Object.assign(new Error(`${root} isn’t a git repository.`), { status: 400 });
  });
  const files = await reader.list();
  const scan = await scanCodebase(files, reader.read);
  const fileSet = new Set(files);
  const cache: Map<any, any> = new Map();
  const routes: any[] = [];
  for (const r of scan.routes)
    routes.push({ ...r, deps: await pageDeps(r, fileSet, reader.read, cache) });
  // Files most pages use (layout, UI kit…) are "shared": a change there isn't pinned on every page.
  const uses: Map<any, any> = new Map();
  for (const r of routes) for (const f of r.deps) uses.set(f, (uses.get(f) || 0) + 1);
  const shared = new Set(
    [...uses].filter(([, n]) => routes.length >= 4 && n > routes.length / 2).map(([f]) => f),
  );

  const head = (await git(root, ['rev-parse', 'HEAD'])).trim();
  const branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  let base =
    lastSha &&
    (await git(root, ['cat-file', '-e', `${lastSha}^{commit}`]).then(
      () => lastSha,
      () => null,
    ));
  let baseNote = base ? `since the last sync (${base.slice(0, 7)})` : '';
  if (!base) {
    base =
      (
        await git(root, [
          'rev-list',
          '--max-count=1',
          `--skip=${FIRST_SYNC_COMMITS}`,
          'HEAD',
        ]).catch(() => '')
      ).trim() || (await git(root, ['rev-list', '--max-parents=0', 'HEAD'])).trim().split('\n')[0];
    baseNote = lastSha
      ? `the last synced commit is gone (rebased?), so: the last ${FIRST_SYNC_COMMITS} commits`
      : `first sync: the last ${FIRST_SYNC_COMMITS} commits`;
  }
  // Committed since base + uncommitted edits + new untracked files.
  const changed = new Set(
    [
      ...(await git(root, ['diff', '--name-only', base])).split('\n'),
      ...(await git(root, ['ls-files', '--others', '--exclude-standard'])).split('\n'),
    ]
      .map((f) => f.trim())
      .filter(Boolean),
  );
  const uncommitted = (await git(root, ['status', '--porcelain']))
    .split('\n')
    .filter(Boolean).length;

  const pages: any[] = [];
  for (const r of routes) {
    const own = r.deps.filter((f) => changed.has(f) && !shared.has(f));
    let diff = '';
    if (own.length)
      diff = clip(
        await git(root, ['diff', '--unified=2', base, '--', ...own.slice(0, 12)]).catch(() => ''),
        5000,
      );
    pages.push({
      path: r.path,
      name: r.name,
      file: r.file,
      framework: r.framework,
      params: r.params,
      deps: r.deps.length,
      depFiles: r.deps.filter((f) => !shared.has(f)),
      changedFiles: own,
      diff,
    });
  }
  const sharedChanged = [...changed].filter((f) => shared.has(f));
  const log = (
    await git(root, [
      'log',
      '-n',
      '800',
      '--date=short',
      '--format=%h%x09%ad%x09%an%x09%s%x09%b%x1e',
    ])
  )
    .split('\x1e')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [sha, date, author, subject, body] = x.split('\t');
      return {
        sha,
        date,
        author,
        subject,
        body: clip(
          String(body || '')
            .split('\n')
            .find((l) => l.trim()) || '',
          160,
        ),
      };
    });
  return {
    root,
    head,
    branch,
    base,
    baseNote,
    frameworks: scan.frameworks,
    pages,
    changedFiles: [...changed].length,
    sharedChanged,
    uncommitted,
    log,
  };
}
// ---------------------------------------------------------------- AI: test cases the changes
// affect
const tcRef = (t, i) => t.testCases[i].key || `${t.key}#${i + 1}`;
/** @param {{ project: any, repo, ai?: any, emit?: (message: string) => void }} o */
export async function testCaseUpdates({ project, repo, ai = {}, emit = (_m) => {} }: any) {
  const changedPages = repo.pages.filter((p) => p.changedFiles.length);
  const tickets = project.tickets.filter((t) => t.testCases?.length);
  if (!changedPages.length || !tickets.length) return { updates: [], additions: [] };
  const rules = await getRules();
  const system = systemWith(rules, ['tests'], await getGuide());
  const changes = changedPages
    .map(
      (p) =>
        `### Page "${p.name}" (${p.path})\nChanged files: ${p.changedFiles.join(', ')}\n${p.diff ? `Diff:\n${p.diff}` : ''}`,
    )
    .join('\n\n');
  // Pass 1: which test cases do these changes touch? (titles only, so all 300+ fit)
  emit('AI is checking which test cases the code changes affect…');
  const catalog = tickets
    .map(
      (t) =>
        `${t.key} ${t.title}\n${t.testCases.map((c, i) => `  [${tcRef(t, i)}] ${clip(c.title, 140)}`).join('\n')}`,
    )
    .join('\n');
  const pick = await askJson({
    ...ai,
    task: 'tests',
    reasoning: 'balanced',
    system,
    prompt: `The web app's code changed on these pages:\n\n${clip(changes, 40000)}\n\nThese are the project's issues and their test cases:\n${clip(catalog, 60000)}

Which test cases are now out of date because of these changes (different screens, fields, labels, steps, rules or results)?
Also: which issues need a NEW test case for behaviour the change added that no test covers?
Only pick ones the changes really affect. Return JSON: { "affected": ["TC-…"], "needsNew": ["PR-…"] }`,
  });
  const affected = new Set((pick.affected || []).map(String));
  const needsNew = new Set((pick.needsNew || []).map(String));
  const hits = tickets
    .map((t) => ({ t, idx: t.testCases.map((_, i) => i).filter((i) => affected.has(tcRef(t, i))) }))
    .filter((x) => x.idx.length || needsNew.has(x.t.key));
  if (!hits.length) return { updates: [], additions: [] };
  // Pass 2: rewrite those, with their full steps.
  emit(
    `AI is updating ${affected.size} test case${affected.size === 1 ? '' : 's'}${needsNew.size ? ` and adding new ones for ${needsNew.size} issue${needsNew.size === 1 ? '' : 's'}` : ''}…`,
  );
  const detail = hits
    .slice(0, 25)
    .map(
      ({ t, idx }: any) => `## ${t.key} ${t.title}
Acceptance criteria: ${(t.acceptanceCriteria || []).map((a, i) => `AC${i + 1} ${clip(a, 200)}`).join(' | ')}
${idx
  .map((i) => {
    const c = t.testCases[i];
    return `[${tcRef(t, i)}] ${c.title}\n  Preconditions: ${clip(c.preconditions, 200)}\n  Steps: ${(Array.isArray(c.steps) ? c.steps : [c.steps]).map((s, n) => `${n + 1}. ${clip(s, 160)}`).join(' ')}\n  Expected: ${clip(c.expected, 300)}`;
  })
  .join('\n')}${needsNew.has(t.key) ? '\n(needs a new test case)' : ''}`,
    )
    .join('\n\n');
  const res = await askJson({
    ...ai,
    task: 'tests',
    reasoning: rules.reasoning,
    system,
    prompt: `The web app's code changed:\n\n${clip(changes, 40000)}\n\nUpdate these test cases so they match the app as it is now, and add the new test cases noted:\n\n${clip(detail, 50000)}

Rules: keep each test case's intent and the acceptance criterion it proves. Change only what the code change requires.
Steps are short imperative sentences using the screen's real labels from the diff. Say in "why" what changed in the app.
Return JSON: { "updates": [ { "ref": "TC-…", "title": "…", "preconditions": "…", "steps": ["…"], "expected": "…", "why": "…" } ],
"additions": [ { "ticketKey": "PR-…", "title": "…", "type": "Functional|Negative|Edge|UI", "priority": "High|Medium|Low", "preconditions": "…", "steps": ["…"], "expected": "…", "why": "…" } ] }`,
  });
  const byRef = new Map(tickets.flatMap((t) => t.testCases.map((c, i) => [tcRef(t, i), { t, c }])));
  const updates = (res.updates || [])
    .map((u) => {
      const hit: any = byRef.get(String(u.ref));
      return (
        hit && {
          ticketId: hit.t.id,
          ticketKey: hit.t.key,
          tcId: hit.c.id,
          ref: String(u.ref),
          why: clip(u.why, 300),
          before: {
            title: hit.c.title,
            preconditions: hit.c.preconditions || '',
            steps: hit.c.steps || [],
            expected: hit.c.expected || '',
          },
          after: {
            title: clip(u.title || hit.c.title, 300),
            preconditions: clip(u.preconditions ?? hit.c.preconditions ?? '', 600),
            steps: (Array.isArray(u.steps) ? u.steps : []).map((s) => clip(s, 300)).slice(0, 20),
            expected: clip(u.expected || hit.c.expected, 800),
          },
        }
      );
    })
    .filter((u) => u && u.after.steps.length);
  const keyed = new Map(tickets.map((t) => [t.key, t]));
  const additions = (res.additions || [])
    .map((a) => {
      const t: any = keyed.get(String(a.ticketKey));
      return (
        t && {
          ticketId: t.id,
          ticketKey: t.key,
          why: clip(a.why, 300),
          tc: {
            title: clip(a.title, 300),
            type: ['Functional', 'Negative', 'Edge', 'UI'].includes(a.type) ? a.type : 'Functional',
            priority: ['High', 'Medium', 'Low'].includes(a.priority) ? a.priority : 'Medium',
            preconditions: clip(a.preconditions || '', 600),
            steps: (Array.isArray(a.steps) ? a.steps : []).map((s) => clip(s, 300)).slice(0, 20),
            expected: clip(a.expected || '', 800),
          },
        }
      );
    })
    .filter((a) => a && a.tc.title && a.tc.steps.length);
  return { updates, additions };
}
