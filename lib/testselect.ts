// Test Selection Agent: picks the automated tests worth running now (like BrowserStack's test selection), from what
// changed in the code since the last run, issues changed recently, and recent failures / flaky / never-run tests,
// within a budget. Returns the selection with a reason per test, for review before running. Nothing runs here.
import { askJson } from './claude';
import { jevEnabled, jevStatus, jevDecide } from './jev';
import { agentInstructions } from './agents';
import { readRepo } from './reposync';
import { contextBlock } from './appcontext';

const clip = (s, n) => {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const day = 864e5;

export async function selectTests({
  project,
  budget = 25,
  goal = '',
  useCode = true,
  includeManual = false,
  ai = {},
  emit = (_m) => {},
}: any) {
  const now = Date.now();
  const items = project.tickets
    .flatMap((t) => (t.testCases || []).map((tc, i) => ({ t, tc, i })))
    .filter((x) => includeManual || x.tc.script);
  if (!items.length)
    throw Object.assign(
      new Error(
        includeManual
          ? 'This project has no test cases yet.'
          : 'No automated tests yet: write scripts first (Test automation → App setup), or include tests without scripts.',
      ),
      { status: 400 },
    );
  // What changed in the code (local repository), since the last run's commit when known.
  let changes = '',
    changeNote = 'Code changes: not read (no local repository).',
    head = null;
  const dir = String(project.dev?.localPath || '').trim();
  if (useCode && dir) {
    try {
      emit('Reading what changed in the repository…');
      const repo = await readRepo(dir, project.automation?.lastRunSha || project.automation?.repoSync?.sha || null);
      head = repo.head;
      const changed = repo.pages.filter((p) => p.changedFiles.length);
      changeNote = `Code changes ${repo.baseNote}: ${repo.changedFiles} files${repo.uncommitted ? ` (${repo.uncommitted} uncommitted)` : ''}, ${changed.length} pages affected${repo.sharedChanged.length ? `, plus shared files used by many pages: ${repo.sharedChanged.slice(0, 8).join(', ')}` : ''}.`;
      changes = changed
        .slice(0, 40)
        .map((p) => `- ${p.path} (${p.name}): ${p.changedFiles.slice(0, 6).join(', ')}${p.diff ? `\n  diff: ${clip(p.diff, 600)}` : ''}`)
        .join('\n');
    } catch (e) {
      changeNote = `Code changes: couldn’t read the repository (${e.message}).`;
    }
  }
  const recent = project.tickets
    .filter((t) => now - new Date(t.updatedAt || 0).getTime() < 7 * day)
    .map((t) => `${t.key} ${clip(t.title, 80)} [${t.status}]`);
  const lines = items.map(({ t, tc, i }: any) => {
    const r = tc.lastRun;
    const age = r?.at ? Math.round((now - new Date(r.at).getTime()) / day) : null;
    return `${tc.id} | ${t.key}#${i + 1} | ${clip(tc.title, 90)} | ${t.priority || 'Medium'} | ${tc.status || 'Not run'}${r?.flaky ? ' flaky' : ''}${tc.healed ? ' healed' : ''}${age != null ? ` ${age}d ago` : ' never run'}${tc.script ? '' : ' | no script'}`;
  });
  const catalog = lines.join('\n');
  // Jev (Administration → AI → Decisions): a yes/no for every test in a few quick calls. When it isn't set up, fails, or
  // finds nothing worth running, the AI chooses below.
  if (await jevEnabled().catch(() => false)) {
    try {
      emit(`Jev is scoring ${items.length} tests…`);
      const min = (await jevStatus()).minConfidence;
      const scored: { x: any; p: number }[] = [];
      for (let i = 0; i < items.length; i += 40) {
        const chunk = items.slice(i, i + 40);
        const r = await jevDecide({
          state: {
            project: project.name,
            goalOfThisRun: goal ? clip(goal, 400) : '',
            codeChanges: changeNote,
            pagesChanged: clip(changes, 9000),
            issuesChangedThisWeek: recent.slice(0, 40),
            tests: Object.fromEntries(chunk.map((x: any) => [x.tc.id, lines[items.indexOf(x)]])),
          },
          questions: Object.fromEntries(
            chunk.map((x: any) => [
              x.tc.id,
              {
                type: 'noul' as const,
                instructions: `Is test ${x.tc.id} worth running now? Tests are listed as: id | issue#n | title | priority | last result | when.`,
                criteria: {
                  true: 'it covers a page or file that changed, an issue changed this week, or it failed or was flaky last time, or it covers a core flow (sign-in, payments, saving data), or it has not run in a long time',
                  false: 'it is unrelated to every change and recently passed',
                },
              },
            ]),
          ),
        });
        for (const x of chunk) scored.push({ x, p: Number((r.answers[x.tc.id] as any)?.noul ?? 0) });
      }
      const picked = scored
        .filter((s) => s.p >= Math.max(0.5, min - 0.1))
        .sort((a, b) => b.p - a.p)
        .slice(0, budget);
      if (picked.length) {
        const selected = picked.map(({ x, p }) => ({
          tcId: x.tc.id,
          ticketId: x.t.id,
          key: `${x.t.key}#${x.i + 1}`,
          title: x.tc.title,
          risk: p >= 0.8 ? 'high' : p >= 0.6 ? 'medium' : 'low',
          reason: `Jev: ${Math.round(p * 100)}% likely worth running${x.tc.lastRun?.flaky ? ' (flaky)' : x.tc.status === 'Failed' ? ' (failed last time)' : !x.tc.lastRun ? ' (never run)' : ''}`,
        }));
        return {
          selected,
          summary: `Jev chose ${selected.length} of ${items.length} tests from the code changes, recent issue changes and past results.`,
          gaps: [],
          considered: items.length,
          changeNote,
          head,
          engine: 'jev',
        };
      }
    } catch {
      /* the AI chooses */
    }
  }
  emit(`AI is choosing up to ${budget} of ${items.length} tests…`);
  const res = await askJson({
    ...ai,
    task: 'selection',
    reasoning: 'fast',
    system: `You are a test selection agent for a CI pipeline. Pick the tests most likely to catch a regression from the
current change, within the budget. Rank by: tests covering pages/files that changed (highest), tests on issues changed this week,
tests that failed or were flaky last time, High/Highest priority tests on core flows (sign-in, payments, saving data), then tests not
run for a long time. Skip tests unrelated to any change unless the budget allows a smoke check of core flows.
Return JSON only.${await agentInstructions('test-selection')}${contextBlock(project, { short: true })}`,
    prompt: `Project: ${project.name}
${goal ? `Goal of this run: ${clip(goal, 400)}\n` : ''}${changeNote}
${changes ? `Pages changed:\n${changes}\n` : ''}
Issues changed in the last 7 days: ${recent.slice(0, 40).join('; ') || 'none'}

Tests (id | issue#n | title | priority | last result | when):
${catalog.slice(0, 60000)}

Budget: at most ${budget} tests.
Return JSON: { "selected": [ { "id": "<test id>", "risk": "high|medium|low", "reason": "short: which change or signal it covers" } ],
  "summary": "one or two sentences: what this selection covers", "gaps": ["changes no test covers"] }`,
  });
  const byId = new Map(items.map((x) => [x.tc.id, x]));
  const seen: Set<any> = new Set();
  const selected = (res.selected || [])
    .filter((s) => byId.has(String(s.id)) && !seen.has(String(s.id)) && seen.add(String(s.id)))
    .slice(0, budget)
    .map((s) => {
      const x: any = byId.get(String(s.id));
      return {
        tcId: x.tc.id,
        ticketId: x.t.id,
        key: `${x.t.key}#${x.i + 1}`,
        title: x.tc.title,
        risk: ['high', 'medium', 'low'].includes(s.risk) ? s.risk : 'medium',
        reason: clip(s.reason, 200),
      };
    });
  return {
    selected,
    summary: clip(res.summary, 400),
    gaps: (res.gaps || []).map((g) => clip(g, 200)).slice(0, 8),
    considered: items.length,
    changeNote,
    head,
  };
}
