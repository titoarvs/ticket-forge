import path from 'node:path';
import { askJson } from '../claude';
import { getRules, getGuide } from '../genrules';
import { systemWith } from '../prompts';
import { clip, readRepo } from './test-case-updates';

// ---------------------------------------------------------------- AI: features already built
/** @param {{ project: any, repo, ai?: any, emit?: (message: string) => void }} o */
export async function builtFeatures({ project, repo, ai = {}, emit = (_m) => {} }: any) {
  emit('AI is matching the git history and pages with the backlog…');
  const doneNames = new Set(
    project.workflow?.length
      ? project.workflow.filter((w) => w.category === 'done').map((w) => w.name)
      : ['Done'],
  ); // no saved workflow: the default one
  const rules = await getRules();
  const history = repo.log
    .map(
      (c) =>
        `${c.sha} ${c.date} ${c.subject}${c.body && c.body !== c.subject ? ` — ${c.body}` : ''}`,
    )
    .join('\n');
  const backlog = project.tickets
    .filter((t) => !t.parentId)
    .map((t) => `${t.key} [${t.status}] ${t.title}`)
    .join('\n');
  const epics = project.epics.map((e) => `${e.key} ${e.title}`).join('\n');
  const res = await askJson({
    ...ai,
    task: 'repo',
    reasoning: rules.reasoning,
    system: systemWith(rules, ['tickets'], await getGuide()),
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
"acceptanceCriteria": ["…"], "pages": ["/path"], "evidence": "commits…" } ] }`,
  });
  const byKey = new Map(project.tickets.map((t) => [t.key, t]));
  const epicByKey: any = new Map(project.epics.map((e) => [e.key, e]));
  const done = (res.done || [])
    .map((d) => {
      const t: any = byKey.get(String(d.key));
      return (
        t &&
        !doneNames.has(t.status) && {
          ticketId: t.id,
          key: t.key,
          title: t.title,
          status: t.status,
          evidence: clip(d.evidence, 400),
        }
      );
    })
    .filter(Boolean);
  const newIssues = (res.newIssues || [])
    .filter((n) => n?.title)
    .slice(0, 40)
    .map((n) => ({
      title: clip(n.title, 200),
      type: n.type === 'Task' ? 'Task' : 'Story',
      epicId: epicByKey.get(String(n.epicKey))?.id || null,
      epicKey: epicByKey.has(String(n.epicKey)) ? String(n.epicKey) : null,
      userStory: clip(n.userStory, 600),
      description: clip(n.description, 2000),
      acceptanceCriteria: (Array.isArray(n.acceptanceCriteria) ? n.acceptanceCriteria : [])
        .map((a) => clip(a, 400))
        .slice(0, 8),
      pages: (Array.isArray(n.pages) ? n.pages : []).map(String).slice(0, 6),
      evidence: clip(n.evidence, 600),
    }));
  return { done, newIssues };
}
// ---------------------------------------------------------------- AI: test cases for the pages as
// built
const TC_TYPES = [
  'Functional',
  'Negative',
  'Edge',
  'UI',
  'Integration',
  'Security',
  'Performance',
  'Accessibility',
];
/**
 * A page's own code for the prompt: its route file first, then the components it uses (not the
 * shared UI kit).
 */
export async function pageCode(root, page, budget = 48000) {
  const fs = await import('node:fs/promises');
  const files = [page.file, ...page.depFiles.filter((f) => f !== page.file)]
    .filter(Boolean)
    .filter(
      (f) =>
        !/(^|\/)(components\/ui|ui)\/|\.(css|scss|svg|json|md)$|(^|\/)(utils?|cn)\.[tj]sx?$/.test(
          f,
        ),
    )
    .sort((a, b) =>
      a === page.file
        ? -1
        : b === page.file
          ? 1
          : (/components|features|views|pages|screens/.test(b) ? 1 : 0) -
            (/components|features|views|pages|screens/.test(a) ? 1 : 0),
    );
  let out = '';
  const used: any[] = [];
  for (const f of files) {
    if (out.length >= budget) break;
    let text = '';
    try {
      text = await fs.readFile(path.join(root, f), 'utf8');
    } catch {
      continue;
    }
    out += `\n// ===== ${f}\n${clip(text, Math.min(16000, budget - out.length))}\n`;
    used.push(f);
  }
  return { code: out, files: used };
}
/**
 * Test cases for the app's existing pages, written from their code: for each page, the backlog
 * issue it implements (or a new issue, Done, for delivered work with none) and its test cases.
 * Returns { pages: [...] } for review.
 */
