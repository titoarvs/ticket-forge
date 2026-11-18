// Screenshots of failed automated tests, stored in the database (Supabase) so they survive restarts and work
// on any server. Row-level security limits them to people with access to the project. The last few failures
// per test case are kept; passing runs store nothing.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { orm, screenshots, eq, and, notInArray, desc } from './orm';
import { checkLimit } from './limits';

const KEEP_PER_TEST = 5;
const MAX_BYTES = 3 * 1024 * 1024;

/** Saves a failure screenshot from a local file and returns its URL; removes the local file either way. */
export async function saveFailureShot({ file, projectId, issueId, tcId, error, user }: any) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    const data = fs.readFileSync(file);
    if (!data.length || data.length > MAX_BYTES) return null;
    if (
      await checkLimit('storageMb', data.length).then(
        () => false,
        () => true,
      )
    )
      return null; // storage full: keep the result, skip the picture
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const mime = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';
    await orm.insert(screenshots).values({
      id,
      projectId,
      issueId: issueId || null,
      tcId,
      status: 'Fail',
      error: String(error || '').slice(0, 2000),
      mime,
      bytes: data.length,
      data,
      createdBy: user?.name || null,
    });
    // Keep only the latest few per test case.
    const ofTest = and(eq(screenshots.projectId, projectId), eq(screenshots.tcId, tcId));
    const latest = orm
      .select({ id: screenshots.id })
      .from(screenshots)
      .where(ofTest)
      .orderBy(desc(screenshots.createdAt))
      .limit(KEEP_PER_TEST);
    await orm.delete(screenshots).where(and(ofTest, notInArray(screenshots.id, latest)));
    return `/api/screenshots/${id}`;
  } finally {
    if (file) fs.rm(file, { force: true }, () => {});
  }
}

/** One screenshot (row-level security decides whether this user may see it). */
export async function getShot(id): Promise<any> {
  const [row] = await orm
    .select({ id: screenshots.id, projectId: screenshots.projectId, mime: screenshots.mime, data: screenshots.data })
    .from(screenshots)
    .where(eq(screenshots.id, id));
  return row || null;
}

/** Earlier failures for a test case, newest first (no image data). */
export async function listShots(projectId, tcId) {
  // The keys stay snake_case: they are what the browser receives.
  const rows = await orm
    .select({
      id: screenshots.id,
      tc_id: screenshots.tcId,
      issue_id: screenshots.issueId,
      error: screenshots.error,
      bytes: screenshots.bytes,
      created_by: screenshots.createdBy,
      created_at: screenshots.createdAt,
    })
    .from(screenshots)
    .where(tcId ? and(eq(screenshots.projectId, projectId), eq(screenshots.tcId, tcId)) : eq(screenshots.projectId, projectId))
    .orderBy(desc(screenshots.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r, url: `/api/screenshots/${r.id}` }));
}

export async function deleteProjectShots(projectId) {
  await orm.delete(screenshots).where(eq(screenshots.projectId, projectId));
}
