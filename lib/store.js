// Projects and issues in the database. Clients save with patches (changed issues + changed sections),
// which are checked against the user's permissions and merged per issue, so several people can work at once.
import fs from 'node:fs/promises';
import path from 'node:path';
import { q, tx, qs, DATA_DIR } from './db.js';
import { deleteProjectSecrets } from './secrets.js';
import { deleteProjectShots } from './shots.js';
import { HttpError } from './auth.js';

const TICKETS = 'tickets';
const SETTINGS_KEYS = ['name', 'key', 'summary', 'assumptions', 'openQuestions', 'workflow', 'members', 'automation', 'sourceName', 'sourceText'];
const META_PERM = { epics: ['epic.manage'], sprints: ['sprint.manage'], sources: ['issue.create', 'project.settings'] };
const SYSTEM_AUTHORS = new Set(['Automation', 'Development', 'Claude']);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const has = (u, perm) => Boolean(u && (u.is_owner || (u.permissions || []).includes(perm)));
export const canAccess = (u, projectId) => Boolean(u && (u.is_owner || u.project_access === 'all' || (Array.isArray(u.project_access) && u.project_access.includes(projectId))));
export function requireAccess(u, projectId) { if (!canAccess(u, projectId)) throw new HttpError(404, 'Project not found'); }
export function requirePerm(u, perm) {
  if (!has(u, perm)) throw new HttpError(403, `You don't have permission to do this (${perm}). Ask an administrator for access.`);
}

const splitProject = (p) => { const { tickets = [], id, version, ...meta } = p; return { meta, tickets }; };

export async function listProjects(user) {
  const { rows } = await q(`select p.id, p.name, p.key, p.updated_at as "updatedAt",
      coalesce(jsonb_array_length(p.data->'epics'), 0)::int as epics,
      (select count(*) from issues i where i.project_id = p.id and coalesce(i.data->>'type','') <> 'Sub-task')::int as tickets
    from projects p order by p.updated_at desc`);
  return rows.filter((r) => canAccess(user, r.id));
}

