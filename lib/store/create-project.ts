import zlib from 'node:zlib';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import { qs, currentWs, q, DEFAULT_WS, tx } from '../db';
import { HttpError, verifyPassword } from '../auth';
import { checkLimit } from '../limits';

const TICKETS = 'tickets';
// testRepo: the Xray-style test repository, plans and executions (Test management). Testers and
// editors may change it.
export const META_PERM = {
  epics: ['epic.manage'],
  sprints: ['sprint.manage'],
  releases: ['sprint.manage', 'project.settings'],
  sources: ['issue.create', 'project.settings'],
  testRepo: ['test.run', 'issue.edit'],
  dbSchema: ['project.database'],
};
export const PRIORITIES = ['Highest', 'High', 'Medium', 'Low'];
// the existing priority values (the same as the client's and lib/model.ts)
export const SYSTEM_AUTHORS = new Set(['Automation', 'Development', 'Claude']);
/** A draft epic (saved AI output) can't be published without a title. */
export const NO_DRAFT_TITLE = 'Give the draft a title before you publish it.';
const gzip = promisify(zlib.gzip);
export const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const has = (u, perm) => Boolean(u && (u.is_owner || (u.permissions || []).includes(perm)));
// Workspaces: a project belongs to one workspace for good, so which one is remembered (ids are
// unique everywhere).
const projWs = (globalThis.__tfProjWs ??= new Map());
// Bounded, so a server that has seen millions of projects doesn't keep them all in memory: past the
// cap the oldest tenth is forgotten (Maps keep insertion order) and read again from the database
// when next needed.
const PROJ_WS_MAX = 100000;
const rememberWs = (projectId, ws) => {
  if (projWs.size >= PROJ_WS_MAX && !projWs.has(projectId)) {
    let n = PROJ_WS_MAX / 10;
    for (const k of projWs.keys()) {
      projWs.delete(k);
      if (--n <= 0) break;
    }
  }
  projWs.set(projectId, ws);
};
const otherWs = (u, projectId) => {
  const w = projWs.get(projectId);
  return Boolean(w && u?.workspace_id && w !== u.workspace_id);
};
/** The workspace a project belongs to, or null if there's no such project. */
export async function projectWorkspace(projectId) {
  if (projWs.has(projectId)) return projWs.get(projectId);
  const r = (await qs('select workspace_id from projects where id = $1', [projectId])).rows[0];
  if (r) rememberWs(projectId, r.workspace_id);
  return r ? r.workspace_id : null;
}
export const canAccess = (u, projectId) =>
  Boolean(
    u &&
    !otherWs(u, projectId) &&
    (u.is_owner ||
      u.project_access === 'all' ||
      (Array.isArray(u.project_access) && u.project_access.includes(projectId))),
  );
export function requireAccess(u, projectId) {
  if (!canAccess(u, projectId)) throw new HttpError(404, 'Project not found');
}
/**
 * requireAccess, also checking the project is in the person's workspace (for project ids that come
 * from a request body).
 */
export async function requireProject(u, projectId) {
  const w = await projectWorkspace(String(projectId || ''));
  if (!w || (u?.workspace_id && w !== u.workspace_id))
    throw new HttpError(404, 'Project not found');
  requireAccess(u, projectId);
}
export function requirePerm(u, perm) {
  if (!has(u, perm))
    throw new HttpError(
      403,
      `You don't have permission to do this (${perm}). Ask an administrator for access.`,
    );
}
const splitProject = (p) => {
  const { tickets = [], id, version, _revs, ...meta } = p;
  return { meta, tickets };
};
/** Keys a browser can't save as project sections. */
export const NOT_META = new Set([TICKETS, 'id', 'version', 'updatedAt', 'createdBy', '_revs']);
export const statsOf = (data) => ({ epics: Array.isArray(data?.epics) ? data.epics.length : 0 });
// ---------------------------------------------------------------- caches (per server process) The
// project version every open browser polls for (every 10 s): answered from memory for up to 2 s,
// and at once after a save on this server. With thousands of people that's a database query every 2
// s per project, not hundreds per second. Several servers: another server's save shows within 2 s.
const G = (globalThis.__tfStore ??= {
  versions: new Map(),
  resp: new Map(),
  respBytes: 0,
  inflight: new Map(),
});
const VERSION_MS = 2000;
export const noteVersion = (id, v) => {
  G.versions.set(id, { v, at: Date.now() });
};
/**
 * Ready-made responses (the whole project, "changes since"), shared by everyone who asks for the
 * same version.
 */
const RESP_MAX = 96 * 1024 * 1024,
  RESP_MS = 120000;
