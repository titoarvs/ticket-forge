import { api, perm, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { listEnvs, saveEnv, removeEnv, testEnv, ENGINES, KINDS } from '@/lib/appdb';

// Project settings → Database: the databases of the app this project builds. Connection strings go in, but never come
// back out: responses show host, port, database, user and the last test only.
const allowed = async (projectId: string) => {
  const user = await perm('project.database');
  store.requireAccess(user, projectId);
  return user;
};

export const GET = api(async (_req, p) => {
  await allowed(p.id);
  return { envs: await listEnvs(p.id), engines: ENGINES, kinds: KINDS };
});

// { action: 'save', id?, name, kind, engine, url? } · { action: 'test', id } · { action: 'remove', id }
export const POST = api(async (req, p) => {
  const user = await allowed(p.id);
  const b = await body(req);
  const id = String(b.id || '');
  if (id && !/^[\w-]{1,64}$/.test(id)) throw new HttpError(400, 'Which connection?');
  if (b.action === 'save') {
    const env = await saveEnv(p.id, { id: id || undefined, name: b.name, kind: b.kind, engine: b.engine, url: b.url }, user);
    return { env, envs: await listEnvs(p.id) };
  }
  if (!id) throw new HttpError(400, 'Which connection?');
  if (b.action === 'test') return { env: await testEnv(p.id, id, user), envs: await listEnvs(p.id) };
  if (b.action === 'remove') { await removeEnv(p.id, id); return { envs: await listEnvs(p.id) }; }
  throw new HttpError(400, 'Unknown action');
});
