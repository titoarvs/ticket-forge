import { askJson } from '../claude';
import { jevEnabled, jevStatus, jevDecide } from '../jev';
import { findOverlaps } from '../specs';
import { type Deciders, issuesFor, orderTickets } from '../devorder';
import { keyOf, clip, LIVE, busyFromJobs, planParallel } from './plan-parallel';

const realDeciders: Required<Deciders> = {
  jevOn: () => jevEnabled().catch(() => false),
  jevMin: async () => (await jevStatus()).minConfidence,
  jevDecide,
  askJson,
};
/**
 * The smart part: likely conflicts for issues without a coding spec, and module overlaps judged
 * harmless. Jev first, the AI for what Jev isn't sure about, nothing when both fail. { likely,
 * cleared, engine, byJev, byAi, note }.
 */
export async function parallelHints({
  project,
  tickets,
  specs,
  ai = {},
  use,
}: {
  project: any;
  tickets: any[];
  specs: any[];
  ai?: any;
  use?: Deciders;
}) {
  const d = { ...realDeciders, ...(use || {}) };
  const byKey = new Map(tickets.map((t) => [keyOf(t), t]));
  const specOf = (t: any) =>
    specs.find((s) => s.ticketId === t.id && ((s.files || []).length || (s.modules || []).length));
  const unknown = tickets.filter((t) => !specOf(t));
  // Module-only overlaps between selected issues (no shared file): maybe harmless.
  const ids = new Set(tickets.map((t) => t.id));
  const overlaps = findOverlaps(
    specs.filter((s) => ids.has(s.ticketId)).map((s) => ({ ...s, epicId: 'batch' })),
  );
  const fileShared = new Set(
    overlaps
      .filter((o: any) => o.kind === 'file')
      .flatMap((o: any) => {
        const k = o.specs.map((s: any) => s.ticketId);
        return k.flatMap((a: string) =>
          k.filter((b: string) => b !== a).map((b: string) => `${a}|${b}`),
        );
      }),
  );
  const modulePairs: { a: any; b: any; module: string }[] = [];
  for (const o of overlaps.filter((x: any) => x.kind === 'module')) {
    const list = o.specs.map((s: any) => s.ticketId);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        if (!fileShared.has(`${list[i]}|${list[j]}`) && modulePairs.length < 40)
          modulePairs.push({
            a: tickets.find((t) => t.id === list[i]),
            b: tickets.find((t) => t.id === list[j]),
            module: o.target,
          });
      }
  }
  const describe = (t: any) => {
    const s = specOf(t);
    return {
      title: clip(t.title, 140),
      layer: t.layer || 'unknown',
      description: clip(t.description || t.userStory, 240),
      files: s ? (s.files || []).slice(0, 12).map((f: any) => f.path) : 'unknown (no coding spec)',
      modules: s?.modules || [],
    };
  };
  const likely: { a: string; b: string; why: string; source: 'jev' | 'ai' }[] = [];
  const cleared = new Set<string>();
  const pairName = (a: any, b: any, m: string) =>
    `${[keyOf(a), keyOf(b)].sort().join('|')}|${m.toLowerCase()}`;
  let byJev = 0,
    byAi = 0,
    note = '';
  let unsureUnknown = unknown.filter(() => tickets.length > 1),
    unsurePairs = modulePairs;
  if ((unsureUnknown.length || unsurePairs.length) && (await d.jevOn())) {
    const min = await d.jevMin();
    const leftU: any[] = [],
      leftP: typeof modulePairs = [];
    try {
      const questions: Record<string, any> = {};
      for (const t of unsureUnknown.slice(0, 40)) {
        questions[`${keyOf(t)}.overlaps`] = {
          type: 'choice',
          instructions: `These issues are coded at the same time, each on its own branch. Which other issue will most likely edit the same files as ${keyOf(t)}? Choose "none" when no other issue is likely to.`,
          criteria: {
            none: 'no other listed issue edits the same files',
            ...Object.fromEntries(
              tickets
                .filter((x) => x.id !== t.id)
                .slice(0, 250)
                .map((x) => [keyOf(x), clip(x.title, 120)]),
            ),
          },
        };
      }
      unsurePairs.forEach((p, i) => {
        questions[`pair${i}`] = {
          type: 'noul',
          instructions: `${keyOf(p.a)} and ${keyOf(p.b)} both work in the module ${p.module}, but list no file in common. Will they edit the same files or functions?`,
          criteria: {
            true: 'they will change the same files, functions or shared types',
            false: 'they change separate files of the module',
          },
        };
      });
      const r = await d.jevDecide({
        state: {
          project: project?.name,
          issues: Object.fromEntries(tickets.map((t) => [keyOf(t), describe(t)])),
        },
        questions,
      });
      for (const t of unsureUnknown.slice(0, 40)) {
        const a: any = r.answers[`${keyOf(t)}.overlaps`];
        if (
          !a?.choice ||
          (a.confidence ?? 0) < min ||
          (a.choice !== 'none' && !byKey.has(a.choice))
        ) {
          leftU.push(t);
          continue;
        }
        if (a.choice !== 'none')
          likely.push({
            a: t.id,
            b: byKey.get(a.choice).id,
            why: `Jev: ${keyOf(t)} likely edits the same code as ${a.choice} (${Math.round((a.confidence ?? 0) * 100)}% sure)`,
            source: 'jev',
          });
        byJev++;
      }
      leftU.push(...unsureUnknown.slice(40));
      unsurePairs.forEach((p, i) => {
        const a: any = r.answers[`pair${i}`];
        const v = typeof a?.noul === 'number' ? a.noul : null;
        if (v == null || (v > 1 - min && v < min)) {
          leftP.push(p);
          return;
        }
        if (v <= 1 - min) cleared.add(pairName(p.a, p.b, p.module));
        byJev++;
      });
    } catch (e: any) {
      leftU.push(...unsureUnknown);
      leftP.push(...unsurePairs);
      note = `Jev: ${e.message}`;
    }
    unsureUnknown = leftU;
    unsurePairs = leftP;
  }
  if (unsureUnknown.length || unsurePairs.length) {
    try {
      const res = await d.askJson({
        ...ai,
        task: 'quick',
        reasoning: 'fast',
        system: `You are a tech lead about to have several issues coded at the same time, each on its own branch. Merge conflicts happen when two
of them edit the same files. Answer two things:
1. "likely": for the issues listed under "No coding spec", which other listed issue would edit the same files (only when it is likely).
2. "modules": for each module pair, whether the two issues will edit the same files or functions (true) or separate files (false).
Return JSON only: { "likely": [ { "a": "PR-1", "b": "PR-2", "why": "short reason" } ], "modules": [ { "pair": 0, "same": true } ] }`,
        prompt: `Project: ${project?.name || ''}
Issues:
${tickets
  .map((t) => {
    const x = describe(t);
    return `- ${keyOf(t)} [${x.layer}] ${x.title}${x.description ? ` | ${x.description}` : ''} | files: ${Array.isArray(x.files) ? x.files.join(', ') || 'none' : x.files}`;
  })
  .join('\n')}

No coding spec: ${unsureUnknown.map(keyOf).join(', ') || 'none'}
Module pairs:
${unsurePairs.map((p, i) => `${i}. ${keyOf(p.a)} and ${keyOf(p.b)} in ${p.module}`).join('\n') || 'none'}`,
      });
      const unknownIds = new Set(unsureUnknown.map((t) => t.id));
      for (const l of res?.likely || []) {
        const a = byKey.get(String(l.a)),
          b = byKey.get(String(l.b));
        if (!a || !b || a.id === b.id || (!unknownIds.has(a.id) && !unknownIds.has(b.id))) continue;
        likely.push({
          a: a.id,
          b: b.id,
          why: `AI: ${clip(l.why, 140) || `${keyOf(a)} and ${keyOf(b)} likely edit the same code`}`,
          source: 'ai',
        });
        byAi++;
      }
      for (const m of res?.modules || []) {
        const p = unsurePairs[Number(m.pair)];
        if (p && m.same === false) {
          cleared.add(pairName(p.a, p.b, p.module));
          byAi++;
        }
      }
    } catch (e: any) {
      note = [note, `AI: ${e.message}`].filter(Boolean).join(' · ');
    }
  }
  const engine = byJev && byAi ? 'jev+ai' : byJev ? 'jev' : byAi ? 'ai' : 'rules';
  return { likely, cleared, engine, byJev, byAi, note };
}
/**
 * Checks issues before their code jobs start together. `jobs` are the project's code jobs (local or
 * remote), `specs` its coding specs. { rounds, runNow, wait, conflicts, noSpec, alreadyRunning,
 * engine, byJev, byAi, note, summary }.
 */
