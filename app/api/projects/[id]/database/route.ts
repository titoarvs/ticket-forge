import { api, perm, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { listEnvs, saveEnv, removeEnv, testEnv, readSchema, ENGINES, KINDS } from '@/lib/appdb';
import { readFromRepo, makeSnapshot } from '@/lib/dbschema';
import { localReader, githubReader } from '@/lib/codebase';
import { withMyLocal } from '@/lib/mylocal';
import { getProjectSecret } from '@/lib/secrets';
import { SERVERLESS, currentContext } from '@/lib/db';

/**
 * Readers for the project's repositories, backend first (that's where schemas usually live): the folder on this
 * computer when TicketForge is opened at localhost, otherwise the GitHub repository.
 */
async function repoReaders(project: any, projectId: string) {
  const local = !SERVERLESS && Boolean((currentContext() as any).local);
  const mine = local ? await withMyLocal(project) : project;
  const sides = [project.devBackend?.enabled ? mine.devBackend : null, mine.dev].filter(Boolean);
  const out: any[] = [];
  for (const dev of sides) {
    if (local && dev.localPath) { try { out.push(localReader(dev.localPath)); continue; } catch { /* folder gone: try GitHub */ } }
    if (dev.repo && (!dev.provider || dev.provider === 'GitHub')) out.push(await githubReader(dev.repo, { branch: dev.baseBranch || '', token: await getProjectSecret(projectId, 'githubToken') }));
  }
  if (!out.length) throw new HttpError(400, 'No repository is set up for this project. Connect one in Code & GitHub, or read the schema from a database connection.');
  return out;
}

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
// { action: 'readSchema', id } or { action: 'readSchema', source: 'repo' } · { action: 'clearSchema' }
export const POST = api(async (req, p) => {
  const user = await allowed(p.id);
  const b = await body(req);
  const id = String(b.id || '');
  if (id && !/^[\w-]{1,64}$/.test(id)) throw new HttpError(400, 'Which connection?');
  if (b.action === 'save') {
    const env = await saveEnv(p.id, { id: id || undefined, name: b.name, kind: b.kind, engine: b.engine, url: b.url }, user);
    return { env, envs: await listEnvs(p.id) };
  }
  // The schema: from a connection (id) or from the repository's schema files (source: 'repo'). Saved on the project as
  // dbSchema, so every AI prompt can use it, and the change shows in the project's Activity.
  if (b.action === 'readSchema') {
    const project = await store.getProject(p.id);
    const read = b.source === 'repo' ? await readFromRepo(await repoReaders(project, p.id)) : id ? await readSchema(p.id, id) : null;
    if (!read) throw new HttpError(400, 'Choose a connection or the repository to read the schema from.');
    const schema = makeSnapshot(read, project.dbSchema, user);
    await store.patchProject(p.id, { meta: { dbSchema: schema } }, user);
    return { schema };
  }
  if (b.action === 'clearSchema') {
    await store.patchProject(p.id, { meta: { dbSchema: null } }, user);
    return { schema: null };
  }
  if (!id) throw new HttpError(400, 'Which connection?');
  if (b.action === 'test') return { env: await testEnv(p.id, id, user), envs: await listEnvs(p.id) };
  if (b.action === 'remove') { await removeEnv(p.id, id); return { envs: await listEnvs(p.id) }; }
  throw new HttpError(400, 'Unknown action');
});
