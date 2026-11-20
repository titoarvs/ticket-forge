import { q } from '../db';

export async function listActivity(id, { before = null, limit = 300 }: any = {}) {
  const n = Math.min(Math.max(Number(limit) || 300, 1), 1000);
  const rows = before
    ? (
        await q(
          'select id, at, author, kind, target, text from activity where project_id = $1 and at < $2 order by at desc limit $3',
          [id, before, n],
        )
      ).rows
    : (
        await q(
          'select id, at, author, kind, target, text from activity where project_id = $1 order by at desc limit $2',
          [id, n],
        )
      ).rows;
  return rows.map((r) => ({ ...r, id: String(r.id) }));
}
