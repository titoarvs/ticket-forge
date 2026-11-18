import fs from 'node:fs/promises';
import path from 'node:path';
import { api, authed, HttpError } from '@/lib/server/http';
import { RUN_DIR, runPrefix } from '@/lib/automation';

// Screenshots from automated test runs: signed-in people, and only their own workspace's (see runPrefix).
export const GET = api(async (_req, p) => {
  const u: any = await authed();
  const name = path.basename(p.file);
  if (!/^[\w-]+\.(png|jpg)$/.test(name)) throw new HttpError(404, 'Not found');
  const mine = runPrefix(u.workspace_id);
  if (mine ? !name.startsWith(mine) : name.includes('--')) throw new HttpError(404, 'Not found');
  const buf = await fs.readFile(path.join(RUN_DIR, name)).catch(() => null);
  if (!buf) throw new HttpError(404, 'Not found');
  return new Response(buf, {
    headers: { 'Content-Type': name.endsWith('.jpg') ? 'image/jpeg' : 'image/png', 'Cache-Control': 'private, max-age=3600' },
  });
});
