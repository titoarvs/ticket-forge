// Projects and issues in the database. Clients save with patches (changed issues + changed sections),
// which are checked against the user's permissions and merged per issue, so several people can work at once.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { q, tx, qs, DATA_DIR } from './db.js';
import { deleteProjectSecrets } from './secrets.js';
import { deleteProjectShots } from './shots.js';
import { deleteProjectFiles } from './files.js';
import { deleteProjectTemplates } from './mdtemplate.js';
import { HttpError } from './auth.js';
import { describeSection } from './activity.js';

const TICKETS = 'tickets';
const SETTINGS_KEYS = ['name', 'key', 'summary', 'assumptions', 'openQuestions', 'workflow', 'members', 'automation', 'sourceName', 'sourceText'];
// testRepo: the Xray-style test repository, plans and executions (Test management). Testers and editors may change it.
const META_PERM = { epics: ['epic.manage'], sprints: ['sprint.manage'], releases: ['sprint.manage', 'project.settings'], sources: ['issue.create', 'project.settings'], testRepo: ['test.run', 'issue.edit'] };
const SYSTEM_AUTHORS = new Set(['Automation', 'Development', 'Claude']);
const gzip = promisify(zlib.gzip);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const has = (u, perm) => Boolean(u && (u.is_owner || (u.permissions || []).includes(perm)));
export const canAccess = (u, projectId) => Boolean(u && (u.is_owner || u.project_access === 'all' || (Array.isArray(u.project_access) && u.project_access.includes(projectId))));
export function requireAccess(u, projectId) { if (!canAccess(u, projectId)) throw new HttpError(404, 'Project not found'); }
export function requirePerm(u, perm) {
  if (!has(u, perm)) throw new HttpError(403, `You don't have permission to do this (${perm}). Ask an administrator for access.`);
}

const splitProject = (p) => { const { tickets = [], id, version, _revs, ...meta } = p; return { meta, tickets }; };
/** Keys a browser can't save as project sections. */
const NOT_META = new Set([TICKETS, 'id', 'version', 'updatedAt', '_revs']);
const statsOf = (data) => ({ epics: Array.isArray(data?.epics) ? data.epics.length : 0 });

// ---------------------------------------------------------------- caches (per server process)
// The project version every open browser polls for (every 10 s): answered from memory for up to 2 s, and at once
// after a save on this server. With thousands of people that's a database query every 2 s per project, not
// hundreds per second. Several servers: another server's save shows within 2 s.
const G = globalThis.__tfStore ??= { versions: new Map(), resp: new Map(), respBytes: 0, inflight: new Map() };
const VERSION_MS = 2000;
export const noteVersion = (id, v) => { G.versions.set(id, { v, at: Date.now() }); };
/** Ready-made responses (the whole project, "changes since"), shared by everyone who asks for the same version. */
const RESP_MAX = 96 * 1024 * 1024, RESP_MS = 120000;
function respGet(key) {
  const e = G.resp.get(key);
  if (!e) return null;
  if (Date.now() - e.at > RESP_MS) { G.resp.delete(key); G.respBytes -= e.bytes; return null; }
  G.resp.delete(key); G.resp.set(key, e); // most recently used last
  return e.value;
}
function respPut(key, value, bytes) {
  if (bytes > RESP_MAX / 4) return;
  const old = G.resp.get(key);
  if (old) { G.resp.delete(key); G.respBytes -= old.bytes; }
  G.resp.set(key, { value, bytes, at: Date.now() });
  G.respBytes += bytes;
  for (const [k, e] of G.resp) { if (G.respBytes <= RESP_MAX) break; G.resp.delete(k); G.respBytes -= e.bytes; }
}
/** One database trip for many identical requests arriving together. */
function once(key, fn) {
  if (G.inflight.has(key)) return G.inflight.get(key);
  const p = Promise.resolve().then(fn).finally(() => G.inflight.delete(key));
  G.inflight.set(key, p);
  return p;
}

