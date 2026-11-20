import { api, authed, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import {
  listEnvs,
  saveEnv,
  removeEnv,
  testEnv,
  readSchema,
  getMine,
  setMine,
  getSetup,
  saveSetup,
  MINE,
  ENGINES,
  KINDS,
  SETUP_KINDS,
} from '@/lib/appdb';
import { readFromRepo, makeSnapshot } from '@/lib/dbschema';
import { repoReaders, isLocalRequest } from '@/lib/repo-readers';
import { consume } from '@/lib/limits';

// Project settings → Database: the databases of the app this project builds. Connection strings go
// in, but never come back out: responses show host, port, database, user and the last test only.
// The project's connections, schema and test setup need the Set up the database permission. Your
// own database (a Postgres on your computer, used instead of the project's Test one) is yours:
// anyone with access to the project can set it up, like their own repository folder, when
// TicketForge is opened at localhost.
const PERSONAL = new Set(['setMine', 'testMine']);

export const GET = api(async (_req, p) => {
  const user: any = await authed();
  store.requireAccess(user, p.id);
  const manage = store.has(user, 'project.database');
  return {
    manage,
    local: isLocalRequest(),
    mine: await getMine(p.id, user.id),
    ...(manage
      ? { envs: await listEnvs(p.id), setup: await getSetup(p.id) }
      : { envs: [], setup: null }),
    engines: ENGINES,
    kinds: KINDS,
    setupKinds: SETUP_KINDS,
  };
});

// { action: 'save', id?, name, kind, engine, url? } · { action: 'test', id } · { action: 'remove',
// id } { action: 'readSchema', id } or { action: 'readSchema', source: 'repo' } · { action:
// 'clearSchema' } { action: 'saveSetup', kind, value } · { action: 'setMine', url } (empty url
// forgets it) · { action: 'testMine' }
export const POST = api(async (req, p) => {
  const user: any = await authed();
  store.requireAccess(user, p.id);
  const b = await body(req);
  if (PERSONAL.has(b.action)) {
    if (!isLocalRequest())
      throw new HttpError(
        400,
        'Your own database can be set up only when TicketForge runs on your computer (opened at localhost).',
      );
    if (b.action === 'setMine') return { mine: await setMine(p.id, b.url, user, b.engine) };
    return { mine: await testEnv(p.id, MINE, user) };
  }
  if (!store.has(user, 'project.database'))
    throw new HttpError(
      403,
      'Changing the project’s databases needs the Set up the database permission.',
    );
  const id = String(b.id || '');
  if (id && !/^[\w-]{1,64}$/.test(id)) throw new HttpError(400, 'Which connection?');
  // Changes to the project's connections and test setup go on its Activity timeline (never the
  // connection string).
  const log = (text: string) => store.logActivity(p.id, user, 'settings', text).catch(() => {});
  if (b.action === 'save') {
    const env = await saveEnv(
      p.id,
      { id: id || undefined, name: b.name, kind: b.kind, engine: b.engine, url: b.url },
      user,
    );
    await log(
      id
        ? `changed database connection “${env.name}”${b.url ? ' (new connection string)' : ''}`
        : `added ${KINDS[env.kind]} database connection “${env.name}” (${ENGINES[env.engine]})`,
    );
    return { env, envs: await listEnvs(p.id) };
  }
  if (b.action === 'saveSetup') {
    const setup = await saveSetup(p.id, { kind: b.kind, value: b.value }, user);
    await log(
      setup.kind === 'none'
        ? 'turned off the step before each test run'
        : `set the step before each test run to ${setup.kind === 'sql' ? `the SQL file ${setup.value}` : `npm run ${setup.value}`}`,
    );
    return { setup };
  }
  // The schema: from a connection (id) or from the repository's schema files (source: 'repo').
  // Saved on the project as dbSchema, so every AI prompt can use it, and the change shows in the
  // project's Activity.
  if (b.action === 'readSchema') {
    if (b.source !== 'repo' && !id)
      throw new HttpError(400, 'Choose a connection or the repository to read the schema from.');
    const project = await store.getProject(p.id);
    const giveBack = await consume('schemaReads'); // a read that fails doesn't count
    let read: any;
    try {
      read =
        b.source === 'repo'
          ? await readFromRepo(await repoReaders(project))
          : await readSchema(p.id, id, user.id);
    } catch (e) {
      giveBack();
      throw e;
    }
    const schema = makeSnapshot(read, project.dbSchema, user);
    await store.patchProject(p.id, { meta: { dbSchema: schema } }, user);
    return { schema };
  }
  if (b.action === 'clearSchema') {
    await store.patchProject(p.id, { meta: { dbSchema: null } }, user);
    return { schema: null };
  }
  if (!id) throw new HttpError(400, 'Which connection?');
  if (b.action === 'test')
    return { env: await testEnv(p.id, id, user), envs: await listEnvs(p.id) };
  if (b.action === 'remove') {
    const name = await removeEnv(p.id, id);
    await log(`removed database connection “${name}”`);
    return { envs: await listEnvs(p.id) };
  }
  throw new HttpError(400, 'Unknown action');
});
