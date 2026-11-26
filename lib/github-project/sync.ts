// Reading the linked GitHub Project board into the tickets: Status, Priority, story points and
// Sprint ← Iteration. Import-only: nothing is ever written to the board (no item added, no field
// set). It runs after the issues import (lib/github-sync.ts) with the same rule: a field changed on
// the board since the last import is copied onto the ticket; a field changed only in Ticket Forge
// stays as it is there; changed on both, the newer change wins and the ticket's activity records
// the conflict. `base` (ticket.github.board.base) is what the board had at the last import.
import { q, tx } from '../db';
import { noteVersion } from '../store';
import { insertVersions } from '../store/patch-project';
import { uid } from '../model';
import { readBoard, readItems, type Board, type Values } from './board';
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

type Ctx = { board: Board; workflow: any[]; sprints: any[]; plan: Plan };
type Run = { user: any; projectId: string; link: any; token: string; plan: Plan };

/** One ticket against its board item: what to copy from the board, and the new common ground. */
function planTicket(c: Ctx, t: any, item: any) {
  const tf: any = ticketValues(c.board, t, c.workflow, c.sprints);
  const fields = FIELDS.filter((f) => tf[f] !== undefined);
  const gh: any = item.values;
  const base = t.github.board?.itemId === item.id ? t.github.board.base : firstBase(tf, gh);
  const tfTime = Date.parse(t.updatedAt) || 0;
  const p = c.plan({ tf, base, gh, tfTime, ghTime: Date.parse(item.updatedAt) || 0 }, fields);
  // What the board has now becomes the common ground; a Ticket Forge change stays in Ticket Forge.
  return { apply: p.apply, conflicts: p.conflicts, base: { ...gh } };
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
 * Reads the linked board into the tickets. Adds to `result`: board { title, updated, conflicts } and
 * errors. `plan` is the issues import's conflict rule (planFields), so both follow one rule. Issues
 * that aren't on the board are skipped: they are never added to it.
 */
export async function syncBoard(run: Run, result: any) {
  const { user, projectId, link, token, plan } = run;
  const board = await readBoard(token, link.project.id);
  const items = await readItems(token, board, link.repo);
  const data =
    (await q('select data from projects where id = $1', [projectId])).rows[0]?.data || {};
  const c: Ctx = {
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
  const out = { updated: 0, conflicts: 0 };
  const changes: any[] = [];
  for (const { id, data: t } of tickets) {
    const item: any = items.get(Number(t.github.number));
    if (!item) continue;
    const r = planTicket(c, t, item);
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