function respGet(key) {
  const e = G.resp.get(key);
  if (!e) return null;
  if (Date.now() - e.at > RESP_MS) {
    G.resp.delete(key);
    G.respBytes -= e.bytes;
    return null;
  }
  G.resp.delete(key);
  G.resp.set(key, e); // most recently used last
  return e.value;
}
function respPut(key, value, bytes) {
  if (bytes > RESP_MAX / 4) return;
  const old = G.resp.get(key);
  if (old) {
    G.resp.delete(key);
    G.respBytes -= old.bytes;
  }
  G.resp.set(key, { value, bytes, at: Date.now() });
  G.respBytes += bytes;
  for (const [k, e] of G.resp) {
    if (G.respBytes <= RESP_MAX) break;
    G.resp.delete(k);
    G.respBytes -= e.bytes;
  }
}
/** One database trip for many identical requests arriving together. */
function once(key, fn) {
  if (G.inflight.has(key)) return G.inflight.get(key);
  const p = Promise.resolve()
    .then(fn)
    .finally(() => G.inflight.delete(key));
  G.inflight.set(key, p);
  return p;
}
export async function listProjects(user) {
  const ws = user?.workspace_id || currentWs() || '';
  // Counts come from small columns (stats, is_sub), so the list doesn't read every project's and
  // issue's data.
  const { rows } = await q(
    `select p.id, p.name, p.key, p.updated_at as "updatedAt", p.created_by as "createdBy",
      coalesce((p.stats->>'epics')::int, 0) as epics,
      (select count(*) from issues i where i.project_id = p.id and not i.is_sub)::int as tickets
    from projects p where p.workspace_id = $1 and p.archived_at is null order by p.updated_at desc`,
    [ws],
  );
  for (const r of rows) rememberWs(r.id, ws);
  return rows.filter((r) => canAccess(user, r.id));
}
/**
 * The whole project. { revs: true } adds _revs: the version that last changed each issue and
 * section (for the browser's conflict-safe saves).
 */
export async function getProject(id, { revs = false }: any = {}) {
  const { rows } = await q('select * from projects where id = $1 and archived_at is null', [id]);
  if (!rows[0]) throw new HttpError(404, 'Project not found');
  const issues = await q(
    `select data${revs ? ', rev' : ''} from issues where project_id = $1 order by position, id`,
    [id],
  );
  const p = {
    ...rows[0].data,
    id,
    name: rows[0].name,
    key: rows[0].key,
    version: rows[0].version,
    updatedAt: rows[0].updated_at,
    createdBy: rows[0].created_by || null,
    tickets: issues.rows.map((r) => r.data),
  };
  if (revs) {
    const ir: any = {};
    for (const r of issues.rows) ir[r.data.id] = r.rev;
    p._revs = { issues: ir, meta: rows[0].revs || {} };
    return p;
  }
  // For the server's own use (AI, code jobs, exports): the repositories as this person's computer
  // has them.
  return (await import('../mylocal')).withMyLocal(p);
}
/**
 * The project as JSON for the browser (GET /api/projects/:id), made once per version and shared: a
 * thousand people opening the same project cost one database read. { gzip: true } also returns it
 * gzipped (made once, ~30× smaller): the browser unpacks it itself, because Next.js doesn't let a
 * route send its own Content-Encoding.
 * Returns { body, version, gz? }.
 */
export async function projectJson(id, { gzip: wantGz = false }: any = {}) {
  const v = await projectVersion(id);
  let e = respGet(`full:${id}:${v}`);
  if (!e) {
    e = await once(`full:${id}:${v}`, async () => {
      const p = await getProject(id, { revs: true });
      const out = { body: JSON.stringify(p), version: p.version };
      respPut(`full:${id}:${p.version}`, out, out.body.length);
      noteVersion(id, p.version);
      return out;
    });
  }
  if (!wantGz) return e;
  const entry = e;
  let gz = respGet(`gz:${id}:${entry.version}`);
  if (!gz) {
    gz = await once(`gz:${id}:${entry.version}`, () => gzip(entry.body, { level: 6 }));
    respPut(`gz:${id}:${entry.version}`, gz, gz.length);
  }
  return { ...entry, gz };
}
export async function projectVersion(id) {
  const hit = G.versions.get(id);
  if (hit && Date.now() - hit.at < VERSION_MS) return hit.v;
  return once(`v:${id}`, async () => {
    const { rows } = await q('select version from projects where id = $1 and archived_at is null', [
      id,
    ]);
    if (!rows[0]) {
      G.versions.delete(id);
      throw new HttpError(404, 'Project not found');
    }
    noteVersion(id, rows[0].version);
    return rows[0].version;
  });
}
/**
 * What changed since a version: { version, meta, upsert, remove, order?, revs } — usually a few kB
 * instead of the whole project. { full: true } when the browser must reload (unknown version).
 */
