// Development order: the order to build an epic's or a sprint's issues in. Hard rules come from the
// issues themselves (an issue that "is blocked by" another comes after it), then priority, what the
// other issues need first, the frontend / backend layer and story points decide among the issues
// that are free to start. Jev (Administration → AI → Decisions), when it is on, adds two small
// typed decisions per issue: which other issue it needs first (pick one) and how early it should be
// built (a 0-9 rating). What Jev isn't sure about goes to the AI; when the AI fails too, the rules
// alone decide. Nothing is saved here: the app shows the order and the person applies it to the
// backlog.
import { askJson } from './claude';
import { jevEnabled, jevStatus, jevDecide } from './jev';
export { applyOrder } from './reorder';

const clip = (s: any, n: number) => {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const PRIORITY: Record<string, number> = { Highest: 4, High: 3, Medium: 2, Low: 1, Lowest: 0 };
/**
 * At most this many issues are ordered at once (Jev's pick-one questions take up to 255 options).
 */
export const MAX_ORDER = 80;

/**
 * What the AI or Jev added for one issue: other issues it needs first (ids) and how early to build
 * it (0 last … 9 first).
 */
export type Hint = { prereqs?: string[]; urgency?: number; source?: 'jev' | 'ai'; why?: string };
export type Ordered = {
  ticketId: string;
  key: string;
  title: string;
  layer: string;
  priority: string;
  storyPoints: number | null;
  position: number;
  waitsFor: string[];
  unblocks: string[];
  suggestedWaitsFor: string[];
  reason: string;
  reasons: string[];
  source: string;
};

const keyOf = (t: any) => String(t.key || t.id);
const isDoneIn = (project: any, t: any) => {
  const cat = (project?.workflow || []).find((w: any) => w.name === t.status)?.category;
  return cat ? cat === 'done' : /^(done|closed|resolved)$/i.test(String(t.status || ''));
};

/**
 * The issues to order: the given ids (or an epic's or sprint's issues), top level only (a sub-task
 * goes with its parent), open ones in the order they now have in the backlog. Done issues are
 * returned apart.
 */
export function issuesFor(
  project: any,
  { ticketIds, epicId, sprintId }: { ticketIds?: string[]; epicId?: string; sprintId?: string },
) {
  const all: any[] = project?.tickets || [];
  const ids = Array.isArray(ticketIds) && ticketIds.length ? new Set(ticketIds.map(String)) : null;
  const picked = all.filter((t) =>
    ids ? ids.has(t.id) : epicId ? t.epicId === epicId : sprintId ? t.sprintId === sprintId : false,
  );
  const pickedIds = new Set(picked.map((t) => t.id));
  const top = picked.filter(
    (t) => !(t.parentId && pickedIds.has(t.parentId)) && !(epicId && !ids && t.parentId),
  );
  return {
    open: top.filter((t) => !isDoneIn(project, t)),
    done: top.filter((t) => isDoneIn(project, t)),
  };
}

/**
 * Hard dependencies inside the list, from the issues' links: { [ticketId]: Set of ticketIds it
 * waits for }.
 */
export function hardDeps(tickets: any[]) {
  const ids = new Set(tickets.map((t) => t.id));
  const deps: Record<string, Set<string>> = Object.fromEntries(
    tickets.map((t) => [t.id, new Set<string>()]),
  );
  for (const t of tickets) {
    for (const l of t.links || []) {
      if (!ids.has(l.targetId) || l.targetId === t.id) continue;
      if (l.type === 'is blocked by') deps[t.id].add(l.targetId);
      else if (l.type === 'blocks') deps[l.targetId].add(t.id);
    }
  }
  return deps;
}

/**
 * Can `to` already reach `from` through the dependencies (so adding from → to would make a loop)?
 */
function reaches(deps: Record<string, Set<string>>, start: string, goal: string) {
  const seen = new Set<string>(),
    stack = [start];
  while (stack.length) {
    const x = stack.pop() as string;
    if (x === goal) return true;
    if (seen.has(x)) continue;
    seen.add(x);
    for (const y of deps[x] || []) stack.push(y);
  }
  return false;
}

/**
 * The development order (pure: no database, no AI). `hints` are the AI's or Jev's suggestions per
 * ticket id; a suggested prerequisite that would make a loop with the links is ignored. Returns {
 * order, loops, outside }: order[i].reason is one short line for the screen; loops lists issues
 * whose links block each other; outside lists open blockers that aren't in the list.
 */
export function orderTickets(
  tickets: any[],
  {
    hints = {},
    project = null,
    all = null,
  }: { hints?: Record<string, Hint>; project?: any; all?: any[] | null } = {},
) {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const deps = hardDeps(tickets);
  const hard: Record<string, Set<string>> = Object.fromEntries(
    Object.entries(deps).map(([k, v]) => [k, new Set(v)]),
  );
  const suggested: Record<string, Set<string>> = Object.fromEntries(
    tickets.map((t) => [t.id, new Set<string>()]),
  );
  for (const t of tickets) {
    for (const p of hints[t.id]?.prereqs || []) {
      if (!byId.has(p) || p === t.id || deps[t.id].has(p) || reaches(deps, p, t.id)) continue;
      deps[t.id].add(p);
      suggested[t.id].add(p);
    }
  }
  // Open blockers outside the list: the issue can't really start until they're done.
  const everything = new Map((all || project?.tickets || []).map((t: any) => [t.id, t]));
  const outside: Record<string, string[]> = {};
  for (const t of tickets) {
    const out = (t.links || [])
      .filter((l: any) => l.type === 'is blocked by' && !byId.has(l.targetId))
      .map((l: any) => everything.get(l.targetId))
      .filter((x: any) => x && !isDoneIn(project, x));
    if (out.length) outside[t.id] = out.map(keyOf);
  }
  const dependents: Record<string, Set<string>> = Object.fromEntries(
    tickets.map((t) => [t.id, new Set<string>()]),
  );
  for (const [id, ds] of Object.entries(deps)) for (const d of ds) dependents[d].add(id);
  const downstream = (id: string) => {
    const seen = new Set<string>(),
      stack = [...dependents[id]];
    while (stack.length) {
      const x = stack.pop() as string;
      if (!seen.has(x)) {
        seen.add(x);
        stack.push(...dependents[x]);
      }
    }
    return seen.size;
  };
  const hasFrontend = tickets.some((t) => t.layer === 'frontend' || t.layer === 'both');
  const index = new Map(tickets.map((t, i) => [t.id, i]));
  const score = (t: any) => {
    const h = hints[t.id];
    const pts =
      Number.isFinite(Number(t.storyPoints)) && t.storyPoints != null
        ? Math.min(13, Number(t.storyPoints))
        : 3;
    return (
      (PRIORITY[t.priority] ?? 2) * 10 +
      downstream(t.id) * 8 +
      (hasFrontend ? (t.layer === 'backend' ? 6 : t.layer === 'both' ? 3 : 0) : 0) +
      (typeof h?.urgency === 'number' ? (h.urgency - 4.5) * 3 : 0) -
      pts * 0.5 -
      (outside[t.id] ? 15 : 0) -
      (index.get(t.id) as number) * 0.01
    );
  };
  const scores = new Map(tickets.map((t) => [t.id, score(t)]));
  const placed = new Set<string>(),
    order: any[] = [],
    loops: string[][] = [];
  while (order.length < tickets.length) {
    const left = tickets.filter((t) => !placed.has(t.id));
    const ready = left.filter((t) => [...deps[t.id]].every((d) => placed.has(d)));
    let next: any;
    if (ready.length)
      next = ready.reduce((a, b) =>
        (scores.get(b.id) as number) > (scores.get(a.id) as number) ? b : a,
      );
    else {
      // The links block each other: start with the most important issue of the loop, and say so.
      next = left.reduce((a, b) =>
        (scores.get(b.id) as number) > (scores.get(a.id) as number) ? b : a,
      );
      loops.push(
        left.filter((t) => reaches(hard, t.id, next.id) && reaches(hard, next.id, t.id)).map(keyOf),
      );
    }
    placed.add(next.id);
    order.push(next);
  }
  const names = (ids: Iterable<string>) => [...ids].map((x) => keyOf(byId.get(x)));
  const list = (ks: string[]) =>
    ks.length <= 3 ? ks.join(', ') : `${ks.slice(0, 3).join(', ')} and ${ks.length - 3} more`;
  const out: Ordered[] = order.map((t, i) => {
    const h = hints[t.id];
    const waits = names(hard[t.id]),
      sugg = names(suggested[t.id]),
      unblocks = names(dependents[t.id]);
    const reasons: string[] = [];
    if (unblocks.length)
      reasons.push(
        `${unblocks.length === 1 ? `${unblocks[0]} needs` : `${list(unblocks)} need`} it first`,
      );
    if (waits.length) reasons.push(`after ${list(waits)} (blocked by)`);
    if (sugg.length)
      reasons.push(`after ${list(sugg)} (${h?.source === 'jev' ? 'Jev' : 'AI'}: builds on it)`);
    if (outside[t.id]) reasons.push(`still blocked by ${list(outside[t.id])}, outside this list`);
    if (loops.some((l) => l.includes(keyOf(t))))
      reasons.push('its links block each other: check them');
    if (PRIORITY[t.priority] >= 3) reasons.push(`${t.priority} priority`);
    if (hasFrontend && t.layer === 'backend') reasons.push('backend: the screens build on it');
    else if (hasFrontend && t.layer === 'both') reasons.push('API and screen together');
    if (typeof h?.urgency === 'number' && (h.urgency >= 7 || h.urgency <= 2))
      reasons.push(
        `${h.source === 'jev' ? 'Jev' : 'AI'} rates it ${h.urgency >= 7 ? 'early' : 'late'} (${h.urgency}/9)`,
      );
    if (t.storyPoints != null && Number(t.storyPoints) <= 2)
      reasons.push(`small (${t.storyPoints} pt${Number(t.storyPoints) === 1 ? '' : 's'})`);
    else if (t.storyPoints != null && Number(t.storyPoints) >= 8)
      reasons.push(`large (${t.storyPoints} pts)`);
    if (!reasons.length) reasons.push(`no dependencies; ${t.priority || 'Medium'} priority`);
    const reason = reasons.join('; ');
    return {
      ticketId: t.id,
      key: keyOf(t),
      title: String(t.title || ''),
      layer: t.layer || '',
      priority: t.priority || 'Medium',
      storyPoints: t.storyPoints ?? null,
      position: i + 1,
      waitsFor: waits,
      unblocks,
      suggestedWaitsFor: sugg,
      reason: reason[0].toUpperCase() + reason.slice(1),
      reasons,
      source: h?.source || 'rules',
    };
  });
  return { order: out, loops: loops.filter((l) => l.length > 1), outside };
}

/** Where the decisions come from, so tests can stand in for Jev and the AI. */
export type Deciders = {
  jevOn?: () => Promise<boolean>;
  jevMin?: () => Promise<number>;
  jevDecide?: typeof jevDecide;
  askJson?: (o: any) => Promise<any>;
};
const realDeciders: Required<Deciders> = {
  jevOn: () => jevEnabled().catch(() => false),
  jevMin: async () => (await jevStatus()).minConfidence,
  jevDecide,
  askJson,
};

/**
 * The AI's or Jev's hints for the issues: { hints, engine: 'jev' | 'ai' | 'jev+ai' | 'rules',
 * byJev, note }.
 * Jev first (when on): one pick-one question (which listed issue it needs first, or none) and one
 * 0-9 rating per issue, 25 issues per call. Issues Jev isn't sure about go to the AI in one call.
 * When both fail the rules decide alone.
 */
export async function orderHints({
  project,
  tickets,
  ai = {},
  use,
}: {
  project: any;
  tickets: any[];
  ai?: any;
  use?: Deciders;
}) {
  const d = { ...realDeciders, ...(use || {}) };
  const hints: Record<string, Hint> = {};
  const byKey = new Map(tickets.map((t) => [keyOf(t), t]));
  let rest = tickets,
    byJev = 0,
    note = '';
  const describe = (t: any) => ({
    type: t.type,
    title: clip(t.title, 140),
    layer: t.layer || 'unknown',
    priority: t.priority || 'Medium',
    storyPoints: t.storyPoints ?? null,
    description: clip(t.description || t.userStory, 260),
    acceptanceCriteria: (t.acceptanceCriteria || []).slice(0, 3).map((a: any) => clip(a, 100)),
    blockedBy: (t.links || [])
      .filter((l: any) => l.type === 'is blocked by')
      .map((l: any) => keyOf(tickets.find((x) => x.id === l.targetId) || { id: l.targetId })),
  });
  if (tickets.length > 1 && (await d.jevOn())) {
    const min = await d.jevMin();
    const left: any[] = [];
    const issues = Object.fromEntries(tickets.map((t) => [keyOf(t), describe(t)]));
    for (let i = 0; i < tickets.length; i += 25) {
      const chunk = tickets.slice(i, i + 25);
      try {
        const questions: Record<string, any> = {};
        for (const t of chunk) {
          const others = tickets.filter((x) => x.id !== t.id).slice(0, 250);
          questions[`${keyOf(t)}.needs`] = {
            type: 'choice',
            instructions: `Which other listed issue must be built before ${keyOf(t)} can be built (it uses its data, API, screen or setup)? Choose "none" when it can start on its own.`,
            criteria: {
              none: 'it needs no other listed issue first',
              ...Object.fromEntries(others.map((x) => [keyOf(x), clip(x.title, 120)])),
            },
          };
          questions[`${keyOf(t)}.early`] = {
            type: 'score',
            instructions: `How early in development should ${keyOf(t)} be built? 0 = last, 9 = first.`,
            criteria: [
              'other issues build on it (data model, API, shared setup)',
              'it removes risk or unknowns early',
              'it is high priority for users',
              'it is a polish or follow-up task (later)',
            ],
          };
        }
        const r = await d.jevDecide({ state: { project: project?.name, issues }, questions });
        for (const t of chunk) {
          const need: any = r.answers[`${keyOf(t)}.needs`],
            early: any = r.answers[`${keyOf(t)}.early`];
          const needOk =
            need?.choice &&
            (need.confidence ?? 0) >= min &&
            (need.choice === 'none' || byKey.has(need.choice));
          const earlyOk = typeof early?.score === 'number' && (early.confidence ?? 0) >= min;
          if (!needOk || !earlyOk) {
            left.push(t);
            continue;
          }
          hints[t.id] = {
            source: 'jev',
            prereqs: need.choice === 'none' ? [] : [byKey.get(need.choice).id],
            urgency: Math.max(0, Math.min(9, Math.round(early.score))),
          };
          byJev++;
        }
      } catch (e: any) {
        left.push(...chunk);
        note = `Jev: ${e.message}`;
      }
    }
    rest = left;
  }
  let byAi = 0;
  if (rest.length && tickets.length > 1) {
    try {
      const res = await d.askJson({
        ...ai,
        task: 'quick',
        reasoning: 'fast',
        system: `You are a tech lead planning the order to build issues in. For each issue in "Decide for", say which OTHER listed issues
must be built before it (it uses their data, API, screen or setup; not merely related), and how early it should be built:
0 = last (polish, follow-ups), 9 = first (foundations other issues build on, risky unknowns). Use only keys from the list.
Return JSON only: { "items": [ { "key": "PR-1", "needsFirst": ["PR-2"], "urgency": 0-9, "why": "short reason" } ] }`,
        prompt: `Project: ${project?.name || ''}
All issues:
${tickets.map((t) => `- ${keyOf(t)} [${t.type || 'Story'}${t.layer ? `, ${t.layer}` : ''}, ${t.priority || 'Medium'}${t.storyPoints != null ? `, ${t.storyPoints} pts` : ''}] ${clip(t.title, 140)}${t.description ? ` | ${clip(t.description, 220)}` : ''}`).join('\n')}

Decide for: ${rest.map(keyOf).join(', ')}`,
      });
      for (const it of res?.items || []) {
        const t = byKey.get(String(it.key));
        if (!t || !rest.includes(t) || hints[t.id]) continue;
        const u = Number(it.urgency);
        hints[t.id] = {
          source: 'ai',
          prereqs: (Array.isArray(it.needsFirst) ? it.needsFirst : [])
            .map((k: any) => byKey.get(String(k))?.id)
            .filter((x: any) => x && x !== t.id),
          urgency: Number.isFinite(u) ? Math.max(0, Math.min(9, Math.round(u))) : undefined,
          why: clip(it.why, 160),
        };
        byAi++;
      }
    } catch (e: any) {
      note = [note, `AI: ${e.message}`].filter(Boolean).join(' · ');
    }
  }
  const engine = byJev && byAi ? 'jev+ai' : byJev ? 'jev' : byAi ? 'ai' : 'rules';
  return { hints, engine, byJev, byAi, note };
}

/**
 * The suggested development order of an epic's or sprint's issues (or the given ids), with a reason
 * per issue. { order, done, loops, engine, byJev, byAi, note, summary }.
 */
export async function planOrder({
  project,
  ticketIds,
  epicId,
  sprintId,
  ai = {},
  smart = true,
  use,
}: any) {
  const { open, done } = issuesFor(project, { ticketIds, epicId, sprintId });
  if (!open.length)
    throw Object.assign(
      new Error(
        done.length
          ? 'Every issue here is done: nothing left to order.'
          : 'There are no issues to order here.',
      ),
      { status: 400 },
    );
  if (open.length > MAX_ORDER)
    throw Object.assign(
      new Error(
        `That’s ${open.length} open issues; order at most ${MAX_ORDER} at once (pick a smaller epic or sprint).`,
      ),
      { status: 400 },
    );
  const h = smart
    ? await orderHints({ project, tickets: open, ai, use })
    : { hints: {}, engine: 'rules', byJev: 0, byAi: 0, note: '' };
  const { order, loops } = orderTickets(open, { hints: h.hints, project });
  const by = { jev: 'Jev', ai: 'the AI', 'jev+ai': 'Jev and the AI', rules: 'the rules' }[
    h.engine as 'jev'
  ];
  const summary = `${order.length} issue${order.length === 1 ? '' : 's'} ordered by links, priority, layer and size${h.engine === 'rules' ? '' : `, with hints from ${by}${h.byJev ? ` (Jev decided ${h.byJev})` : ''}`}.${loops.length ? ` ${loops.length} set${loops.length === 1 ? '' : 's'} of issues block each other.` : ''}`;
  return {
    order,
    done: done.map((t: any) => ({ ticketId: t.id, key: keyOf(t), title: t.title })),
    loops,
    engine: h.engine,
    byJev: h.byJev,
    byAi: h.byAi,
    note: h.note,
    summary,
  };
}