export async function getProject(id) {
  const { rows } = await q('select * from projects where id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'Project not found');
  const issues = await q('select data from issues where project_id = $1 order by position, id', [id]);
  return { ...rows[0].data, id, name: rows[0].name, key: rows[0].key, version: rows[0].version, updatedAt: rows[0].updated_at, tickets: issues.rows.map((r) => r.data) };
}

export async function projectVersion(id) {
  const { rows } = await q('select version from projects where id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'Project not found');
  return rows[0].version;
}

export async function createProject(p, user) {
  if (!/^[a-z0-9-]{1,64}$/i.test(p.id || '')) throw new HttpError(400, 'Bad project id');
  const { meta, tickets } = splitProject(p);
  // Checked in system context: a project the user can't see is still taken.
  if ((await qs('select 1 from projects where id = $1', [p.id])).rows[0]) throw new HttpError(409, 'A project with this id already exists');
  await tx(async (t) => {
    await t.query('insert into projects (id, name, key, data, created_by) values ($1,$2,$3,$4,$5)',
      [p.id, String(meta.name || 'Untitled'), String(meta.key || 'PRJ'), JSON.stringify(meta), user?.id || null]);
    let pos = 0;
    for (const tk of tickets) {
      await t.query('insert into issues (project_id, id, position, data, updated_by) values ($1,$2,$3,$4,$5)', [p.id, tk.id, pos++, JSON.stringify(tk), user?.id || null]);
    }
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
  await deleteProjectSecrets(id); // the project's test-login passwords
  await deleteProjectShots(id);   // its failure screenshots
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
    if (k === 'sprintId') needs.push(['sprint.manage', 'issue.edit']);
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
  return tx(async (t) => {
    const row = (await t.query('select data from issues where project_id = $1 and id = $2', [projectId, issueId])).rows[0];
    if (!row) return false;
    const d = row.data;
    d.comments = [...(d.comments || []), comment];
    d.updatedAt = new Date().toISOString();
    await t.query('update issues set data = $3, updated_at = now() where project_id = $1 and id = $2', [projectId, issueId, JSON.stringify(d)]);
    await t.query('update projects set version = version + 1, updated_at = now() where id = $1', [projectId]);
    return true;
  });
}

/** Fill in trusted authorship on new comments and history entries. */
function stamp(old, nw, user) {
  const oldComments = new Map((old?.comments || []).map((c) => [c.id, c]));
  nw.comments = (nw.comments || []).map((c) => {
    const prev = oldComments.get(c.id);
    if (prev) return { ...c, authorId: prev.authorId, author: prev.author, system: prev.system };
    const { system: _s, failures: _f, ...rest } = c; // only the server can create automated comments
    return { ...rest, authorId: user.id, author: user.name };
  });
  const oldHist = new Set((old?.history || []).map((h) => h.id));
  nw.history = (nw.history || []).map((h) => (oldHist.has(h.id) || SYSTEM_AUTHORS.has(h.author) ? h : { ...h, author: user.name }));
  return nw;
}

/**
 * patch = { meta: { section: value }, upsert: [ticket], remove: [id], order: [id] }
 * Returns { version }.
 */
export async function patchProject(id, patch, user) {
  return tx(async (t) => {
    const pr = (await t.query('select * from projects where id = $1', [id])).rows[0];
    if (!pr) throw new HttpError(404, 'Project not found');
    // Positions for every issue, but the full data only for the issues being saved (a big project's issues
    // would otherwise travel on every save).
    const touched = [...new Set([...(patch.upsert || []).map((tk) => tk?.id), ...(patch.remove || [])].filter((x) => typeof x === 'string'))];
    const current = new Map((await t.query('select id, position, case when id = any($2) then data end as data from issues where project_id = $1', [id, touched])).rows.map((r) => [r.id, r]));
    const missing = new Set();
    const need = (alts) => { if (!alts.some((p) => has(user, p))) missing.add(alts[0]); };

    const meta = patch.meta || {};
    for (const [k, v] of Object.entries(meta)) {
      if (k === TICKETS || k === 'id' || k === 'version') continue;
      if (same(pr.data[k], v) && !(k === 'name' && v !== pr.name) && !(k === 'key' && v !== pr.key)) continue;
      need(META_PERM[k] || (SETTINGS_KEYS.includes(k) ? ['project.settings'] : ['project.settings']));
    }
    const upserts = (patch.upsert || []).filter((tk) => tk && typeof tk.id === 'string').map((tk) => keepSystemEntries(current.get(tk.id)?.data, tk));
    for (const tk of upserts) ticketNeeds(current.get(tk.id)?.data, tk, user).forEach(need);
    const removes = (patch.remove || []).filter((rid) => current.has(rid));
    if (removes.length) need(['issue.delete']);
    if (Array.isArray(patch.order)) {
      const known = [...current.values()].sort((a, b) => a.position - b.position).map((r) => r.id).filter((x) => patch.order.includes(x));
      const asked = patch.order.filter((x) => current.has(x));
      if (!same(known, asked)) need(['issue.edit', 'sprint.manage', 'epic.manage']);
    }
    if (missing.size) throw new HttpError(403, `You don't have permission to save these changes (${[...missing].join(', ')}). Ask an administrator for access.`);

    // apply
    const data = { ...pr.data };
    for (const [k, v] of Object.entries(meta)) if (k !== TICKETS && k !== 'id' && k !== 'version') data[k] = v;
    const name = String(data.name || pr.name), key = String(data.key || pr.key);
    let maxPos = Math.max(-1, ...[...current.values()].map((r) => r.position));
    const orderIndex = new Map((patch.order || []).map((x, i) => [x, i]));
    // One statement each for all upserts, deletes and position changes, however many issues changed.
    if (upserts.length) {
      const rows = upserts.map((tk) => {
        const prev = current.get(tk.id);
        return { id: tk.id, pos: orderIndex.has(tk.id) ? orderIndex.get(tk.id) : prev ? prev.position : ++maxPos, data: stamp(prev?.data, { ...tk }, user) };
      });
      await t.query(`insert into issues (project_id, id, position, data, updated_by, updated_at)
        select $1, x.id, x.pos, x.data, $3, now() from jsonb_to_recordset($2::jsonb) as x(id text, pos int, data jsonb)
        on conflict (project_id, id) do update set data = excluded.data, position = excluded.position, updated_by = excluded.updated_by, updated_at = now()`,
      [id, JSON.stringify(rows), user.id]);
    }
    if (removes.length) await t.query('delete from issues where project_id = $1 and id = any($2)', [id, removes]);
    if (Array.isArray(patch.order)) {
      const moves = [...orderIndex].filter(([x, i]) => current.has(x) && current.get(x).position !== i && !upserts.some((u) => u.id === x)).map(([x, i]) => ({ id: x, pos: i }));
      if (moves.length) await t.query(`update issues i set position = x.pos from jsonb_to_recordset($2::jsonb) as x(id text, pos int)
        where i.project_id = $1 and i.id = x.id`, [id, JSON.stringify(moves)]);
    }
    const res = await t.query('update projects set data = $2, name = $3, key = $4, version = version + 1, updated_at = now() where id = $1 returning version',
      [id, JSON.stringify(data), name, key]);
    return { version: res.rows[0].version };
  });
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