export async function listProjects(user) {
  // Counts come from small columns (stats, is_sub), so the list doesn't read every project's and issue's data.
  const { rows } = await q(`select p.id, p.name, p.key, p.updated_at as "updatedAt",
      coalesce((p.stats->>'epics')::int, 0) as epics,
      (select count(*) from issues i where i.project_id = p.id and not i.is_sub)::int as tickets
    from projects p order by p.updated_at desc`);
  return rows.filter((r) => canAccess(user, r.id));
}

/** The whole project. { revs: true } adds _revs: the version that last changed each issue and section (for the browser's conflict-safe saves). */
export async function getProject(id, { revs = false } = {}) {
  const { rows } = await q('select * from projects where id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'Project not found');
  const issues = await q(`select data${revs ? ', rev' : ''} from issues where project_id = $1 order by position, id`, [id]);
  const p = { ...rows[0].data, id, name: rows[0].name, key: rows[0].key, version: rows[0].version, updatedAt: rows[0].updated_at, tickets: issues.rows.map((r) => r.data) };
  if (revs) {
    const ir = {};
    for (const r of issues.rows) ir[r.data.id] = r.rev;
    p._revs = { issues: ir, meta: rows[0].revs || {} };
  }
  return p;
}

/**
 * The project as JSON for the browser (GET /api/projects/:id), made once per version and shared: a thousand people
 * opening the same project cost one database read. { gzip: true } also returns it gzipped (made once, ~30× smaller):
 * the browser unpacks it itself, because Next.js doesn't let a route send its own Content-Encoding.
 * Returns { body, version, gz? }.
 */
export async function projectJson(id, { gzip: wantGz = false } = {}) {
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
    const { rows } = await q('select version from projects where id = $1', [id]);
    if (!rows[0]) { G.versions.delete(id); throw new HttpError(404, 'Project not found'); }
    noteVersion(id, rows[0].version);
    return rows[0].version;
  });
}

/**
 * What changed since a version: { version, meta, upsert, remove, order?, revs } — usually a few kB instead of the
 * whole project. { full: true } when the browser must reload (unknown version).
 */
export async function projectChanges(id, since) {
  const v = await projectVersion(id);
  since = Number(since);
  if (!Number.isInteger(since) || since < 1 || since > v) return { full: true, version: v };
  if (since === v) return { version: v, meta: {}, upsert: [], remove: [], revs: { issues: {}, meta: {} } };
  const key = `chg:${id}:${since}:${v}`;
  const hit = respGet(key);
  if (hit) return hit;
  return once(key, async () => {
    const pr = (await q('select version, revs from projects where id = $1', [id])).rows[0];
    if (!pr) throw new HttpError(404, 'Project not found');
    const revs = pr.revs || {};
    const keys = Object.keys(revs).filter((k) => k !== '_order' && revs[k] > since);
    const meta = keys.length ? (await q('select (select jsonb_object_agg(k, data -> k) from unnest($2::text[]) as k) as m from projects where id = $1', [id, keys])).rows[0].m || {} : {};
    const up = (await q('select data, rev from issues where project_id = $1 and rev > $2 order by position, id', [id, since])).rows;
    const remove = (await q('select id from issue_tombstones where project_id = $1 and rev > $2', [id, since])).rows.map((r) => r.id);
    const order = (revs._order || 0) > since ? (await q('select id from issues where project_id = $1 order by position, id', [id])).rows.map((r) => r.id) : undefined;
    const issueRevs = {};
    for (const r of up) issueRevs[r.data.id] = r.rev;
    const metaRevs = {};
    for (const k of keys) metaRevs[k] = revs[k];
    // pr.version can be newer than v: those changes are included, and the browser asks again from v next time.
    const out = { version: Math.min(v, pr.version), meta, upsert: up.map((r) => r.data), remove, order, revs: { issues: issueRevs, meta: metaRevs } };
    respPut(key, out, JSON.stringify(out).length);
    return out;
  });
}

