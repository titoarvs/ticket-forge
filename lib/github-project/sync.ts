// Two-way sync between tickets and the linked GitHub Project board: Status, Priority, story points
// and Sprint ↔ Iteration. It runs after the issues sync (lib/github-sync.ts) with the same rule:
// a field changed on one side is copied to the other; changed on both, the newer change wins and
// the ticket's activity records the conflict. `base` (ticket.github.board.base) is what both sides
// had at the last sync. An import only reads; a sync also adds missing issues to the board and
// writes Ticket Forge's changes to it. GitHub calls happen first, then one save.
import { q, tx } from '../db';
import { noteVersion } from '../store';
import { insertVersions } from '../store/patch-project';
import { uid } from '../model';
import { readBoard, readItems, addItem, setValues, type Board, type Values } from './board';
import { ticketValues, applyValues } from './values';

const FIELDS = ['status', 'priority', 'points', 'sprint'] as const;
const LABEL: Record<string, string> = {
  status: 'status',
  priority: 'priority',
  points: 'story points',
  sprint: 'sprint',
};
type Plan = (
  v: { tf: any; base: any; gh: any; tfTime: number; ghTime: number },
  fields: string[],
) => any;

/** The common ground before a ticket's first board sync: the board wins where it has a value. */
const firstBase = (tf: any, gh: any) =>
  Object.fromEntries(
    FIELDS.map((f) => [
      f,
      gh[f] === '' || gh[f] === null ? gh[f] : tf[f] === undefined ? gh[f] : tf[f],
    ]),
  );

const defined = (v: any) =>
  Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));

type Ctx = {
  board: Board;
  workflow: any[];
  sprints: any[];
  token?: string;
  write?: boolean;
  plan?: Plan;
};
type Run = { user: any; projectId: string; link: any; token: string; mode: string; plan: Plan };

/** Adds a new issue to the board with the ticket's values. Returns `ticket.github.board`. */
export async function addToBoard(
  token: string,
  boardId: string,
  nodeId: string,
  t: any,
  data: any,
) {
  const board = await readBoard(token, boardId);
  const workflow = data?.workflow?.length ? data.workflow : [{ name: 'To Do', category: 'todo' }];
  const item = await addItem(token, board, nodeId);
  const status = t.status || workflow[0].name;
  const values = defined(ticketValues(board, { ...t, status }, workflow, data?.sprints || []));
  await setValues(token, board, item.id, values);
  return {
    itemId: item.id,
    base: { ...item.values, ...values },
    syncedAt: new Date().toISOString(),
  };
}

/** One ticket against its board item: what to copy, what to write, the new common ground. */
async function planTicket(c: Ctx, t: any, item: any) {
  const tf: any = ticketValues(c.board, t, c.workflow, c.sprints);
  const fields = FIELDS.filter((f) => tf[f] !== undefined);
  const gh: any = item.values;
  const base = t.github.board?.itemId === item.id ? t.github.board.base : firstBase(tf, gh);
  const tfTime = Date.parse(t.updatedAt) || 0;
  const p = c.plan!({ tf, base, gh, tfTime, ghTime: Date.parse(item.updatedAt) || 0 }, fields);
  let pushed: any = {};
  let error = '';
  if (c.write && Object.keys(p.push).length) {
    try {
      await setValues(c.token!, c.board, item.id, p.push);
      pushed = p.push;
    } catch (e: any) {
      error = `${t.key}: ${e.message}`;
    }
  }
  const next: any = { ...gh };
  for (const f of Object.keys(p.push)) next[f] = f in pushed ? pushed[f] : base?.[f];
  return { apply: p.apply, conflicts: p.conflicts, pushed, error, base: next };
}

