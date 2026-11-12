import { api, authed, body, HttpError, aiOpts, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { SERVERLESS, currentContext } from '@/lib/db.js';
import { buildAppContext } from '@/lib/appcontext.js';
import { execFile } from 'node:child_process';

// Project settings → App context: build the project's app-knowledge brief (from the code when a local repository is
// set, else from the project). The app shows it for review and saves it on the project. GET: is it out of date?
const head = (dir: string) => new Promise<string | null>((resolve) => execFile('git', ['rev-parse', 'HEAD'], { cwd: dir, timeout: 8000 }, (e, out) => resolve(e ? null : String(out).trim())));
const localDir = (project: any) => (!SERVERLESS && (currentContext() as any).local ? String(project.dev?.localPath || '').trim() : '');

export const GET = api(async (_req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  const project = await store.getProject(p.id);
  const dir = localDir(project);
  return { head: dir ? await head(dir) : null, local: Boolean(dir) };
});

export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  if (!store.has(user, 'ai.use') || !store.has(user, 'project.settings')) throw new HttpError(403, 'Building the app context needs the AI and Project settings permissions.');
  const b = await body(req);
  const project = await store.getProject(p.id);
  const dir = b.useCode === false ? '' : localDir(project);
  const backendDir = dir && project.devBackend?.enabled ? String(project.devBackend.localPath || '').trim() : '';
  return ndjson(req, async (send, signal) => {
    const say = (message: string) => send({ type: 'progress', message });
    send({ type: 'done', context: await buildAppContext({ project, dir, backendDir, ai: { ...aiOpts(b), signal, fresh: true }, emit: say }) });
  });
});