export async function createProject(p, user) {
  if (!/^[a-z0-9-]{1,64}$/i.test(p.id || '')) throw new HttpError(400, 'Bad project id');
  const { meta, tickets } = splitProject(p);
  // Checked in system context: a project the user can't see is still taken.
  if ((await qs('select 1 from projects where id = $1', [p.id])).rows[0]) throw new HttpError(409, 'A project with this id already exists');
  await tx(async (t) => {
    await t.query('insert into projects (id, name, key, data, created_by, stats) values ($1,$2,$3,$4,$5,$6)',
      [p.id, String(meta.name || 'Untitled'), String(meta.key || 'PRJ'), JSON.stringify(meta), user?.id || null, JSON.stringify(statsOf(meta))]);
    // All issues in one statement (a generated project can have hundreds).
    const rows = tickets.filter((tk) => tk && typeof tk.id === 'string').map((tk, pos) => ({ id: tk.id, pos, data: tk }));
    if (rows.length) await t.query(`insert into issues (project_id, id, position, data, updated_by)
      select $1, x.id, x.pos, x.data, $3 from jsonb_to_recordset($2::jsonb) as x(id text, pos float8, data jsonb)`, [p.id, JSON.stringify(rows), user?.id || null]);
  });
  if (user && !user.is_owner && user.project_access !== 'all') {
    // Give a restricted creator access to the project they made (users are written by the sign-in system).
    const access = [...new Set([...(user.project_access || []), p.id])];
    await qs('update users set project_access = $2 where id = $1', [user.id, JSON.stringify(access)]);
    user.project_access = access;
  }
  return getProject(p.id);
}

export async function deleteProject(id) {
  await q('delete from projects where id = $1', [id]);
  G.versions.delete(id);
  await deleteProjectSecrets(id); // the project's test-login passwords
  await deleteProjectShots(id);   // its failure screenshots
  await deleteProjectFiles(id);   // original files of its source documents
  await deleteProjectTemplates(id); // its own document templates
}

// ---------------------------------------------------------------- permission check for a patch
function ticketNeeds(old, nw, user) {
  if (!old) return [['issue.create']];
  const needs = [];
  const keys = new Set([...Object.keys(old), ...Object.keys(nw)]);
  for (const k of keys) {
    if (k === 'history' || k === 'updatedAt' || same(old[k], nw[k])) continue;
    if (k === 'comments') {
      const before = new Map((old.comments || []).map((c) => [c.id, c]));
      const after = new Map((nw.comments || []).map((c) => [c.id, c]));
      for (const [cid, c] of after) {
        const prev = before.get(cid);
        if (!prev) needs.push(['issue.comment']);
        else if (!same(prev, c)) needs.push(prev.authorId === user.id ? ['issue.comment'] : ['issue.edit']);
      }
      for (const [cid, c] of before) if (!after.has(cid)) needs.push(c.authorId === user.id ? ['issue.comment'] : ['issue.edit']);
      continue;
    }
    if (k === 'testCases') {
      const before = new Map((old.testCases || []).map((c) => [c.id, c]));
      const after = nw.testCases || [];
      const structural = after.length !== before.size || after.some((c) => !before.has(c.id))
        || after.some((c) => { const p = before.get(c.id); const { status: _a, lastRun: _b, script: _c, ...x } = c; const { status: _d, lastRun: _e, script: _f, ...y } = p; return !same(x, y); });
      needs.push(structural ? ['issue.edit'] : ['test.run', 'issue.edit']);
      continue;
    }
    if (k === 'sprintId' || k === 'fixVersions') needs.push(['sprint.manage', 'issue.edit']);
    else if (k === 'epicId') needs.push(['epic.manage', 'issue.edit']);
    else if (k === 'status' || k === 'assignee' || k === 'reporter') needs.push(['issue.edit', 'project.settings']);
    else if (k === 'links') needs.push(['issue.edit', 'issue.delete']);
    else needs.push(['issue.edit']);
  }
  return needs;
}

/**
 * Automated comments are added on the server (e.g. after a failed test run). A client that loaded the issue
 * earlier doesn't know about them yet, so they are carried over instead of being dropped by its save.
 */
function keepSystemEntries(old, tk) {
  if (!old) return tk;
  const have = new Set((tk.comments || []).map((c) => c.id));
  const keep = (old.comments || []).filter((c) => c.system && !have.has(c.id));
  if (!keep.length) return tk;
  return { ...tk, comments: [...(tk.comments || []), ...keep].sort((a, b) => String(a.at).localeCompare(String(b.at))) };
}

