// Screenshots of failed automated tests, stored in the database (Supabase) so they survive restarts and work
// on any server. Row-level security limits them to people with access to the project. The last few failures
// per test case are kept; passing runs store nothing.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { q } from './db';
import { checkLimit } from './limits';

export const KEEP_PER_TEST = 5;
const MAX_BYTES = 3 * 1024 * 1024;

/** Saves a failure screenshot from a local file and returns its URL; removes the local file either way. */
export async function saveFailureShot({ file, projectId, issueId, tcId, error, user }: any) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    const data = fs.readFileSync(file);
    if (!data.length || data.length > MAX_BYTES) return null;
    if (await checkLimit('storageMb', data.length).then(() => false, () => true)) return null; // storage full: keep the result, skip the picture
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const mime = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';
    await q('insert into screenshots (id, project_id, issue_id, tc_id, status, error, mime, bytes, data, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, projectId, issueId || null, tcId, 'Fail', String(error || '').slice(0, 2000), mime, data.length, data, user?.name || null]);
    // Keep only the latest few per test case.
    await q(`delete from screenshots where project_id = $1 and tc_id = $2 and id not in (
      select id from screenshots where project_id = $1 and tc_id = $2 order by created_at desc limit ${KEEP_PER_TEST})`, [projectId, tcId]);
    return `/api/screenshots/${id}`;
  } finally {
    if (file) fs.rm(file, { force: true }, () => {});
  }
}

/** One screenshot (row-level security decides whether this user may see it). */
export async function getShot(id) {
  return (await q('select id, project_id, mime, data from screenshots where id = $1', [id])).rows[0] || null;
}

/** Earlier failures for a test case, newest first (no image data). */
export async function listShots(projectId, tcId) {
  const { rows } = await q('select id, tc_id, issue_id, error, bytes, created_by, created_at from screenshots where project_id = $1 and ($2::text is null or tc_id = $2) order by created_at desc limit 200', [projectId, tcId || null]);
  return rows.map((r) => ({ ...r, url: `/api/screenshots/${r.id}` }));
}

export async function deleteProjectShots(projectId) {
  await q('delete from screenshots where project_id = $1', [projectId]);
}
