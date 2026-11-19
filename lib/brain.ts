// Project brain: an Obsidian-compatible knowledge vault of Markdown notes linked with
// [[wikilinks]], so the AI (and the Claude Code agents) always start from the project's context.
// One note per thing TicketForge knows (the project, its epics, issues, releases, source documents,
// open questions, the app context and the repository profile), rebuilt automatically whenever the
// project changes. People add their own notes too; a refresh never touches those.
//
// Stored in the database (brain_notes, brain_state) per project, so the RLS policies of the
// project's workspace apply (lib/db.ts). Generated notes are deterministic: the same project gives
// the same notes, so a refresh only writes what changed and the AI context block stays the same
// text from one call to the next.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { q, tx, currentContext } from './db';
import * as store from './store';
import { HttpError } from './auth';

export const NOTE_TYPES = [
  'index',
  'project',
  'context',
  'repo',
  'epic',
  'issue',
  'release',
  'source',
  'doc',
  'decision',
  'question',
  'note',
];
const FOLDER = {
  index: '',
  project: 'Project',
  context: 'Project',
  repo: 'Project',
  epic: 'Epics',
  issue: 'Issues',
  release: 'Releases',
  source: 'Sources',
  doc: 'Documents',
  decision: 'Decisions',
  question: 'Questions',
  note: 'Notes',
};
const MAX_BODY = 60000;
const MAX_USER_NOTES = 3000;
const clip = (s, n) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
/** A file name Obsidian (and every OS) accepts: no path or link characters. */
export const safeName = (s) =>
  String(s ?? '')
    .replace(/[\\/:*?"<>|#^[\]\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 90) || 'Untitled';
const tagOf = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_/-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
const tagsOf = (list) => [...new Set(list.map(tagOf).filter(Boolean))];
const base = (id) => String(id).split('/').pop();
/** A wikilink to a note id, with a label when the file name doesn't say enough. */
const wl = (id, label) =>
  label && label !== base(id)
    ? `[[${base(id)}|${String(label)
        .replace(/[[\]|]/g, ' ')
        .trim()}]]`
    : `[[${base(id)}]]`;
const STOP = new Set(
  'the and for with that this from into when then than your their they them have has had are was were will would should could can not all any each per via its it’s our out off use used using via new add adds added also more most only some such what which while who whom why how about after before over under again been being does doing done issue issues epic story task page user users able want need needs given must make sure'.split(
    ' ',
  ),
);
/** A light English stem, so "retries" matches "retry" and "payments" matches "payment". */
const stem = (w) =>
  w.length > 4
    ? w
        .replace(/ies$/, 'y')
        .replace(/(?<=[^s])s$/, '')
        .replace(/(?<=..)(ing|ed)$/, '')
    : w;
const words = (s) =>
  (
    String(s || '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]{3,}/gu) || []
  )
    .filter((w) => !STOP.has(w))
    .map(stem);

// ---------------------------------------------------------------- building the notes from the
// project
const catOf = (p, status) =>
  (p.workflow || []).find((w) => w.name === status)?.category ||
  (/done|closed|resolved/i.test(String(status)) ? 'done' : 'todo');
const isSub = (t) => t?.type === 'Sub-task' || Boolean(t?.parentId);
/** The issues whose words overlap the text most (for open questions). */
function related(text, issues, n = 6, min = 2) {
  const want = new Set(words(text));
  if (!want.size) return [];
  return issues
    .map((t) => {
      const have = new Set(words(`${t.title} ${t.userStory || ''}`));
      let s = 0;
      for (const w of want) if (have.has(w)) s += 1;
      return { t, s };
    })
    .filter((x) => x.s >= min)
    .sort(
      (a, b) =>
        b.s - a.s || String(a.t.key).localeCompare(String(b.t.key), undefined, { numeric: true }),
    )
    .slice(0, n)
    .map((x) => x.t);
}

/**
 * All generated notes of a project: [{ id, type, key, ref, title, status, tags, body, updated }].
 * `id` is the note's path in the vault without ".md"; its last part (the file name) is what
 * [[wikilinks]] point to, so it's unique.
 */
export function buildNotes(p) {
  const notes: any[] = [];
  const taken: Set<any> = new Set();
  const add = (n) => {
    let file = safeName(n.file),
      k = 2;
    while (taken.has(file.toLowerCase())) file = `${safeName(n.file)} ${k++}`;
    taken.add(file.toLowerCase());
    const id = FOLDER[n.type] ? `${FOLDER[n.type]}/${file}` : file;
    const note = {
      id,
      type: n.type,
      key: String(n.key || ''),
      ref: String(n.ref || ''),
      title: String(n.title || file).slice(0, 300),
      status: String(n.status || ''),
      tags: tagsOf([n.type, ...(n.tags || [])]),
      body: clip(n.body, MAX_BODY),
      updated: n.updated || p.updatedAt || null,
    };
    notes.push(note);
    return note;
  };
  const tickets = p.tickets || [];
  const epics = p.epics || [];
  const releases = p.releases || [];
  const top = tickets.filter((t) => !isSub(t));
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const byTitle = new Map(
    tickets.map((t) => [
      String(t.title || '')
        .trim()
        .toLowerCase(),
      t,
    ]),
  );
  const epicById = new Map(epics.map((e) => [e.id, e]));
  // Reserve the file names first, so links can be written before every note exists.
  const fileOf: Map<any, any> = new Map();
  const reserve = (kind, id, file) => fileOf.set(`${kind}:${id}`, file);
  const pKey = String(p.key || 'PRJ');
  reserve('p', 'overview', 'Project Overview');
  epics.forEach((e, i) => reserve('e', e.id, e.key || `${pKey}-E${i + 1}`));
  tickets.forEach((t) => reserve('t', t.id, t.key || `Issue ${t.id}`));
  releases.forEach((r) => reserve('r', r.id, `Release ${r.name}`));
  const link = (kind, id, label) => {
    const f = fileOf.get(`${kind}:${id}`);
    return f ? wl(safeName(f), label) : label || '';
  };
  const tLink = (t, withTitle = true) =>
    link('t', t.id, withTitle ? `${t.key || ''} ${t.title || ''}`.trim() : t.key);
  const eLink = (e) => link('e', e.id, `${e.key || ''} ${e.title || ''}`.trim());
  const rLink = (r) => link('r', r.id, r.name);
  const epicIssues = (e) => top.filter((t) => t.epicId === e.id);
  const questions = [];
  const latest = (list) =>
    list
      .map((t) => t.updatedAt)
      .filter(Boolean)
      .sort()
      .pop() || null;

  (p.openQuestions || []).forEach((text, i) => {
    const s = typeof text === 'string' ? text : text?.text || text?.question || '';
    if (s.trim())
      questions.push({
        file: `Question ${String(i + 1).padStart(2, '0')}`,
        key: `${pKey}-Q${i + 1}`,
        ref: `q:${i}`,
        title: clip(s, 140),
        text: s,
        status: 'Open',
      });
  });
  for (const x of questions) x.issues = related(x.text || x.title, top, 5);
  questions.forEach((x) => reserve('q', x.ref, x.file));
  const questionsOf = (t) => questions.filter((x) => x.issues.includes(t));
  const releasesOf = (t) =>
    (t.fixVersions || []).map((v) => releases.find((r) => r.id === v)).filter(Boolean);
  const list = (items) => items.map((x) => `- ${x}`).join('\n');

  // Index and overview
  const flagged = (arr, fn) => (arr.length ? list(arr.map(fn)) : '- (none)');
  const sources = [
    ...(p.sourceText
      ? [
          {
            id: 'original',
            name: p.sourceName || 'Initial document',
            text: p.sourceText,
            kind: 'requirements',
            addedAt: p.createdAt,
            epicIds: [],
            issueIds: [],
          },
        ]
      : []),
    ...(p.sources || []),
  ];
  sources.forEach((s) =>
    reserve(
      's',
      s.id,
      `Source ${String(s.name || 'document').replace(/\.(md|markdown|txt|pdf|docx?|html?)$/i, '')}`,
    ),
  );
  const ctxNote = p.appContext?.md ? 'App Context' : '';
  const repoNotes = [
    p.dev?.repoProfile?.markdown && ['Repository Profile', p.dev.repoProfile, 'frontend'],
    p.devBackend?.enabled &&
      p.devBackend?.repoProfile?.markdown && [
        'Backend Repository Profile',
        p.devBackend.repoProfile,
        'backend',
      ],
  ].filter(Boolean);
  add({
    type: 'index',
    file: 'Index',
    key: `${pKey}-INDEX`,
    ref: 'index',
    title: `${p.name} brain`,
    body: `# ${p.name} brain

The project's knowledge vault, kept up to date by TicketForge. Start at ${link('p', 'overview', 'Project Overview')}. Notes in *Notes/* are your own; TicketForge never changes them.

## Project
- ${link('p', 'overview', 'Project Overview')}${ctxNote ? `\n- [[App Context]]` : ''}${repoNotes.map(([f]) => `\n- [[${f}]]`).join('')}

## Epics
${flagged(epics, (e) => `${eLink(e)} (${epicIssues(e).length} issues)`)}

## Releases
${flagged(releases, (r) => `${rLink(r)} (${r.status || 'unreleased'})`)}

## Open questions
${flagged(questions, (x) => `${wl(safeName(x.file), x.title)}${x.status ? ` (${x.status})` : ''}`)}

## Source documents
${flagged(sources, (s) => link('s', s.id, s.name))}
${top.filter((t) => !epicById.has(t.epicId)).length ? `\n## Issues without an epic\n${list(top.filter((t) => !epicById.has(t.epicId)).map((t) => tLink(t)))}` : ''}`,
  });
  const done = top.filter((t) => catOf(p, t.status) === 'done').length;
  add({
    type: 'project',
    file: 'Project Overview',
    key: pKey,
    ref: 'overview',
    title: p.name,
    status: `${done}/${top.length} done`,
    tags: ['overview'],
    body: `# ${p.name}

- **Key**: ${pKey}
- **Issues**: ${top.length} (${done} done) in ${epics.length} epics
- **Workflow**: ${(p.workflow || []).map((w) => w.name).join(' → ') || 'To Do → In Progress → Done'}
${p.automation?.baseUrl ? `- **Application URL**: ${p.automation.baseUrl}\n` : ''}${p.dev?.repo ? `- **Repository**: ${p.dev.repo}\n` : ''}
## Summary
${String(p.summary || p.description || '').trim() || '(no summary yet)'}

## Assumptions
${(p.assumptions || []).length ? list(p.assumptions.map((a) => (typeof a === 'string' ? a : a?.text || ''))) : '- (none recorded)'}

## Open questions
${flagged(questions, (x) => wl(safeName(x.file), x.title))}

## Epics
${flagged(epics, (e) => eLink(e))}
${ctxNote || repoNotes.length ? `\n## How the app is built\n${ctxNote ? '- [[App Context]]: what the app is, its users, modules and rules\n' : ''}${repoNotes.map(([f]) => `- [[${f}]]: how the repository is built\n`).join('')}` : ''}
See also [[Index]].`,
  });
  if (ctxNote)
    add({
      type: 'context',
      file: 'App Context',
      key: `${pKey}-CONTEXT`,
      ref: 'appContext',
      title: 'App Context',
      tags: ['app-context'],
      updated: p.appContext.editedAt || p.appContext.at,
      body: `${String(p.appContext.md).trim()}\n\nBack to ${link('p', 'overview', 'Project Overview')}.`,
    });
  for (const [file, prof, side] of repoNotes)
    add({
      type: 'repo',
      file,
      key: `${pKey}-REPO${side === 'backend' ? '-BE' : ''}`,
      ref: `repo:${side}`,
      title: file,
      status: prof.commit ? `at ${String(prof.commit).slice(0, 10)}` : '',
      tags: ['repository', side],
      updated: prof.editedAt || prof.learnedAt,
      body: `${String(prof.markdown).trim()}\n\nLearned from the ${side} repository${prof.commit ? ` at ${prof.commit}` : ''} (Learn from repository). Back to ${link('p', 'overview', 'Project Overview')}.`,
    });

  // Epics
  for (const e of epics) {
    const items = epicIssues(e);
    const nDone = items.filter((t) => catOf(p, t.status) === 'done').length;
    const rels = releases.filter((r) => items.some((t) => (t.fixVersions || []).includes(r.id)));
    add({
      type: 'epic',
      file: fileOf.get(`e:${e.id}`),
      key: e.key,
      ref: e.id,
      title: e.title,
      status: !items.length
        ? 'Empty'
        : nDone === items.length
          ? 'Done'
          : nDone
            ? 'In progress'
            : 'To do',
      tags: [],
      updated: latest(items),
      body: `# ${e.key || ''} ${e.title}

${String(e.description || '').trim() || '(no description)'}

- **Progress**: ${nDone}/${items.length} issues done
- **Project**: ${link('p', 'overview', p.name)}
${rels.length ? `- **Releases**: ${rels.map(rLink).join(', ')}\n` : ''}
## Issues
${flagged(items, (t) => `${tLink(t)} · ${t.status || ''}${t.type ? ` · ${t.type}` : ''}`)}
`,
    });
  }

  // Issues
  for (const t of tickets) {
    const e = epicById.get(t.epicId);
    const parent = t.parentId && byId.get(t.parentId);
    const subs = tickets.filter((x) => x.parentId === t.id);
    const deps = (t.dependencies || []).map((d) => {
      const o =
        byTitle.get(String(d).trim().toLowerCase()) ||
        tickets.find(
          (x) => x.key && String(d).trim().toUpperCase() === String(x.key).toUpperCase(),
        );
      return o && o !== t ? tLink(o) : String(d);
    });
    const links = (t.links || [])
      .map((l) => {
        const o = byId.get(l.targetId);
        return o ? `${l.type} ${tLink(o)}` : null;
      })
      .filter(Boolean);
    const blockedBy = tickets.filter(
      (x) =>
        x !== t &&
        (x.dependencies || []).some(
          (d) => String(d).trim().toLowerCase() === String(t.title).trim().toLowerCase(),
        ),
    );
    const rels = releasesOf(t);
    const sprint = (p.sprints || []).find((s) => s.id === t.sprintId);
    const comments = (t.comments || [])
      .filter((c) => !c.system && String(c.text || '').trim())
      .slice(-5);
    const tcs = t.testCases || [];
    const qs = questionsOf(t);
    add({
      type: 'issue',
      file: fileOf.get(`t:${t.id}`),
      key: t.key,
      ref: t.id,
      title: t.title,
      status: t.status,
      updated: t.updatedAt,
      tags: [t.type, t.priority && `priority-${t.priority}`, t.layer, ...(t.labels || [])].filter(
        Boolean,
      ),
      body: `# ${t.key || ''} ${t.title}

- **Type**: ${t.type || 'Story'}${t.priority ? ` · **Priority**: ${t.priority}` : ''}${t.storyPoints ? ` · **Points**: ${t.storyPoints}` : ''}
- **Status**: ${t.status || ''}${t.assignee ? ` · **Assignee**: ${t.assignee}` : ''}
${e ? `- **Epic**: ${eLink(e)}\n` : ''}${parent ? `- **Parent**: ${tLink(parent)}\n` : ''}${sprint ? `- **Sprint**: ${sprint.name}\n` : ''}${rels.length ? `- **Fix versions**: ${rels.map(rLink).join(', ')}\n` : ''}${t.layer ? `- **Layer**: ${t.layer}\n` : ''}
${t.userStory ? `## User story\n${t.userStory}\n\n` : ''}${String(t.description || '').trim() ? `## Description\n${String(t.description).trim()}\n\n` : ''}${(t.acceptanceCriteria || []).length ? `## Acceptance criteria\n${t.acceptanceCriteria.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n\n` : ''}${deps.length ? `## Depends on\n${list(deps)}\n\n` : ''}${blockedBy.length ? `## Needed by\n${list(blockedBy.map((x) => tLink(x)))}\n\n` : ''}${links.length ? `## Links\n${list(links)}\n\n` : ''}${subs.length ? `## Sub-tasks\n${list(subs.map((x) => `${tLink(x)} · ${x.status || ''}`))}\n\n` : ''}${qs.length ? `## Open questions\n${list(qs.map((x) => wl(safeName(x.file), x.title)))}\n\n` : ''}${tcs.length ? `## Test cases\n${list(tcs.slice(0, 30).map((c) => `${c.title}${c.status && c.status !== 'Not run' ? ` (${c.status})` : ''}`))}\n\n` : ''}${(t.prs || []).length ? `## Pull requests\n${list(t.prs.map((r) => `${r.title || r.url || 'PR'}${r.status ? ` (${r.status})` : ''}${r.url ? ` ${r.url}` : ''}`))}\n\n` : ''}${comments.length ? `## Recent comments\n${list(comments.map((c) => `${c.author || 'Someone'}: ${clip(String(c.text).replace(/\s+/g, ' '), 400)}`))}\n` : ''}`,
    });
  }

  // Releases
  for (const r of releases) {
    const items = top.filter((t) => (t.fixVersions || []).includes(r.id));
    const rEpics = [...new Set(items.map((t) => epicById.get(t.epicId)).filter(Boolean))];
    add({
      type: 'release',
      file: fileOf.get(`r:${r.id}`),
      key: r.name,
      ref: r.id,
      title: `Release ${r.name}`,
      status: r.status || 'unreleased',
      updated: r.releasedAt || r.createdAt,
      body: `# Release ${r.name}

- **Status**: ${r.status || 'unreleased'}${r.startDate ? ` · **Start**: ${String(r.startDate).slice(0, 10)}` : ''}${r.releaseDate ? ` · **Release date**: ${String(r.releaseDate).slice(0, 10)}` : ''}
${r.description ? `\n${r.description}\n` : ''}
## Epics
${flagged(rEpics, (e) => eLink(e))}

## Issues
${flagged(items, (t) => `${tLink(t)} · ${t.status || ''}`)}`,
    });
  }

  // Source documents
  for (const s of sources) {
    const sEpics = (s.epicIds || []).map((x) => epicById.get(x)).filter(Boolean);
    const sIssues = (s.issueIds || []).map((x) => byId.get(x)).filter(Boolean);
    add({
      type: 'source',
      file: fileOf.get(`s:${s.id}`),
      key: '',
      ref: `source:${s.id}`,
      title: s.name || 'Source document',
      status: s.kind || '',
      tags: [s.kind],
      updated: s.addedAt,
      body: `# ${s.name || 'Source document'}

${s.addedBy ? `Added by ${s.addedBy}. ` : ''}${sEpics.length ? `Epics from it: ${sEpics.map(eLink).join(', ')}. ` : ''}${
        sIssues.length
          ? `Issues from it: ${sIssues
              .slice(0, 40)
              .map((t) => tLink(t, false))
              .join(', ')}.`
          : ''
      }

## Text
${clip(s.text, 30000) || '(no text)'}`,
    });
  }

  // Open questions
  for (const x of questions)
    add({
      type: 'question',
      file: x.file,
      key: x.key,
      ref: x.ref,
      title: x.title,
      status: x.status,
      tags: ['open-question'],
      updated: x.updated,
      body: `# ${x.title}

${x.text && x.text !== x.title ? `${x.text}\n\n` : ''}- **Status**: ${x.status || 'Open'}
- **Project**: ${link('p', 'overview', p.name)}\n${x.issues.length ? `\n## Issues it may affect\n${list(x.issues.map((t) => tLink(t)))}` : ''}`,
    });
  return notes;
}

// ---------------------------------------------------------------- links
const LINK_RE = /!?\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g;
/** The [[targets]] written in a note body (as written: file names, titles or paths). */
export const linksIn = (body) => [
  ...new Set([...String(body || '').matchAll(LINK_RE)].map((m) => m[1].trim()).filter(Boolean)),
];
/** Resolves a wikilink target the way Obsidian does: path, file name, then title, alias or key. */
function resolver(notes) {
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
const G = (globalThis.__tfBrain ??= { index: new Map(), inflight: new Map() });
const ROW =
  'id, kind, type, key, ref, title, status, tags, links, meta, body, hash, updated_by as "updatedBy", updated_at as "updatedAt", created_at as "createdAt"';
async function state(projectId) {
  return (
    (
      await q(
        'select version, rev, built_at as "builtAt", data from brain_state where project_id = $1',
        [projectId],
      )
    ).rows[0] || null
  );
}
const noteHash = (n) =>
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
const bump = (t, projectId) =>
  t.query(
    `insert into brain_state (project_id, version, rev) values ($1, 0, 1) on conflict (project_id) do update set rev = brain_state.rev + 1`,
    [projectId],
  );

/**
 * Every note of the project with its resolved links and backlinks, cached per brain revision (one
 * small query to check). { rev, notes, byId, resolve, out: Map id → ids, back: Map id → ids, terms
 * }.
 */
async function loadIndex(projectId) {
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

/**
 * The PROJECT BRAIN block for a prompt ('' when there's nothing to add, the brain is switched off
 * or locked, or the person can't open the project). Never throws: AI work goes on without it. spec:
 * { projectId?, issues?: [ticket], epics?: [epic], issueIds?, epicIds?, query?, max?, exclude? }
 */
export async function brainBlock(spec: any = {}) {
  return (await brainPack(spec)).block;
}
/**
 * brainBlock with the notes it chose: { block, notes: [{ id, title, type, why }] } (for the
 * viewer's preview).
 */
export async function brainPack(spec: any = {}) {
  const none = { block: '', notes: [] };
  try {
    const ctx = currentContext();
    const projectId = String(spec.projectId || ctx.projectId || '');
    if (!projectId || !/^[\w-]{1,64}$/.test(projectId)) return none;
    if (ctx.user && !store.canAccess(ctx.user, projectId)) return none;
    const { isLocked } = await import('./features');
    if (await isLocked('brain')) return none;
    const st = await state(projectId).catch(() => null);
    if (st?.data?.useInAi === false && !spec.preview) return none;
    const issues = (spec.issues || []).filter(Boolean),
      epics = (spec.epics || []).filter(Boolean);
    const query = [
      spec.query,
      ...issues.map(
        (t) =>
          `${t.title || ''} ${t.userStory || ''} ${String(t.description || '').slice(0, 1500)}`,
      ),
      ...epics.map((e) => `${e.title || ''} ${String(e.description || '').slice(0, 800)}`),
    ]
      .filter(Boolean)
      .join('\n');
    const r = await brainContext(projectId, {
      issueIds: [...(spec.issueIds || []), ...issues.map((t) => t.id)],
      epicIds: [...(spec.epicIds || []), ...epics.map((e) => e.id)],
      keys: [...issues, ...epics].map((x) => x.key).filter(Boolean),
      query,
      max: spec.max || 9000,
      exclude: spec.exclude || ['context', 'index'],
    });
    if (!r.text) return none;
    return {
      notes: r.notes,
      block: `PROJECT BRAIN (notes from this project's knowledge vault, linked to this task: related issues, decisions, open questions, documents and the team's own notes. Stay consistent with them; [[Name]] links point to other notes. When the task's own instructions differ, the instructions win):\n\n${r.text}\n\n=== END OF PROJECT BRAIN ===`,
    };
  } catch (e) {
    if (process.env.TICKETFORGE_DEBUG) console.warn('brain context skipped:', e.message);
    return none;
  }
}

/**
 * For code jobs: the context block plus the notes as files for the worktree's .ticketforge/brain/
 * folder.
 */
export async function brainForCode(projectId, ticket, { max = 7000 }: any = {}) {
  try {
    const block = await brainBlock({
      projectId,
      issues: [ticket],
      exclude: ['context', 'index', 'repo'],
      max,
    });
    if (!block) return { block: '', files: {} };
    const idx = await loadIndex(projectId);
    const r = await brainContext(projectId, {
      issueIds: [ticket.id],
      keys: [ticket.key].filter(Boolean),
      query: ticket.title,
      max: 400000,
      exclude: ['index'],
    });
    const files: any = {};
    const ids = new Set(
      [
        ...r.notes.map((x) => x.id),
        ...idx.notes.filter((n) => ['project', 'context'].includes(n.type)).map((n) => n.id),
      ].slice(0, 80),
    );
    for (const id of ids) {
      const n = idx.byId.get(id);
      if (n) files[`${n.id}.md`] = toMarkdown(n);
    }
    files['README.md'] =
      `# Project brain (from TicketForge)\n\nNotes about this project linked to ${ticket.key || 'the issue'}: the issue itself, its epic, related issues, decisions, open questions, documents and the team's notes. Read the ones that matter for the task. Links like [[PRJ-12]] point to the file with that name in this folder.\n\nThis folder is for reading only: it isn't part of the change and isn't committed.\n\n${[...ids].map((id) => `- [[${base(id)}]] ${idx.byId.get(id)?.title || ''}`).join('\n')}\n`;
    return { block, files };
  } catch {
    return { block: '', files: {} };
  }
}

// ---------------------------------------------------------------- Obsidian: Markdown files, zip
// export and import
const yamlStr = (s) => JSON.stringify(String(s ?? ''));
/** A note as an Obsidian Markdown file: YAML frontmatter, then the body. */
export function toMarkdown(n) {
  const fm = [`title: ${yamlStr(n.title)}`, `type: ${n.type}`];
  if (n.key) fm.push(`key: ${yamlStr(n.key)}`);
  if (n.status) fm.push(`status: ${yamlStr(n.status)}`);
  fm.push(`tags: [${(n.tags || []).map(yamlStr).join(', ')}]`);
  if (n.updatedAt) fm.push(`updated: ${new Date(n.updatedAt).toISOString()}`);
  for (const [k, v] of Object.entries<any>(n.meta || {}))
    if (
      !['title', 'type', 'key', 'status', 'tags', 'updated', 'origin'].includes(k) &&
      /^[\w-]{1,40}$/.test(k)
    )
      fm.push(`${k}: ${JSON.stringify(v)}`);
  fm.push(`origin: ${n.kind === 'user' ? 'user' : 'ticketforge'}`);
  return `---\n${fm.join('\n')}\n---\n${String(n.body || '').replace(/^\n+/, '')}${String(n.body || '').endsWith('\n') ? '' : '\n'}`;
}
/** Splits YAML frontmatter (the simple subset Obsidian writes) from the body. */
export function parseMarkdown(text) {
  const s = String(text || '')
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n');
  const m = s.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fm: {}, body: s };
  const fm: any = {};
  let listKey = null;
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      fm[listKey].push(unquote(item[1]));
      continue;
    }
    const kv = line.match(/^([\w-]{1,40}):\s*(.*)$/);
    if (!kv) continue;
    listKey = null;
    const [, k, raw] = kv;
    if (!raw.trim()) {
      fm[k] = [];
      listKey = k;
      continue;
    }
    if (/^\[.*\]$/.test(raw.trim())) {
      try {
        fm[k] = JSON.parse(raw);
      } catch {
        fm[k] = raw
          .trim()
          .slice(1, -1)
          .split(',')
          .map((x) => unquote(x.trim()))
          .filter(Boolean);
      }
      continue;
    }
    fm[k] = unquote(raw.trim());
  }
  return { fm, body: s.slice(m[0].length) };
}
const unquote = (v) => {
  const t = String(v).trim();
  if (/^".*"$/.test(t)) {
    try {
      return JSON.parse(t);
    } catch {
      return t.slice(1, -1);
    }
  }
  return t.replace(/^'(.*)'$/, '$1');
};

/**
 * The whole brain as an Obsidian vault (zip): folders, frontmatter, wikilinks and the Index note.
 */
export async function exportZip(projectId, projectName) {
  const idx = await loadIndex(projectId);
  const root = `${safeName(projectName || 'Project')} brain`;
  const files: any = {};
  for (const n of idx.notes) files[`${root}/${n.id}.md`] = strToU8(toMarkdown(n));
  files[`${root}/.obsidian/app.json`] = strToU8(
    JSON.stringify(
      { alwaysUpdateLinks: true, newFileFolderPath: 'Notes', newFileLocation: 'folder' },
      null,
      2,
    ),
  );
  return { name: `${root}.zip`, data: Buffer.from(zipSync(files, { level: 6 })) };
}

/**
 * Imports Markdown notes (from an Obsidian vault zip or .md files) as the team's own notes. Notes
 * TicketForge wrote (origin: ticketforge) are skipped: they come back on the next refresh. A note
 * at a path TicketForge uses is put under Imported/. files: [{ path, data: Buffer | string }].
 * Returns { added, updated, skipped }.
 */
export async function importNotes(projectId, files, user) {
  let entries: any[] = [];
  for (const f of files) {
    const name = String(f.path || '');
    if (/\.zip$/i.test(name)) {
      let un;
      try {
        un = unzipSync(new Uint8Array(f.data), {
          filter: (x) => /\.md$/i.test(x.name) && x.originalSize < 512 * 1024,
        });
      } catch {
        throw new HttpError(400, `${name} isn’t a zip file that can be read.`);
      }
      const paths = Object.keys(un);
      // A vault zipped as one folder: drop that folder from the paths.
      const top =
        paths.length &&
        paths.every((x) => x.includes('/') && x.split('/')[0] === paths[0].split('/')[0])
          ? `${paths[0].split('/')[0]}/`
          : '';
      for (const x of paths) entries.push({ path: x.slice(top.length), text: strFromU8(un[x]) });
    } else if (/\.(md|markdown)$/i.test(name))
      entries.push({
        path: name.split(/[\\/]/).pop(),
        text: Buffer.isBuffer(f.data) ? f.data.toString('utf8') : String(f.data),
      });
  }
  entries = entries
    .filter((e) => !e.path.split('/').some((x) => x.startsWith('.')))
    .slice(0, MAX_USER_NOTES);
  if (!entries.length)
    throw new HttpError(
      400,
      'No Markdown notes found. Choose .md files or a zip of an Obsidian vault.',
    );
  const idx = await loadIndex(projectId);
  const autoIds = new Set(
    idx.notes.filter((n) => n.kind === 'auto').map((n) => n.id.toLowerCase()),
  );
  const autoNames = new Set(
    idx.notes.filter((n) => n.kind === 'auto').map((n) => base(n.id).toLowerCase()),
  );
  const rows: any[] = [];
  let skipped = 0;
  const seen: Set<any> = new Set();
  for (const e of entries) {
    const { fm, body } = parseMarkdown(e.text);
    if (String(fm.origin || '').toLowerCase() === 'ticketforge') {
      skipped++;
      continue;
    }
    const parts = e.path
      .replace(/\.(md|markdown)$/i, '')
      .split('/')
      .map(safeName)
      .filter(Boolean);
    let id = parts.length > 1 ? parts.join('/') : `Notes/${parts[0] || 'Untitled'}`;
    if (autoIds.has(id.toLowerCase()) || autoNames.has(base(id).toLowerCase()))
      id = `Imported/${base(id)}`;
    if (seen.has(id.toLowerCase())) {
      skipped++;
      continue;
    }
    seen.add(id.toLowerCase());
    const title = String(fm.title || body.match(/^#\s+(.+)$/m)?.[1] || base(id))
      .trim()
      .slice(0, 200);
    const type =
      NOTE_TYPES.includes(fm.type) && !['index', 'project', 'context', 'repo'].includes(fm.type)
        ? fm.type
        : 'note';
    const tags = tagsOf([
      ...(Array.isArray(fm.tags) ? fm.tags : String(fm.tags || '').split(/[,\s]+/)),
      ...[...body.matchAll(/(?:^|\s)#([\p{L}][\p{L}\p{N}_/-]*)/gu)].map((m) => m[1]),
    ]).slice(0, 20);
    const meta: any = {};
    for (const [k, v] of Object.entries<any>(fm))
      if (!['title', 'type', 'key', 'status', 'tags', 'updated', 'origin'].includes(k)) meta[k] = v;
    const b = clip(body, MAX_BODY);
    const row = {
      id,
      type,
      key: '',
      ref: '',
      title,
      status: String(fm.status || '').slice(0, 60),
      tags,
      links: linksIn(b),
      meta,
      body: b,
    };
    rows.push({ ...row, hash: noteHash(row) });
  }
  const before = new Set(idx.notes.filter((n) => n.kind === 'user').map((n) => n.id));
  if (rows.length) {
    await tx(async (t) => {
      for (let i = 0; i < rows.length; i += 300) {
        await t.query(
          `insert into brain_notes (project_id, id, kind, type, key, ref, title, status, tags, links, meta, body, hash, updated_by, updated_at)
          select $1, x.id, 'user', x.type, '', '', x.title, x.status, x.tags, x.links, x.meta, x.body, x.hash, $3, now()
          from jsonb_to_recordset($2::jsonb) as x(id text, type text, title text, status text, tags jsonb, links jsonb, meta jsonb, body text, hash text)
          on conflict (project_id, id) do update set type = excluded.type, title = excluded.title, status = excluded.status, tags = excluded.tags, links = excluded.links,
            meta = excluded.meta, body = excluded.body, hash = excluded.hash, updated_by = excluded.updated_by, updated_at = now()
          where brain_notes.kind = 'user'`,
          [projectId, JSON.stringify(rows.slice(i, i + 300)), user?.name || null],
        );
      }
      await bump(t, projectId);
    });
  }
  const added = rows.filter((r) => !before.has(r.id)).length;
  return { added, updated: rows.length - added, skipped };
}

// ---------------------------------------------------------------- folder sync (on this computer
// only)
const publicSync = (s) => (s?.dir ? { dir: s.dir, at: s.at || null, last: s.last || null } : null);
const listMd = (dir) => {
  const out: any[] = [];
  const walk = (d, rel) => {
    let items: any[] = [];
    try {
      items = fs.readdirSync(/*turbopackIgnore: true*/ d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      if (it.name.startsWith('.')) continue;
      const p = path.join(/*turbopackIgnore: true*/ d, it.name),
        r = rel ? `${rel}/${it.name}` : it.name;
      if (it.isDirectory()) {
        if (out.length < 5000) walk(p, r);
      } else if (/\.md$/i.test(it.name)) out.push(r);
    }
  };
  walk(dir, '');
  return out;
};
/**
 * Two-way sync with a folder on this computer (e.g. inside an Obsidian vault). Generated notes are
 * written to it (and removed when they're gone). The team's own notes go both ways: a note changed
 * on one side since the last sync is copied to the other (when both changed, the newer one wins), a
 * new file becomes a note, and a note or file deleted on one side since the last sync is deleted on
 * the other. Returns what happened.
 */
export async function syncFolder(projectId, dirIn, user) {
  const dir = path.resolve(String(dirIn || '').trim());
  if (!String(dirIn || '').trim() || !path.isAbsolute(String(dirIn).trim()))
    throw new HttpError(400, 'Choose a folder (its full path).');
  // Never a system folder, and never straight into a top-level or home folder (it would fill it
  // with note folders).
  const top = new Set(
    [
      '/',
      '/private',
      '/var',
      '/tmp',
      '/Library',
      '/Users',
      '/home',
      '/Volumes',
      path.resolve(os.homedir()),
    ].map((x) => x.toLowerCase()),
  );
  if (
    top.has(dir.toLowerCase()) ||
    /^\/(bin|sbin|etc|usr|System|dev|proc|boot|private\/etc)(\/|$)/i.test(dir) ||
    /^[A-Z]:\\(Windows|Program Files[^\\]*)?(\\|$)/i.test(dir)
  ) {
    throw new HttpError(
      400,
      'Choose a folder of your own, such as one inside your Obsidian vault.',
    );
  }
  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  const st = await state(projectId);
  const prev = st?.data?.sync?.dir === dir ? st.data.sync.files || {} : {}; // relpath → hash at the last sync
  const idx = await loadIndex(projectId);
  const files = new Set(listMd(dir));
  const now: any = {};
  const res = {
    wroteAuto: 0,
    removedAuto: 0,
    toFolder: 0,
    fromFolder: 0,
    newNotes: 0,
    deletedNotes: 0,
    deletedFiles: 0,
    conflicts: [],
  };
  const write = (rel, text) => {
    const p = path.join(/*turbopackIgnore: true*/ dir, ...rel.split('/'));
    fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(p), { recursive: true });
    fs.writeFileSync(/*turbopackIgnore: true*/ p, text);
  };
  const read = (rel) =>
    fs.readFileSync(/*turbopackIgnore: true*/ path.join(dir, ...rel.split('/')), 'utf8');
  const mtime = (rel) =>
    fs.statSync(/*turbopackIgnore: true*/ path.join(dir, ...rel.split('/'))).mtime;
  const remove = (rel) => {
    try {
      fs.unlinkSync(/*turbopackIgnore: true*/ path.join(dir, ...rel.split('/')));
    } catch {
      /* gone */
    }
  };
  const imports = [],
    deletes = [];
  for (const n of idx.notes) {
    const rel = `${n.id}.md`;
    const text = toMarkdown(n),
      h = sha(text);
    if (n.kind === 'auto') {
      if (!files.has(rel) || sha(read(rel)) !== h) {
        write(rel, text);
        res.wroteAuto++;
      }
      now[rel] = h;
      files.delete(rel);
      continue;
    }
    if (!files.has(rel)) {
      if (prev[rel] && prev[rel] === h) {
        deletes.push(n.id);
        res.deletedNotes++;
      } // deleted in the folder, unchanged here
      else {
        write(rel, text);
        now[rel] = h;
        res.toFolder++;
      }
      continue;
    }
    const ft = read(rel),
      fh = sha(ft);
    files.delete(rel);
    if (fh === h) {
      now[rel] = h;
      continue;
    }
    const dbChanged = prev[rel] !== h,
      fileChanged = prev[rel] !== fh;
    if (dbChanged && fileChanged) res.conflicts.push(n.id);
    // Only one side changed: it wins. Both (or never synced): the newer one wins.
    if (fileChanged && (!dbChanged || mtime(rel) > new Date(n.updatedAt))) {
      imports.push({ path: rel, data: ft });
      res.fromFolder++;
    } else {
      write(rel, text);
      now[rel] = h;
      res.toFolder++;
    }
  }
  for (const rel of files) {
    // files with no note
    const ft = read(rel);
    const { fm } = parseMarkdown(ft);
    if (String(fm.origin || '').toLowerCase() === 'ticketforge') {
      remove(rel);
      res.removedAuto++;
      continue;
    } // a generated note that's gone
    if (prev[rel] && prev[rel] === sha(ft)) {
      remove(rel);
      res.deletedFiles++;
      continue;
    } // its note was deleted here
    imports.push({ path: rel, data: ft });
    res.newNotes++;
  }
  if (deletes.length)
    await tx(async (t) => {
      await t.query(
        "delete from brain_notes where project_id = $1 and kind = 'user' and id = any($2)",
        [projectId, deletes],
      );
      await bump(t, projectId);
    });
  if (imports.length) await importRaw(projectId, imports, user);
  // Imported files are rewritten as the note now reads (its frontmatter, updated time), and every
  // file's hash is kept, so the next sync knows which side changed.
  const after = await loadIndex(projectId);
  const imported = new Set(imports.map((f) => f.path));
  for (const n of after.notes) {
    if (n.kind !== 'user') continue;
    const rel = `${n.id}.md`;
    if (imported.has(rel)) {
      const text = toMarkdown(n);
      write(rel, text);
      now[rel] = sha(text);
    } else if (
      !now[rel] &&
      fs.existsSync(/*turbopackIgnore: true*/ path.join(dir, ...rel.split('/')))
    )
      now[rel] = sha(read(rel));
  }
  const data = {
    ...(st?.data || {}),
    sync: {
      dir,
      at: new Date().toISOString(),
      files: now,
      last: { ...res, conflicts: res.conflicts.length },
    },
  };
  await q(
    `insert into brain_state (project_id, version, rev, data) values ($1, 0, 1, $2) on conflict (project_id) do update set data = $2, rev = brain_state.rev + 1`,
    [projectId, JSON.stringify(data)],
  );
  return { dir, ...res };
}
/** Folder files keep their exact paths (sync), unlike imports from elsewhere. */
async function importRaw(projectId, files, user) {
  const rows = files.map((f) => {
    const { fm, body } = parseMarkdown(f.data);
    const id = f.path.replace(/\.md$/i, '').split('/').map(safeName).join('/');
    const title = String(fm.title || body.match(/^#\s+(.+)$/m)?.[1] || base(id))
      .trim()
      .slice(0, 200);
    const meta: any = {};
    for (const [k, v] of Object.entries<any>(fm))
      if (!['title', 'type', 'key', 'status', 'tags', 'updated', 'origin'].includes(k)) meta[k] = v;
    const b = clip(body, MAX_BODY);
    const row = {
      id,
      type:
        NOTE_TYPES.includes(fm.type) && !['index', 'project', 'context', 'repo'].includes(fm.type)
          ? fm.type
          : 'note',
      key: '',
      ref: '',
      title,
      status: String(fm.status || '').slice(0, 60),
      tags: tagsOf(Array.isArray(fm.tags) ? fm.tags : []),
      links: linksIn(b),
      meta,
      body: b,
    };
    return { ...row, hash: noteHash(row) };
  });
  await tx(async (t) => {
    await t.query(
      `insert into brain_notes (project_id, id, kind, type, key, ref, title, status, tags, links, meta, body, hash, updated_by, updated_at)
      select $1, x.id, 'user', x.type, '', '', x.title, x.status, x.tags, x.links, x.meta, x.body, x.hash, $3, now()
      from jsonb_to_recordset($2::jsonb) as x(id text, type text, title text, status text, tags jsonb, links jsonb, meta jsonb, body text, hash text)
      on conflict (project_id, id) do update set type = excluded.type, title = excluded.title, status = excluded.status, tags = excluded.tags, links = excluded.links,
        meta = excluded.meta, body = excluded.body, hash = excluded.hash, updated_by = excluded.updated_by, updated_at = now()
      where brain_notes.kind = 'user'`,
      [projectId, JSON.stringify(rows), user?.name || null],
    );
    await bump(t, projectId);
  });
}
export async function setSyncFolder(projectId, dir) {
  const data = { ...((await state(projectId))?.data || {}) };
  if (dir) data.sync = { ...(data.sync?.dir === dir ? data.sync : {}), dir };
  else delete data.sync;
  await q(
    `insert into brain_state (project_id, version, rev, data) values ($1, 0, 0, $2) on conflict (project_id) do update set data = $2`,
    [projectId, JSON.stringify(data)],
  );
  return publicSync(data.sync);
}