export async function projectChanges(id, since) {
  const v = await projectVersion(id);
  since = Number(since);
  if (!Number.isInteger(since) || since < 1 || since > v) return { full: true, version: v };
  if (since === v)
    return { version: v, meta: {}, upsert: [], remove: [], revs: { issues: {}, meta: {} } };
  const key = `chg:${id}:${since}:${v}`;
  const hit = respGet(key);
  if (hit) return hit;
  return once(key, async () => {
    const pr = (
      await q('select version, revs from projects where id = $1 and archived_at is null', [id])
    ).rows[0];
    if (!pr) throw new HttpError(404, 'Project not found');
    const revs = pr.revs || {};
    const keys = Object.keys(revs).filter((k) => k !== '_order' && revs[k] > since);
    const meta = keys.length
      ? (
          await q(
            'select (select jsonb_object_agg(k, data -> k) from unnest($2::text[]) as k) as m from projects where id = $1',
            [id, keys],
          )
        ).rows[0].m || {}
      : {};
    const up = (
      await q(
        'select data, rev from issues where project_id = $1 and rev > $2 order by position, id',
        [id, since],
      )
    ).rows;
    const remove = (
      await q('select id from issue_tombstones where project_id = $1 and rev > $2', [id, since])
    ).rows.map((r) => r.id);
    const order =
      (revs._order || 0) > since
        ? (
            await q('select id from issues where project_id = $1 order by position, id', [id])
          ).rows.map((r) => r.id)
        : undefined;
    const issueRevs: any = {};
    for (const r of up) issueRevs[r.data.id] = r.rev;
    const metaRevs: any = {};
    for (const k of keys) metaRevs[k] = revs[k];
    // pr.version can be newer than v: those changes are included, and the browser asks again from v
    // next time.
    const out = {
      version: Math.min(v, pr.version),
      meta,
      upsert: up.map((r) => r.data),
      remove,
      order,
      revs: { issues: issueRevs, meta: metaRevs },
    };
    respPut(key, out, JSON.stringify(out).length);
    return out;
  });
}
export async function createProject(p, user) {
  if (!/^[a-z0-9-]{1,64}$/i.test(p.id || '')) throw new HttpError(400, 'Bad project id');
  // Legacy JSON projects imported at start-up (no user, no request) go to the default workspace.
  const ws = user?.workspace_id || currentWs() || (user ? null : DEFAULT_WS);
  if (!ws) throw new HttpError(500, 'No workspace for this request.');
  // Checked in system context: ids are unique across every workspace. A taken id gets a fresh one
  // from the server (the browser uses the id in the answer), so nobody learns that another company
  // has a project with that id.
  for (let n = 0; (await qs('select 1 from projects where id = $1', [p.id])).rows[0]; n++) {
    if (n > 5) throw new HttpError(409, 'Couldn’t pick a project id. Try again.');
    p.id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  await checkLimit('projects', 1, ws);
  const { meta, tickets } = splitProject(p);
  await tx(async (t) => {
    await t.query(
      'insert into projects (id, name, key, data, created_by, stats, workspace_id) values ($1,$2,$3,$4,$5,$6,$7)',
      [
        p.id,
        String(meta.name || 'Untitled'),
        String(meta.key || 'PRJ'),
        JSON.stringify(meta),
        user?.id || null,
        JSON.stringify(statsOf(meta)),
        ws,
      ],
    );
    // All issues in one statement (a generated project can have hundreds).
    const rows = tickets
      .filter((tk) => tk && typeof tk.id === 'string')
      .map((tk, pos) => ({ id: tk.id, pos, data: tk }));
    if (rows.length)
      await t.query(
        `insert into issues (project_id, id, position, data, updated_by)
      select $1, x.id, x.pos, x.data, $3 from jsonb_to_recordset($2::jsonb) as x(id text, pos float8, data jsonb)`,
        [p.id, JSON.stringify(rows), user?.id || null],
      );
  });
  if (user && !user.is_owner && user.project_access !== 'all') {
    // Give a restricted creator access to the project they made (memberships are written by the
    // sign-in system).
    const access = [...new Set([...(user.project_access || []), p.id])];
    await qs(
      'update workspace_members set project_access = $3 where workspace_id = $1 and user_id = $2',
      [ws, user.id, JSON.stringify(access)],
    );
    user.project_access = access;
  }
  rememberWs(p.id, ws);
  return getProject(p.id);
}
/**
 * Only the project's creator and a workspace owner may delete it (the same rule as the RLS policy
 * and trigger in db.js).
 */
export const canDeleteProject = (u, createdBy) =>
  Boolean(u && (u.is_owner || (createdBy && createdBy === u.id)));
/**
 * Soft delete: the project is archived (hidden everywhere, nothing is removed) so the app owner can
 * restore it.
 * The person must be the creator or an owner, and confirm with their own password.
 */
export async function deleteProject(id, user, password) {
  const pr = (
    await q('select created_by from projects where id = $1 and archived_at is null', [id])
  ).rows[0];
  if (!pr) throw new HttpError(404, 'Project not found');
  if (!canDeleteProject(user, pr.created_by))
    throw new HttpError(403, 'Only the project creator or an owner can delete this project.');
  if (!password || typeof password !== 'string')
    throw new HttpError(400, 'Enter your password to delete this project.');
  if (!(await verifyPassword(password, user.password_hash)))
    throw new HttpError(400, 'That password is incorrect. The project was not deleted.');
  const done = await q(
    'update projects set archived_at = now(), archived_by = $2 where id = $1 and archived_at is null returning id',
    [id, user.id],
  );
  if (!done.rows[0])
    throw new HttpError(403, 'Only the project creator or an owner can delete this project.');
  G.versions.delete(id);
  for (const [k, e] of G.resp)
    if (k.split(':')[1] === id) {
      G.resp.delete(k);
      G.respBytes -= e.bytes;
    }
  projWs.delete(id);
}
