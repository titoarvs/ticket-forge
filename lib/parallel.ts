// Coding several issues at once without conflicts. Before code jobs start on many issues, this
// checks which of them touch the same files or modules (their coding specs, lib/specs.ts
// findOverlaps), which collide with code jobs that are running or waiting for review, and which are
// blocked by another selected issue. It splits the issues into rounds: round 1 can run together
// now, the others should wait for the round before. Jev (when on) makes two small calls: for issues
// without a coding spec, which other selected issue most likely edits the same code (pick one), and
// for issues that share only a module, whether they will really edit the same code (yes / no). What
// Jev isn't sure about goes to the AI; when the AI fails too, the rules decide (shared module =
// conflict, no spec = can't check).
import { askJson } from './claude';
import { jevEnabled, jevStatus, jevDecide } from './jev';
import { findOverlaps } from './specs';
import { issuesFor, orderTickets, type Deciders } from './devorder';

const clip = (s: any, n: number) => {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const keyOf = (t: any) => String(t.key || t.ticketKey || t.id || t.ticketId);
const LIVE = ['starting', 'queued', 'running'];
const UNMERGED = ['review', 'pr', 'committed', 'report'];

export type Conflict = {
  kind: 'file' | 'module' | 'likely' | 'job' | 'blocked';
  target: string;
  ticketIds: string[];
  keys: string[];
  why: string;
  source: 'spec' | 'jev' | 'ai' | 'job' | 'link';
  cleared?: boolean;
};

/** Busy code: the files each running (or not yet merged) code job of another issue touches. */
export function busyFromJobs(jobs: any[], specs: any[], selected: Set<string>) {
  const out: {
    ticketId: string;
    key: string;
    status: string;
    files: string[];
    modules: string[];
  }[] = [];
  const seen = new Set<string>();
  for (const j of jobs || []) {
    if (
      !j ||
      selected.has(j.ticketId) ||
      j.kind === 'pr-review' ||
      seen.has(`${j.ticketId}:${j.side || ''}`)
    )
      continue;
    const live = LIVE.includes(j.status),
      open = UNMERGED.includes(j.status) && (j.files || []).length;
    if (!live && !open) continue;
    seen.add(`${j.ticketId}:${j.side || ''}`);
    const spec = specs.find((s) => s.ticketId === j.ticketId);
    const files = [
      ...new Set([
        ...(j.files || []).map((f: any) => f.path).filter(Boolean),
        ...(live ? (spec?.files || []).map((f: any) => f.path) : []),
      ]),
    ];
    out.push({
      ticketId: j.ticketId,
      key: j.ticketKey || spec?.key || j.ticketId,
      status: j.status,
      files,
      modules: live ? spec?.modules || [] : [],
    });
  }
  return out;
}

/**
 * The plan (pure: no database, no AI). `tickets` are the selected issues in development order;
 * `specs` the project's coding specs; `busy` what other code jobs touch now (busyFromJobs);
 * `likely` pairs the AI or Jev expect to edit the same code; `cleared` module overlaps Jev or the
 * AI judged harmless ("PR-1|PR-2|module"). Returns { conflicts, rounds, runNow, wait, noSpec,
 * alreadyRunning }.
 */
export function planParallel({
  tickets,
  specs = [],
  busy = [],
  likely = [],
  cleared = new Set<string>(),
  running = new Set<string>(),
}: {
  tickets: any[];
  specs?: any[];
  busy?: ReturnType<typeof busyFromJobs>;
  likely?: { a: string; b: string; why: string; source: 'jev' | 'ai' }[];
  cleared?: Set<string>;
  running?: Set<string>;
}) {
  const ids = new Set(tickets.map((t) => t.id));
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const BUSY = (id: string) => `busy:${id}`;
  // Compare as one batch: issues coded at the same time conflict whichever epic they belong to.
  const pool = [
    ...specs.filter((s) => ids.has(s.ticketId)).map((s) => ({ ...s, epicId: 'batch' })),
    ...busy.map((b) => ({
      ticketId: BUSY(b.ticketId),
      key: b.key,
      epicId: 'batch',
      status: 'busy',
      files: b.files.map((path) => ({ path })),
      modules: b.modules,
    })),
  ];
  const conflicts: Conflict[] = [];
  const keyFor = (id: string) =>
    id.startsWith('busy:')
      ? busy.find((b) => BUSY(b.ticketId) === id)?.key || id.slice(5)
      : keyOf(byId.get(id));
  for (const o of findOverlaps(pool)) {
    const inv = o.specs.map((s: any) => s.ticketId);
    if (!inv.some((x: string) => ids.has(x))) continue;
    const isJob = inv.some((x: string) => x.startsWith('busy:'));
    const sel = inv.filter((x: string) => ids.has(x)).map(keyFor);
    const allCleared = sel.every((a: string, i: number) =>
      sel
        .slice(i + 1)
        .every((b: string) => cleared.has(`${[a, b].sort().join('|')}|${o.target.toLowerCase()}`)),
    );
    const c: Conflict = {
      kind: isJob ? 'job' : o.kind,
      target: o.target,
      ticketIds: inv.map((x: string) => x.replace(/^busy:/, '')),
      keys: inv.map(keyFor),
      why: isJob
        ? `${inv
            .filter((x: string) => x.startsWith('busy:'))
            .map(keyFor)
            .join(
              ', ',
            )} ${busy.find((b) => inv.includes(BUSY(b.ticketId)))?.status === 'running' ? 'is being coded now' : 'has code not merged yet'} and also touches ${o.target}`
        : `both touch ${o.target} (${o.kind})`,
      source: isJob ? 'job' : 'spec',
    };
    if (o.kind === 'module' && !isJob && sel.length > 1 && allCleared) c.cleared = true;
    conflicts.push(c);
  }
  for (const l of likely) {
    if (!ids.has(l.a) || !ids.has(l.b)) continue;
    conflicts.push({
      kind: 'likely',
      target: '',
      ticketIds: [l.a, l.b],
      keys: [keyOf(byId.get(l.a)), keyOf(byId.get(l.b))],
      why: l.why || 'likely to edit the same code',
      source: l.source,
    });
  }
  // A selected issue blocked by another selected issue needs that one's code merged first.
  for (const t of tickets) {
    for (const lk of t.links || []) {
      const blocker = lk.type === 'is blocked by' ? lk.targetId : null;
      if (blocker && ids.has(blocker))
        conflicts.push({
          kind: 'blocked',
          target: '',
          ticketIds: [blocker, t.id],
          keys: [keyOf(byId.get(blocker)), keyOf(t)],
          why: `${keyOf(t)} is blocked by ${keyOf(byId.get(blocker))}`,
          source: 'link',
        });
    }
  }
  const active = conflicts.filter((c) => !c.cleared);
  // Rounds: each issue, in development order, goes to the first round where nothing it conflicts
  // with is running.
  const round = new Map<string, number>();
  const why = new Map<string, string[]>();
  for (const t of tickets) {
    if (running.has(t.id)) continue;
    let min = 0;
    const notes: string[] = [];
    const mine = active.filter((c) => c.ticketIds.includes(t.id));
    for (const c of mine) {
      if (c.kind === 'job') {
        min = Math.max(min, 1);
        notes.push(c.why);
      }
      if (c.kind === 'blocked' && c.ticketIds[1] === t.id && round.has(c.ticketIds[0])) {
        min = Math.max(min, (round.get(c.ticketIds[0]) as number) + 1);
        notes.push(c.why);
      }
    }
    const clash = (r: number) =>
      mine
        .filter((c) => c.kind !== 'job')
        .some((c) => c.ticketIds.some((o) => o !== t.id && round.get(o) === r));
    let r = min;
    while (clash(r)) r++;
    for (const c of mine)
      if (
        c.kind !== 'job' &&
        c.kind !== 'blocked' &&
        c.ticketIds.some((o) => o !== t.id && round.has(o) && (round.get(o) as number) < r)
      )
        notes.push(c.why);
    round.set(t.id, r);
    why.set(t.id, [...new Set(notes)]);
  }
  const n = Math.max(-1, ...round.values()) + 1;
  const rounds = Array.from({ length: n }, (_, i) =>
    tickets
      .filter((t) => round.get(t.id) === i)
      .map((t) => ({
        ticketId: t.id,
        key: keyOf(t),
        title: String(t.title || ''),
        round: i + 1,
        why: why.get(t.id) || [],
      })),
  );
  const afterOf = (t: any) => {
    const r = round.get(t.id) as number;
    return [
      ...new Set(
        active
          .filter((c) => c.ticketIds.includes(t.id) && c.kind !== 'job')
          .flatMap((c) =>
            c.ticketIds.filter((o) => o !== t.id && round.has(o) && (round.get(o) as number) < r),
          )
          .map((o) => keyOf(byId.get(o))),
      ),
    ];
  };
  const wait = tickets
    .filter((t) => (round.get(t.id) ?? 0) > 0)
    .map((t) => ({
      ticketId: t.id,
      key: keyOf(t),
      round: (round.get(t.id) as number) + 1,
      after: afterOf(t),
      why: (why.get(t.id) || []).join('; ') || 'shares code with an issue in an earlier round',
    }));
  return {
    conflicts,
    rounds,
    runNow: (rounds[0] || []).map((x) => x.ticketId),
    wait,
    noSpec: tickets
      .filter(
        (t) =>
          !specs.some(
            (s) => s.ticketId === t.id && ((s.files || []).length || (s.modules || []).length),
          ),
      )
      .map(keyOf),
    alreadyRunning: tickets.filter((t) => running.has(t.id)).map(keyOf),
  };
}

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
