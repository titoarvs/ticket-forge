import fs from 'node:fs/promises';
import path from 'node:path';
import { api, authed, HttpError } from '@/lib/server/http';
import { RUN_DIR } from '@/lib/automation.js';

// Screenshots from automated test runs (signed-in users only).
export const GET = api(async (_req, p) => {
  await authed();
  const name = path.basename(p.file);
  if (!/^[\w-]+\.(png|jpg)$/.test(name)) throw new HttpError(404, 'Not found');
  const buf = await fs.readFile(path.join(RUN_DIR, name)).catch(() => null);
  if (!buf) throw new HttpError(404, 'Not found');
  return new Response(buf, { headers: { 'Content-Type': name.endsWith('.jpg') ? 'image/jpeg' : 'image/png', 'Cache-Control': 'private, max-age=3600' } });
});