/** Appends an automated comment to an issue (server-side) and bumps the project version so clients sync. */
export async function appendComment(projectId, issueId, comment) {
  const NONE = Symbol('no issue');
  try {
    const v = await tx(async (t) => {
      // The project row first (the same order as saves, so the two never wait on each other).
      const pr = (await t.query('update projects set version = version + 1, updated_at = now() where id = $1 returning version', [projectId])).rows[0];
      const row = pr && (await t.query('select data from issues where project_id = $1 and id = $2', [projectId, issueId])).rows[0];
      if (!row) throw NONE; // rolls the version back
      const d = row.data;
      d.comments = [...(d.comments || []), comment];
      d.updatedAt = new Date().toISOString();
      await t.query('update issues set data = $3, rev = $4, updated_at = now() where project_id = $1 and id = $2', [projectId, issueId, JSON.stringify(d), pr.version]);
      return pr.version;
    });
    noteVersion(projectId, v);
    return true;
  } catch (e) { if (e === NONE) return false; throw e; }
}

/** Fill in trusted authorship on new comments and history entries. */
function stamp(old, nw, user) {
  const oldComments = new Map((old?.comments || []).map((c) => [c.id, c]));
  nw.comments = (nw.comments || []).map((c) => {
    const prev = oldComments.get(c.id);
    if (prev?.system) return prev; // automated comments stay exactly as the server wrote them
    if (prev) return { ...c, authorId: prev.authorId, author: prev.author, system: prev.system };
    const { system: _s, failures: _f, results: _r, ...rest } = c; // only the server can create automated comments
    return { ...rest, authorId: user.id, author: user.name };
  });
  const oldHist = new Set((old?.history || []).map((h) => h.id));
  nw.history = (nw.history || []).map((h) => (oldHist.has(h.id) || SYSTEM_AUTHORS.has(h.author) ? h : { ...h, author: user.name }));
  return nw;
}

/**
 * patch = { meta: { section: value }, upsert: [ticket], remove: [id], order: [id],
 *           baseRevs: { issueId: rev }, metaRevs: { section: rev } }
 * baseRevs / metaRevs: the version of each issue and section the browser started from. When someone saved it
 * since, nothing is saved and the answer is 409 with their copies (conflict), so the browser merges both people's
 * changes and saves again: no edit is silently overwritten. Returns { version, revs }.
 */
