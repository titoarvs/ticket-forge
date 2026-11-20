import { q, tx } from '../db';
import { HttpError } from '../auth';
import { ensureBrain, G, ROW, resolver, linksIn, noteHash, state } from './refresh-brain';
import {
  words,
  clip,
  MAX_BODY,
  NOTE_TYPES,
  tagsOf,
  MAX_USER_NOTES,
  safeName,
  base,
} from './safe-name';
import { publicSync, toMarkdown } from './import-notes';

export const bump = (t, projectId) =>
  t.query(
    `insert into brain_state (project_id, version, rev) values ($1, 0, 1) on conflict (project_id) do update set rev = brain_state.rev + 1`,
    [projectId],
  );
/**
 * Every note of the project with its resolved links and backlinks, cached per brain revision (one
 * small query to check). { rev, notes, byId, resolve, out: Map id → ids, back: Map id → ids, terms
 * }.
 */
export async function loadIndex(projectId) {
  const st = await ensureBrain(projectId);
  const rev = st?.rev ?? 0;
  const hit = G.index.get(projectId);
  if (hit && hit.rev === rev) return hit;
  const notes = (
    await q(`select ${ROW} from brain_notes where project_id = $1 order by id`, [projectId])
  ).rows;
  const resolve = resolver(notes);
  const byId = new Map(notes.map((n) => [n.id, n]));
  const out = new Map(),
    back = new Map(),
    unresolved = new Map();
  for (const n of notes) {
    const ids: any[] = [];
    for (const target of n.links || []) {
      const id = resolve(target);
      if (id && id !== n.id) ids.push(id);
      else if (!id) unresolved.set(n.id, [...(unresolved.get(n.id) || []), target]);
    }
    out.set(n.id, [...new Set(ids)]);
    for (const id of new Set(ids)) back.set(id, [...(back.get(id) || []), n.id]);
  }
  const idx = { rev, state: st, notes, byId, resolve, out, back, unresolved, terms: null };
  G.index.set(projectId, idx);
  if (G.index.size > 200) G.index.delete(G.index.keys().next().value);
  return idx;
}
/** Word counts per note (title ×3, tags and key ×2, body), built on first use. */
function termsOf(idx) {
  if (idx.terms) return idx.terms;
  const per = new Map(),
    df = new Map();
  for (const n of idx.notes) {
    const tf: Map<any, any> = new Map();
    const addW = (s, w) => {
      for (const x of words(s)) tf.set(x, (tf.get(x) || 0) + w);
    };
    addW(n.title, 3);
    addW(`${n.key} ${(n.tags || []).join(' ')}`, 2);
    addW(String(n.body).slice(0, 20000), 1);
    per.set(n.id, tf);
    for (const x of tf.keys()) df.set(x, (df.get(x) || 0) + 1);
  }
  idx.terms = { per, df, N: idx.notes.length };
  return idx.terms;
}
/** Notes ranked by how well they match the words of `text` (BM25-like, saturating term counts). */
function searchIdx(idx, text, { limit = 20, skip = new Set(), types = null }: any = {}) {
  const { per, df, N } = termsOf(idx);
  const want = [...new Set(words(text))].slice(0, 60);
  if (!want.length) return [];
  const scored: any[] = [];
  for (const n of idx.notes) {
    if (skip.has(n.id) || (types && !types.includes(n.type))) continue;
    const tf = per.get(n.id);
    let s = 0;
    for (const w of want) {
      const f = tf.get(w);
      if (f) s += (f / (f + 1.5)) * Math.log(1 + N / (df.get(w) || 1));
    }
    if (s > 0) scored.push({ id: n.id, s });
  }
  return scored.sort((a, b) => b.s - a.s || a.id.localeCompare(b.id)).slice(0, limit);
}
/** The list for the viewer: notes without their bodies, with resolved links, plus the state. */
export async function listNotes(projectId) {
  const idx = await loadIndex(projectId);
  return {
    rev: idx.rev,
    version: idx.state?.version ?? null,
    builtAt: idx.state?.builtAt ?? null,
    sync: publicSync(idx.state?.data?.sync),
    useInAi: idx.state?.data?.useInAi !== false,
    notes: idx.notes.map((n) => ({
      id: n.id,
      kind: n.kind,
      type: n.type,
      key: n.key,
      ref: n.ref,
      title: n.title,
      status: n.status,
      tags: n.tags || [],
      updatedAt: n.updatedAt,
      updatedBy: n.updatedBy || null,
      out: idx.out.get(n.id) || [],
      excerpt: clip(
        String(n.body)
          .replace(/^#.*\n/, '')
          .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a)
          .replace(/[#*`>|_-]+/g, ' ')
          .replace(/\s+/g, ' '),
        180,
      ),
    })),
  };
}
/**
 * One note with its body, outgoing links and backlinks (and links that don't resolve to a note
 * yet).
 */
export async function getNote(projectId, id) {
  const idx = await loadIndex(projectId);
  const n = idx.byId.get(id) || idx.byId.get(idx.resolve(id) || '');
  if (!n) throw new HttpError(404, 'That note isn’t in the brain.');
  const meta = (ids) =>
    ids
      .map((x) => idx.byId.get(x))
      .filter(Boolean)
      .map((x) => ({ id: x.id, title: x.title, type: x.type, key: x.key, status: x.status }));
  return {
    ...n,
    out: meta(idx.out.get(n.id) || []),
    back: meta(idx.back.get(n.id) || []),
    unresolved: idx.unresolved.get(n.id) || [],
    markdown: toMarkdown(n),
  };
}
export async function searchNotes(projectId, text) {
  const idx = await loadIndex(projectId);
  return searchIdx(idx, text, { limit: 60 }).map((x) => x.id);
}
/**
 * Creates or updates one of the person's own notes. Generated notes can't be edited (they'd be
 * overwritten).
 */
export async function saveNote(projectId, note, user) {
  const title = String(note.title || '')
    .trim()
    .slice(0, 200);
  if (!title) throw new HttpError(400, 'Give the note a title.');
  const body = String(note.body ?? '').slice(0, MAX_BODY);
  const type =
    NOTE_TYPES.includes(note.type) && !['index', 'project', 'context', 'repo'].includes(note.type)
      ? note.type
      : 'note';
  const tags = tagsOf(
    Array.isArray(note.tags) ? note.tags : String(note.tags || '').split(/[,\s]+/),
  ).slice(0, 20);
  const status = String(note.status || '').slice(0, 60);
  const idx = await loadIndex(projectId);
  let id = note.id ? String(note.id) : '';
  const cur = id ? idx.byId.get(id) : null;
  if (id && !cur)
    throw new HttpError(404, 'That note was deleted. Copy your text and create it again.');
  if (cur && cur.kind !== 'user')
    throw new HttpError(
      409,
      'TicketForge writes this note from the project, so edits would be lost on the next refresh. Create a note of your own that links to it instead.',
    );
  if (!cur) {
    if (idx.notes.filter((n) => n.kind === 'user').length >= MAX_USER_NOTES)
      throw new HttpError(400, `A brain holds at most ${MAX_USER_NOTES} notes of your own.`);
    const folder =
      String(note.folder || 'Notes')
        .split('/')
        .map(safeName)
        .filter((x) => x && x !== 'Untitled')
        .join('/') || 'Notes';
    const names = new Set(idx.notes.map((n) => base(n.id).toLowerCase()));
    let file = safeName(title),
      k = 2;
    while (names.has(file.toLowerCase())) file = `${safeName(title)} ${k++}`;
    id = `${folder}/${file}`;
  }
  if (
    cur &&
    note.baseUpdatedAt &&
    new Date(cur.updatedAt).toISOString() !== new Date(note.baseUpdatedAt).toISOString()
  ) {
    throw Object.assign(
      new HttpError(
        409,
        `${cur.updatedBy || 'Someone'} changed this note since you opened it. Reload it, then make your change again.`,
      ),
      { extra: { conflict: true } },
    );
  }
  const meta = cur?.meta || (note.meta && typeof note.meta === 'object' ? note.meta : {});
  const row = { id, type, key: '', ref: '', title, status, tags, links: linksIn(body), meta, body };
  await tx(async (t) => {
    await t.query(
      `insert into brain_notes (project_id, id, kind, type, key, ref, title, status, tags, links, meta, body, hash, updated_by, updated_at)
      values ($1, $2, 'user', $3, '', '', $4, $5, $6, $7, $8, $9, $10, $11, now())
      on conflict (project_id, id) do update set type = excluded.type, title = excluded.title, status = excluded.status, tags = excluded.tags, links = excluded.links,
        meta = excluded.meta, body = excluded.body, hash = excluded.hash, updated_by = excluded.updated_by, updated_at = now()
      where brain_notes.kind = 'user'`,
      [
        projectId,
        id,
        type,
        title,
        status,
        JSON.stringify(tags),
        JSON.stringify(row.links),
        JSON.stringify(meta),
        body,
        noteHash(row),
        user?.name || null,
      ],
    );
    await bump(t, projectId);
  });
  return getNote(projectId, id);
}
export async function deleteNote(projectId, id) {
  const r = await tx(async (t) => {
    const x = await t.query(
      "delete from brain_notes where project_id = $1 and id = $2 and kind = 'user' returning id",
      [projectId, String(id)],
    );
    if (x.rows[0]) await bump(t, projectId);
    return x.rows[0];
  });
  if (!r) throw new HttpError(404, 'Only your own notes can be deleted, and this one isn’t there.');
  return { ok: true };
}
/** Brain settings for the project: { useInAi }. */
export async function setSettings(projectId, patch) {
  const data = { ...((await state(projectId))?.data || {}) };
  if ('useInAi' in patch) data.useInAi = Boolean(patch.useInAi);
  await q(
    `insert into brain_state (project_id, version, rev, data) values ($1, 0, 0, $2) on conflict (project_id) do update set data = $2`,
    [projectId, JSON.stringify(data)],
  );
  return { useInAi: data.useInAi !== false };
}
// ---------------------------------------------------------------- the AI context block
const TYPE_RANK = {
  note: 0,
  decision: 1,
  question: 2,
  issue: 3,
  epic: 4,
  doc: 5,
  release: 6,
  source: 7,
  project: 8,
  repo: 9,
  context: 10,
  index: 11,
};
/**
 * The notes that matter for a task, as a compact Markdown block for the prompt. Starts at the notes
 * of the issues and epics the task is about, follows their links (and backlinks) one and two hops,
 * then adds the notes whose words match the task best. Deterministic (same project and task → same
 * text), so cached answers and prompt caching keep working. focus: { issueIds, epicIds, keys };
 * query: free text; max: characters; exclude: note types already in the prompt.
 * Returns { text, notes: [{ id, title, type, why }] }.
 */
export async function brainContext(
  projectId,
  {
    issueIds = [],
    epicIds = [],
    keys = [],
    query = '',
    max = 9000,
    exclude = ['context', 'index'],
  }: any = {},
) {
  const idx = await loadIndex(projectId);
  if (!idx.notes.length) return { text: '', notes: [] };
  const refs = new Set([...issueIds, ...epicIds].map(String));
  const keySet = new Set(keys.map((k) => String(k).toLowerCase()));
  const pick: Map<any, any> = new Map(); // id → { why, depth }
  const ok = (n) => n && !exclude.includes(n.type);
  const order = (ids) =>
    [...ids]
      .map((id) => idx.byId.get(id))
      .filter(ok)
      .sort(
        (a, b) =>
          (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9) ||
          a.id.localeCompare(b.id, undefined, { numeric: true }),
      );
  const seeds = idx.notes.filter(
    (n) =>
      ok(n) &&
      ((n.kind === 'auto' && n.ref && refs.has(n.ref)) ||
        (n.key && keySet.has(n.key.toLowerCase()))),
  );
  for (const n of seeds) pick.set(n.id, { why: 'the task is about it', depth: 0 });
  const near = (id) => [...(idx.out.get(id) || []), ...(idx.back.get(id) || [])];
  // Hop 1: everything the focus notes link to or are linked from (an epic's issues are capped:
  // siblings matter less).
  const hop1: Set<any> = new Set();
  for (const s of seeds) for (const id of near(s.id)) if (!pick.has(id)) hop1.add(id);
  let siblings = 0;
  for (const n of order(hop1)) {
    if (n.type === 'issue' && seeds.some((s) => s.type === 'epic') && ++siblings > 12) continue;
    pick.set(n.id, { why: 'linked', depth: 1 });
  }
  // Hop 2: questions and people's notes two links away (not every issue of every epic).
  const hop2: Set<any> = new Set();
  for (const [id, x] of [...pick])
    if (x.depth === 1) for (const y of near(id)) if (!pick.has(y)) hop2.add(y);
  for (const n of order(hop2))
    if (['note', 'decision', 'question', 'doc'].includes(n.type))
      pick.set(n.id, { why: 'two links away', depth: 2 });
  // Keyword match: what the task's words point at, beyond the links.
  const text = [query, ...seeds.map((n) => `${n.title} ${String(n.body).slice(0, 3000)}`)].join(
    '\n',
  );
  for (const r of searchIdx(idx, text, {
    limit: 8,
    skip: new Set([...pick.keys(), ...idx.notes.filter((n) => !ok(n)).map((n) => n.id)]),
  }))
    pick.set(r.id, { why: 'matches the task', depth: 3 });
  if (!pick.size) return { text: '', notes: [] };
  const BUDGET = [2600, 900, 450, 650];
  const body = (n, n2) => {
    const b = String(n.body)
      .replace(/^# .*\n+/, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return clip(b, n2);
  };
  const ranked = [...pick]
    .map(([id, x]) => ({ n: idx.byId.get(id), ...x }))
    .filter((x) => x.n)
    .sort(
      (a, b) =>
        a.depth - b.depth ||
        (TYPE_RANK[a.n.type] ?? 9) - (TYPE_RANK[b.n.type] ?? 9) ||
        a.n.id.localeCompare(b.n.id, undefined, { numeric: true }),
    );
  const parts = [],
    used = [];
  let size = 0;
  for (const x of ranked) {
    const head = `### [[${base(x.n.id)}]] ${x.n.title} · ${x.n.type}${x.n.status ? ` · ${x.n.status}` : ''}${x.n.kind === 'user' ? ' · team note' : ''}`;
    const room = max - size - head.length - 2;
    if (room < 120) break;
    const part = `${head}\n${body(x.n, Math.min(BUDGET[x.depth] ?? 400, room))}`;
    parts.push(part);
    used.push({ id: x.n.id, title: x.n.title, type: x.n.type, why: x.why });
    size += part.length + 2;
  }
  return { text: parts.join('\n\n'), notes: used };
}
