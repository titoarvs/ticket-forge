import { findOverlaps } from '../specs';

export const clip = (s: any, n: number) => {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
export const keyOf = (t: any) => String(t.key || t.ticketKey || t.id || t.ticketId);
export const LIVE = ['starting', 'queued', 'running'];
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