export async function patchProject(id, patch, user) {
  const meta = patch.meta && typeof patch.meta === 'object' ? patch.meta : {};
  const metaKeys = Object.keys(meta).filter((k) => !NOT_META.has(k));
  const baseRevs = patch.baseRevs && typeof patch.baseRevs === 'object' ? patch.baseRevs : null;
  const metaRevs = patch.metaRevs && typeof patch.metaRevs === 'object' ? patch.metaRevs : null;
  const out = await tx(async (t) => {
    // The new version first: this takes the project's row lock, so saves of one project queue here and each one
    // reads what the previous one wrote (no lost updates). Only the sections being saved are read.
    const pr = (await t.query(`update projects set version = version + 1, updated_at = now() where id = $1
      returning version, name, key, revs, (select coalesce(jsonb_object_agg(k, data -> k), '{}'::jsonb) from unnest($2::text[]) as k) as old`, [id, metaKeys])).rows[0];
    if (!pr) throw new HttpError(404, 'Project not found');
    const version = pr.version, revs = pr.revs || {}, old = pr.old || {};
    const touched = [...new Set([...(patch.upsert || []).map((tk) => tk?.id), ...(patch.remove || [])].filter((x) => typeof x === 'string'))];
    const ordered = Array.isArray(patch.order);
    // Positions of every issue only when the order changes; otherwise just the issues being saved.
    const rows = ordered
      ? (await t.query('select id, position, rev, case when id = any($2) then data end as data from issues where project_id = $1', [id, touched])).rows
      : touched.length ? (await t.query('select id, position, rev, data from issues where project_id = $1 and id = any($2)', [id, touched])).rows : [];
    const current = new Map(rows.map((r) => [r.id, r]));
    const missing = new Set();
    const need = (alts) => { if (!alts.some((p) => has(user, p))) missing.add(alts[0]); };

    const changedMeta = metaKeys.filter((k) => !same(old[k], meta[k]) || (k === 'name' && meta[k] !== pr.name) || (k === 'key' && meta[k] !== pr.key));
    for (const k of changedMeta) need(META_PERM[k] || ['project.settings']);
    const upserts = (patch.upsert || []).filter((tk) => tk && typeof tk.id === 'string').map((tk) => keepSystemEntries(current.get(tk.id)?.data, tk));
    for (const tk of upserts) ticketNeeds(current.get(tk.id)?.data, tk, user).forEach(need);
    const removes = (patch.remove || []).filter((rid) => current.has(rid));
    if (removes.length) need(['issue.delete']);
    if (ordered) {
      const known = [...current.values()].sort((a, b) => a.position - b.position).map((r) => r.id).filter((x) => patch.order.includes(x));
      const asked = patch.order.filter((x) => current.has(x));
      if (!same(known, asked)) need(['issue.edit', 'sprint.manage', 'epic.manage']);
    }
    if (missing.size) throw new HttpError(403, `You don't have permission to save these changes (${[...missing].join(', ')}). Ask an administrator for access.`);

    // Conflicts: someone saved an issue or section after this browser loaded it.
    if (baseRevs || metaRevs) {
      const tickets = [], deleted = [], issueRevs = {};
      for (const tk of upserts) {
        const base = baseRevs?.[tk.id];
        if (typeof base !== 'number') continue;
        const cur = current.get(tk.id);
        if (!cur) deleted.push(tk.id);
        else if (cur.rev > base) { tickets.push(cur.data); issueRevs[tk.id] = cur.rev; }
      }
      const sections = {}, sectionRevs = {};
      for (const k of changedMeta) {
        const base = metaRevs?.[k];
        if (typeof base === 'number' && (revs[k] || 0) > base) { sections[k] = old[k]; sectionRevs[k] = revs[k]; }
      }
      if (tickets.length || deleted.length || Object.keys(sections).length) {
        const e = new HttpError(409, 'Someone else saved these issues a moment ago.');
        e.extra = { conflict: { tickets, deleted, meta: sections, revs: { issues: issueRevs, meta: sectionRevs } } };
        throw e;
      }
    }

    // apply: only what changed is written (a big project's settings aren't rewritten for one issue's change)
    if (changedMeta.length) {
      const set = {}, setRevs = {};
      for (const k of changedMeta) { set[k] = meta[k] === undefined ? null : meta[k]; setRevs[k] = version; }
      const name = changedMeta.includes('name') ? String(meta.name || pr.name) : pr.name;
      const key = changedMeta.includes('key') ? String(meta.key || pr.key) : pr.key;
      const stats = changedMeta.includes('epics') ? JSON.stringify(statsOf(meta)) : null;
      await t.query('update projects set data = data || $2::jsonb, revs = revs || $3::jsonb, name = $4, key = $5, stats = coalesce($6::jsonb, stats) where id = $1',
        [id, JSON.stringify(set), JSON.stringify(setRevs), name, key, stats]);
    }
    const orderIndex = new Map((patch.order || []).map((x, i) => [x, i]));
    const fresh = upserts.filter((tk) => !current.has(tk.id));
    let maxPos = -1;
    if (ordered) maxPos = Math.max(-1, ...rows.map((r) => r.position));
    else if (fresh.length) maxPos = Number((await t.query('select coalesce(max(position), -1) as m from issues where project_id = $1', [id])).rows[0].m);
    // One statement each for all upserts, deletes and position changes, however many issues changed.
    if (upserts.length) {
      const list = upserts.map((tk) => {
        const prev = current.get(tk.id);
        return { id: tk.id, pos: orderIndex.has(tk.id) ? orderIndex.get(tk.id) : prev ? prev.position : ++maxPos, data: stamp(prev?.data, { ...tk }, user) };
      });
      await t.query(`insert into issues (project_id, id, position, data, updated_by, updated_at, rev)
        select $1, x.id, x.pos, x.data, $3, now(), $4 from jsonb_to_recordset($2::jsonb) as x(id text, pos float8, data jsonb)
        on conflict (project_id, id) do update set data = excluded.data, position = excluded.position, updated_by = excluded.updated_by, updated_at = now(), rev = excluded.rev`,
      [id, JSON.stringify(list), user.id, version]);
      if (fresh.length) await t.query('delete from issue_tombstones where project_id = $1 and id = any($2)', [id, fresh.map((tk) => tk.id)]);
      // A status change saves the whole issue as a new version (edits that keep the status don't).
      const moved = list.filter((x) => { const prev = current.get(x.id)?.data; return prev && !same(prev.status, x.data.status); });
      if (moved.length) await insertVersions(t, id, moved.map((x) => ({ id: x.id, data: x.data })), user);
    }
    if (removes.length) {
      await t.query('delete from issue_versions where project_id = $1 and issue_id = any($2)', [id, removes]);
      await t.query('delete from issues where project_id = $1 and id = any($2)', [id, removes]);
      await t.query(`insert into issue_tombstones (project_id, id, rev) select $1, x, $3 from unnest($2::text[]) as x
        on conflict (project_id, id) do update set rev = excluded.rev`, [id, removes, version]);
    }
    let orderChanged = fresh.length > 0 && ordered;
    if (ordered) {
      const moves = [...orderIndex].filter(([x, i]) => current.has(x) && current.get(x).position !== i && !upserts.some((u) => u.id === x)).map(([x, i]) => ({ id: x, pos: i }));
      if (moves.length) {
        orderChanged = true;
        await t.query(`update issues i set position = x.pos from jsonb_to_recordset($2::jsonb) as x(id text, pos float8)
          where i.project_id = $1 and i.id = x.id`, [id, JSON.stringify(moves)]);
      }
      if (!orderChanged) orderChanged = upserts.some((u) => current.has(u.id) && orderIndex.has(u.id) && current.get(u.id).position !== orderIndex.get(u.id));
    }
    if (orderChanged) await t.query("update projects set revs = revs || jsonb_build_object('_order', $2::int) where id = $1", [id, version]);
    // The project timeline: changes to sections (sprints, epics, releases, settings…) and deleted issues. Issue
    // changes are already in each issue's history.
    const events = [...changedMeta.flatMap((k) => describeSection(k, old[k], meta[k])), ...removes.map((rid) => {
      const d = current.get(rid)?.data || {};
      return { kind: 'issue', text: `deleted issue ${d.key || ''}${d.title ? ` “${String(d.title).slice(0, 120)}”` : ''}`.trim(), target: d.key || '' };
    })];
    if (events.length) {
      const list = events.length > 25 ? [...events.slice(0, 24), { kind: 'project', text: `and ${events.length - 24} more changes`, target: '' }] : events;
      await t.query(`insert into activity (project_id, version, user_id, author, kind, target, text)
        select $1, $2, $3, $4, x.kind, x.target, x.text from jsonb_to_recordset($5::jsonb) as x(kind text, target text, text text)`,
      [id, version, user.id, user.name || '', JSON.stringify(list)]);
    }
    const outRevs = { issues: {}, meta: {} };
    for (const tk of upserts) outRevs.issues[tk.id] = version;
    for (const k of metaKeys) outRevs.meta[k] = changedMeta.includes(k) ? version : (revs[k] || 0);
    return { version, revs: outRevs };
  });
  noteVersion(id, out.version);
  return out;
}