export async function pageTestCases({
  project,
  dir,
  only = null,
  ai = {},
  emit = (_m) => {},
}: any) {
  const repo = await readRepo(dir, project.automation?.repoSync?.sha || null);
  const pages = repo.pages.filter((p) => !only?.length || only.includes(p.path));
  const rules = await getRules();
  const system = systemWith(rules, ['tickets', 'tests'], await getGuide());
  const backlog = project.tickets
    .filter((t) => !t.parentId)
    .map(
      (t) =>
        `${t.key} [${t.status}] ${t.title}${t.epicId ? ` (epic ${project.epics.find((e) => e.id === t.epicId)?.key || ''})` : ''}`,
    )
    .join('\n');
  const epics = project.epics.map((e) => `${e.key} ${e.title}`).join('\n');
  const roles = (project.automation?.app?.roles || []).map((r) => r.name).filter(Boolean);
  const byKey = new Map(project.tickets.map((t: any) => [t.key, t]));
  const epicByKey: any = new Map(project.epics.map((e) => [e.key, e]));
  const results: any[] = [];
  let done = 0;
  const queue = [...pages];
  const worker = async () => {
    while (queue.length) {
      if (ai.signal?.aborted) return;
      const pg = queue.shift();
      const { code, files } = await pageCode(repo.root, pg);
      emit(
        `Reading ${pg.path} (${files.length} file${files.length === 1 ? '' : 's'}) and writing its test cases… ${done}/${pages.length}`,
      );
      try {
        const res = await askJson({
          ...ai,
          task: 'tests',
          reasoning: rules.reasoning,
          system,
          prompt: `Write the test cases for this EXISTING page of the web app "${project.name}", from its code as it is now.

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
"steps": ["…"], "expected": "…"${roles.length ? ', "runAs": "<role>"' : ''} } ] }`,
        });
        const t: any = res.ticketKey ? byKey.get(String(res.ticketKey)) : null;
        const ni =
          !t && res.newIssue?.title
            ? {
                title: clip(res.newIssue.title, 200),
                epicId: epicByKey.get(String(res.newIssue.epicKey))?.id || null,
                epicKey: epicByKey.has(String(res.newIssue.epicKey))
                  ? String(res.newIssue.epicKey)
                  : null,
                userStory: clip(res.newIssue.userStory, 600),
                acceptanceCriteria: (Array.isArray(res.newIssue.acceptanceCriteria)
                  ? res.newIssue.acceptanceCriteria
                  : []
                )
                  .map((a) => clip(a, 400))
                  .slice(0, 8),
              }
            : null;
        const have = new Set((t?.testCases || []).map((c) => String(c.title).trim().toLowerCase()));
        const tcs = (Array.isArray(res.testCases) ? res.testCases : [])
          .filter((c) => c?.title && Array.isArray(c.steps) && c.steps.length)
          .filter((c) => !have.has(String(c.title).trim().toLowerCase()))
          .slice(0, 12)
          .map((c) => ({
            title: clip(c.title, 300),
            type: TC_TYPES.includes(c.type) ? c.type : 'Functional',
            priority: ['High', 'Medium', 'Low'].includes(c.priority) ? c.priority : 'Medium',
            preconditions: clip(c.preconditions || '', 600),
            steps: c.steps.map((x) => clip(x, 300)).slice(0, 15),
            expected: clip(c.expected || '', 800),
            ...(roles.includes(c.runAs) ? { runAsName: c.runAs } : {}),
          }));
        results.push({
          path: pg.path,
          name: pg.name,
          files,
          note: clip(res.note || '', 300),
          ticketId: t?.id || null,
          ticketKey: t?.key || null,
          ticketTitle: t?.title || null,
          newIssue: ni,
          testCases: tcs,
        });
      } catch (e) {
        if (ai.signal?.aborted) return;
        results.push({
          path: pg.path,
          name: pg.name,
          files,
          error: clip(e.message, 300),
          testCases: [],
        });
      }
      done++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pages.length) }, worker));
  results.sort((a, b) => a.path.localeCompare(b.path));
  return { repo: { branch: repo.branch, head: repo.head, root: repo.root }, pages: results };
}
// ---------------------------------------------------------------- AI: map of what's built, by epic
// (pages + .md docs + history)
const MD_SKIP =
  /(^|\/)(test-results|playwright-report|coverage|node_modules|dist|build|\.[^/]+)\//i;
const MD_NOT_FEATURES =
  /(^|\/)(CLAUDE|AGENTS|CONTRIBUTING|CODE_OF_CONDUCT|LICENSE|SECURITY)\.md$|template/i;
/**
 * The repository's Markdown documents that describe the product (feature notes, change records,
 * release notes, READMEs).
 */
export async function featureDocs(root, files, budget = 70000) {
  const fs = await import('node:fs/promises');
  const docs = files
    .filter((f) => /\.mdx?$/i.test(f) && !MD_SKIP.test(f) && !MD_NOT_FEATURES.test(f))
    // Feature folders first ("done" before "todo"), then release notes / changelogs, then the rest.
    .sort((a, b) => {
      const rank = (f) =>
        /features?\/|change-?records?|adr|decisions?/i.test(f)
          ? /(^|\/)(done|shipped|released)\//i.test(f)
            ? 0
            : 1
          : /release|changelog/i.test(f)
            ? 2
            : /readme/i.test(f)
              ? 3
              : 4;
      return rank(a) - rank(b) || a.localeCompare(b);
    });
  const out: any[] = [];
  let used = 0;
  for (const f of docs) {
    if (used >= budget) {
      out.push({ file: f, text: '(not read: too many documents)', skipped: true });
      continue;
    }
    let text = '';
    try {
      text = await fs.readFile(path.join(root, f), 'utf8');
    } catch {
      continue;
    }
    const t = clip(text.replace(/\n{3,}/g, '\n\n'), Math.min(4000, budget - used));
    used += t.length;
    out.push({ file: f, text: t });
  }
  return out;
}
