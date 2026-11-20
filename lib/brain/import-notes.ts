import { strToU8, zipSync, unzipSync, strFromU8 } from 'fflate';
import { currentContext, tx } from '../db';
import * as store from '../store';
import { HttpError } from '../auth';
import { state, linksIn, noteHash } from './refresh-brain';
import { brainContext, loadIndex, bump } from './brain-context';
import { base, safeName, MAX_USER_NOTES, NOTE_TYPES, tagsOf, clip, MAX_BODY } from './safe-name';

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
    const { isLocked } = await import('../features');
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
export const publicSync = (s) =>
  s?.dir ? { dir: s.dir, at: s.at || null, last: s.last || null } : null;