// ---------------------------------------------------------------- issue versions
/**
 * What a version keeps: every field of the issue except its activity (comments and the change history). Those
 * keep growing, and a restore must not take comments away.
 */
const versionFields = (d) => { const { comments: _c, history: _h, ...rest } = d || {}; return rest; };

/** Saves issues as their next version number (inside the save's transaction, which holds the project lock). */
async function insertVersions(t, projectId, items, user, restoredFrom = null) {
  const rows = items.map((x) => ({ id: x.id, status: String(x.data.status ?? ''), data: versionFields(x.data) }));
  await t.query(`insert into issue_versions (project_id, issue_id, number, user_id, author, status, restored_from, data)
    select $1, x.id, coalesce((select max(v.number) from issue_versions v where v.project_id = $1 and v.issue_id = x.id), 0) + 1, $2, $3, x.status, $5::int, x.data
    from jsonb_to_recordset($4::jsonb) as x(id text, status text, data jsonb)`,
  [projectId, user?.id || null, user?.name || '', JSON.stringify(rows), restoredFrom]);
}

/** An issue's versions, newest first: { number, at, author, status, restoredFrom, data }. */
export async function listVersions(projectId, issueId) {
  const { rows } = await q(`select number, at, author, status, restored_from as "restoredFrom", data from issue_versions
    where project_id = $1 and issue_id = $2 order by number desc limit 500`, [projectId, issueId]);
  return rows;
}