/** Saves the board side onto the tickets, in one project version. */
async function saveTickets(user: any, projectId: string, c: Ctx, changes: any[]) {
  const now = new Date().toISOString();
  const version = await tx(async (t) => {
    const pr = (
      await t.query(
        'update projects set version = version + 1, updated_at = now() where id = $1 and archived_at is null returning version',
        [projectId],
      )
    ).rows[0];
    if (!pr) return null;
    const moved: any[] = [];
    for (const ch of changes) {
      const row = (
        await t.query('select data from issues where project_id = $1 and id = $2', [
          projectId,
          ch.id,
        ])
      ).rows[0];
      if (!row) continue;
      const d = JSON.parse(JSON.stringify(row.data));
      const changed = applyValues(d, ch.apply, c.board, c.workflow, c.sprints);
      const note = (text: string) =>
        (d.history ??= []).push({ id: uid(), at: now, author: 'GitHub', field: 'event', text });
      if (changed.length) {
        d.updatedAt = ch.itemUpdatedAt || now;
        note(`updated from the GitHub Project: ${changed.map((f) => LABEL[f]).join(', ')}`);
      }
      if (ch.conflicts.length)
        note(
          `GitHub Project sync conflict: ${ch.conflicts.map((x: any) => `${LABEL[x.field]} (${x.winner} won)`).join(', ')}. Both sides changed it; the newer change wins.`,
        );
      d.github = { ...d.github, board: { itemId: ch.itemId, base: ch.base, syncedAt: now } };
      await t.query(
        'update issues set data = $3, updated_by = $4, updated_at = now(), rev = $5 where project_id = $1 and id = $2',
        [projectId, ch.id, JSON.stringify(d), user.id, pr.version],
      );
      if (row.data.status !== d.status) moved.push({ id: d.id, data: d });
    }
    if (moved.length) await insertVersions(t, projectId, moved, user);
    return pr.version;
  });
  if (version) noteVersion(projectId, version);
}

/**
 * Syncs the linked board. Adds to `result`: board { added, updated, pushed, conflicts } and errors.
 * `plan` is the issues sync's conflict rule (planSync), so both follow one rule.
 */
export async function syncBoard(run: Run, result: any) {
  const { user, projectId, link, token, mode, plan } = run;
  const board = await readBoard(token, link.project.id);
  const items = await readItems(token, board, link.repo);
  const data =
    (await q('select data from projects where id = $1', [projectId])).rows[0]?.data || {};
  const write = mode === 'sync';
  const c: Ctx = {
    token,
    write,
    plan,
    board,
    workflow: data.workflow?.length ? data.workflow : [{ name: 'To Do', category: 'todo' }],
    sprints: Array.isArray(data.sprints) ? data.sprints : [],
  };
  const tickets = (
    await q("select id, data from issues where project_id = $1 and data->'github'->>'repo' = $2", [
      projectId,
      link.repo,
    ])
  ).rows;
  const out = { added: 0, updated: 0, pushed: 0, conflicts: 0 };
  const changes: any[] = [];
  for (const { id, data: t } of tickets) {
    let item: any = items.get(Number(t.github.number));
    if (!item && write && t.github.nodeId) {
      try {
        item = await addItem(token, board, t.github.nodeId);
        out.added++;
      } catch (e: any) {
        result.errors.push(`${t.key}: ${e.message}`);
      }
    }
    if (!item) continue;
    const r = await planTicket(c, t, item);
    if (r.error) result.errors.push(r.error);
    if (Object.keys(r.pushed).length) out.pushed++;
    if (Object.keys(r.apply).length) out.updated++;
    out.conflicts += r.conflicts.length;
    const same = JSON.stringify(t.github.board?.base) === JSON.stringify(r.base);
    if (
      Object.keys(r.apply).length ||
      r.conflicts.length ||
      !same ||
      t.github.board?.itemId !== item.id
    )
      changes.push({ id, itemId: item.id, itemUpdatedAt: item.updatedAt, ...r });
  }
  if (changes.length) await saveTickets(user, projectId, c, changes);
  result.board = { title: board.title, ...out };
  return result;
}

export type { Values };