export async function checkParallel({
  project,
  ticketIds,
  specs = [],
  jobs = [],
  ai = {},
  smart = true,
  use,
}: any) {
  const { open } = issuesFor(project, { ticketIds });
  const all = (project?.tickets || []).filter((t: any) => (ticketIds || []).includes(t.id));
  const tickets = orderTickets(open.length ? open : all, { project }).order.map((o) =>
    (project.tickets || []).find((t: any) => t.id === o.ticketId),
  );
  if (!tickets.length)
    throw Object.assign(new Error('Choose at least one issue.'), { status: 400 });
  const selected = new Set<string>(tickets.map((t: any) => t.id));
  const running = new Set<string>(
    (jobs || [])
      .filter(
        (j: any) => selected.has(j.ticketId) && LIVE.includes(j.status) && j.kind !== 'pr-review',
      )
      .map((j: any) => j.ticketId),
  );
  const busy = busyFromJobs(jobs, specs, selected);
  const h =
    smart && tickets.length > 1
      ? await parallelHints({ project, tickets, specs, ai, use })
      : { likely: [], cleared: new Set<string>(), engine: 'rules', byJev: 0, byAi: 0, note: '' };
  const plan = planParallel({
    tickets,
    specs,
    busy,
    likely: h.likely as any,
    cleared: h.cleared,
    running,
  });
  const now = plan.runNow.length,
    later = plan.wait.length;
  const summary = later
    ? `${now} of ${tickets.length - plan.alreadyRunning.length} can be coded together now; ${later} should wait (they share code with another issue).`
    : `All ${now} can be coded together: no shared files or modules found${plan.noSpec.length ? ` (${plan.noSpec.length} without a coding spec${h.engine === 'rules' ? ' couldn’t be checked' : ' checked by ' + (h.engine === 'jev' ? 'Jev' : h.engine === 'ai' ? 'the AI' : 'Jev and the AI')})` : ''}.`;
  return { ...plan, engine: h.engine, byJev: h.byJev, byAi: h.byAi, note: h.note, summary };
}
