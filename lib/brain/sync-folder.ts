import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tx, q } from '../db';
import { HttpError } from '../auth';
import { state, linksIn, noteHash } from './refresh-brain';
import { loadIndex, bump } from './brain-context';
import { toMarkdown, parseMarkdown, publicSync } from './import-notes';
import { sha, safeName, base, clip, MAX_BODY, NOTE_TYPES, tagsOf } from './safe-name';

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