/**
 * Sets an issue's fields back to one of its versions and records the restore as a new version. Comments and the
 * change history stay (a "restored version N" entry is added). Admins and managers only (issue.restore).
 * Returns { version, number }: the new project version and the new issue version number.
 */
export async function restoreVersion(projectId, issueId, number, user) {
  requirePerm(user, 'issue.restore');
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Choose a version to restore.');
  const out = await tx(async (t) => {
    const pr = (await t.query('update projects set version = version + 1, updated_at = now() where id = $1 returning version', [projectId])).rows[0];
    if (!pr) throw new HttpError(404, 'Project not found');
    const cur = (await t.query('select data from issues where project_id = $1 and id = $2', [projectId, issueId])).rows[0];
    if (!cur) throw new HttpError(404, 'Issue not found');
    const ver = (await t.query('select data from issue_versions where project_id = $1 and issue_id = $2 and number = $3', [projectId, issueId, n])).rows[0];
    if (!ver) throw new HttpError(404, `Version ${n} of this issue was not found.`);
    const now = new Date().toISOString();
    const old = cur.data;
    const data = {
      ...versionFields(ver.data),
      id: old.id, createdAt: old.createdAt ?? ver.data.createdAt, updatedAt: now,
      comments: old.comments || [],
      history: [...(old.history || []), { id: `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, at: now, author: user.name || '', field: 'event', text: `restored version ${n}` }],
    };
    await t.query('update issues set data = $3, rev = $4, updated_by = $5, updated_at = now() where project_id = $1 and id = $2',
      [projectId, issueId, JSON.stringify(data), pr.version, user.id]);
    await insertVersions(t, projectId, [{ id: issueId, data }], user, n);
    const next = (await t.query('select max(number)::int as m from issue_versions where project_id = $1 and issue_id = $2', [projectId, issueId])).rows[0].m;
    return { version: pr.version, number: next };
  });
  noteVersion(projectId, out.version);
  return out;
}

/** One-time import of the JSON projects saved by earlier versions (data/projects/*.json). */
export async function importJsonProjects() {
  const done = (await q("select value from app_meta where key = 'json_imported'")).rows[0];
  if (done) return 0;
  const dir = path.join(DATA_DIR, 'projects');
  let n = 0;
  try {
    for (const f of (await fs.readdir(dir)).filter((x) => x.endsWith('.json'))) {
      try {
        const p = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
        if (!p.id || !Array.isArray(p.tickets)) continue;
        if ((await q('select 1 from projects where id = $1', [p.id])).rows[0]) continue;
        await createProject(p, null);
        n += 1;
      } catch (e) { console.warn(`Could not import ${f}: ${e.message}`); }
    }
  } catch { /* no legacy folder */ }
  await q("insert into app_meta (key, value) values ('json_imported', $1) on conflict (key) do nothing", [JSON.stringify({ at: new Date().toISOString(), count: n })]);
  return n;
}

/** The project timeline's server-side part (section changes, deleted issues), newest first. */
export async function listActivity(id, { before = null, limit = 300 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 300, 1), 1000);
  const rows = before
    ? (await q('select id, at, author, kind, target, text from activity where project_id = $1 and at < $2 order by at desc limit $3', [id, before, n])).rows
    : (await q('select id, at, author, kind, target, text from activity where project_id = $1 order by at desc limit $2', [id, n])).rows;
  return rows.map((r) => ({ ...r, id: String(r.id) }));
}
