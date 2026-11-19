import { q, tx } from '../db';
import * as store from '../store';
import { base, sha } from './safe-name';
import { buildNotes } from './build-notes';

// ---------------------------------------------------------------- links
const LINK_RE = /!?\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g;
/** The [[targets]] written in a note body (as written: file names, titles or paths). */
export const linksIn = (body) => [
  ...new Set([...String(body || '').matchAll(LINK_RE)].map((m) => m[1].trim()).filter(Boolean)),
];
/** Resolves a wikilink target the way Obsidian does: path, file name, then title, alias or key. */
export function resolver(notes) {
  const by: Map<any, any> = new Map();
  const put = (k, id) => {
    const x = String(k || '')
      .trim()
      .toLowerCase();
    if (x && !by.has(x)) by.set(x, id);
  };
  for (const n of notes) put(n.id, n.id);
  for (const n of notes) put(base(n.id), n.id);
  for (const n of notes) {
    put(n.title, n.id);
    for (const a of n.meta?.aliases || []) put(a, n.id);
    put(n.key, n.id);
  }
  return (target) => {
    const t = String(target || '')
      .trim()
      .replace(/\.md$/i, '')
      .toLowerCase();
    return by.get(t) || by.get(t.split('/').pop()) || null;
  };
}
// ---------------------------------------------------------------- storage
export const G = (globalThis.__tfBrain ??= { index: new Map(), inflight: new Map() });
export const ROW =
  'id, kind, type, key, ref, title, status, tags, links, meta, body, hash, updated_by as "updatedBy", updated_at as "updatedAt", created_at as "createdAt"';
export async function state(projectId) {
  return (
    (
      await q(
        'select version, rev, built_at as "builtAt", data from brain_state where project_id = $1',
        [projectId],
      )
    ).rows[0] || null
  );
}
export const noteHash = (n) =>
  sha(
    JSON.stringify([
      n.type,
      n.key,
      n.ref,
      n.title,
      n.status,
      n.tags,
      n.body,
      n.updated || null,
      n.meta || {},
    ]),
  );
/**
 * Rebuilds the generated notes from the project: new and changed ones are written, ones for deleted
 * things removed.
 * People's own notes (kind 'user') are never written here. Returns { version, written, removed,
 * total }.
 */
export async function refreshBrain(projectId) {
  const p = await store.getProject(projectId);
  const notes = buildNotes(p);
  const out = await tx(async (t) => {
    // The state row first: it serialises refreshes of one project (two servers, or two requests at
    // once).
    await t.query(
      `insert into brain_state (project_id, version, rev) values ($1, 0, 0) on conflict (project_id) do nothing`,
      [projectId],
    );
    await t.query('select 1 from brain_state where project_id = $1 for update', [projectId]);
    const have = new Map(
      (
        await t.query('select id, kind, hash from brain_notes where project_id = $1', [projectId])
      ).rows.map((r) => [r.id, r]),
    );
    const rows: any[] = [];
    for (const n of notes) {
      const h = noteHash(n);
      const cur: any = have.get(n.id);
      if (cur?.kind === 'user') continue; // someone's own note at that path wins
      if (cur?.hash === h) continue;
      rows.push({
        id: n.id,
        type: n.type,
        key: n.key,
        ref: n.ref,
        title: n.title,
        status: n.status,
        tags: n.tags,
        links: linksIn(n.body),
        body: n.body,
        hash: h,
        updated: n.updated || null,
      });
    }
    const keep = new Set(notes.map((n) => n.id));
    const gone = [...have.values()]
      .filter((r: any) => r.kind === 'auto' && !keep.has(r.id))
      .map((r: any) => r.id);
    for (let i = 0; i < rows.length; i += 400) {
      await t.query(
        `insert into brain_notes (project_id, id, kind, type, key, ref, title, status, tags, links, body, hash, updated_at)
        select $1, x.id, 'auto', x.type, x.key, x.ref, x.title, x.status, x.tags, x.links, x.body, x.hash, coalesce(x.updated, now())
        from jsonb_to_recordset($2::jsonb) as x(id text, type text, key text, ref text, title text, status text, tags jsonb, links jsonb, body text, hash text, updated timestamptz)
        on conflict (project_id, id) do update set type = excluded.type, key = excluded.key, ref = excluded.ref, title = excluded.title, status = excluded.status,
          tags = excluded.tags, links = excluded.links, body = excluded.body, hash = excluded.hash, updated_at = excluded.updated_at
        where brain_notes.kind = 'auto'`,
        [projectId, JSON.stringify(rows.slice(i, i + 400))],
      );
    }
    if (gone.length)
      await t.query(
        "delete from brain_notes where project_id = $1 and kind = 'auto' and id = any($2)",
        [projectId, gone],
      );
    const changed = rows.length || gone.length;
    const r = (
      await t.query(
        `update brain_state set version = $2, built_at = now(), rev = rev + $3 where project_id = $1 returning rev`,
        [projectId, p.version, changed ? 1 : 0],
      )
    ).rows[0];
    return {
      version: p.version,
      rev: r.rev,
      written: rows.length,
      removed: gone.length,
      total: notes.length,
    };
  });
  return out;
}
/**
 * Makes sure the generated notes match the project's current version (a refresh when it changed).
 */
export async function ensureBrain(projectId) {
  const v = await store.projectVersion(projectId);
  const st = await state(projectId);
  if (st && st.version === v) return st;
  if (!G.inflight.has(projectId))
    G.inflight.set(
      projectId,
      refreshBrain(projectId).finally(() => G.inflight.delete(projectId)),
    );
  await G.inflight.get(projectId);
  return state(projectId);
}
