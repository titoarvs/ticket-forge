// Local config folders (TF-102): one folder per person and per GitHub repository on this machine, holding the
// repository clone (clone/) and that person's settings (settings/ai.json, browser.json, email.json, templates.json).
// Folders are never removed when a person is removed, GitHub is disconnected or a repository is deleted: only an
// administrator's purge deletes one.
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, currentWs, DEFAULT_WS } from './db';
import { HttpError } from './auth';

export const SETTING_KINDS = ['ai', 'browser', 'email', 'templates'];
const ROOT = path.join(DATA_DIR, 'folders');
const SAFE = /^[\w-]{1,80}$/;
const REPO = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

const wsOf = (user) => String(user?.workspace_id || currentWs() || DEFAULT_WS);
const slugOf = (repo) => {
  const r = String(repo || '').trim().replace(/\.git$/, '');
  if (!REPO.test(r) || r.includes('..')) throw new HttpError(400, 'Name the repository as owner/name.');
  return r.replace('/', '__');
};
/** Keeps every path inside the folders root. */
function inside(...parts) {
  for (const p of parts) if (!SAFE.test(p) && !/^[\w.-]{1,100}__[\w.-]{1,100}$/.test(p)) throw new HttpError(400, 'Bad folder.');
  const full = path.resolve(ROOT, ...parts);
  if (!full.startsWith(path.resolve(ROOT) + path.sep)) throw new HttpError(400, 'Bad folder.');
  return full;
}
const folderDir = (ws, userId, slug) => inside(ws, userId, slug);

/** Creates (or returns) the signed-in person's folder for a repository. */
export async function ensureFolder(user, repo) {
  if (!user?.id) throw new HttpError(401, 'Sign in to continue.');
  const ws = wsOf(user), slug = slugOf(repo);
  const dir = folderDir(ws, user.id, slug);
  await fs.mkdir(path.join(dir, 'clone'), { recursive: true });
  await fs.mkdir(path.join(dir, 'settings'), { recursive: true });
  const metaFile = path.join(dir, 'folder.json');
  let meta;
  try { meta = JSON.parse(await fs.readFile(metaFile, 'utf8')); } catch {
    meta = { userId: user.id, userName: user.name || '', email: user.email || '', workspaceId: ws, repo: String(repo).trim(), createdAt: new Date().toISOString() };
    await fs.writeFile(metaFile, JSON.stringify(meta, null, 2), { mode: 0o600 });
  }
  return { id: `${user.id}/${slug}`, ...meta, path: dir, clonePath: path.join(dir, 'clone') };
}

async function readDirs(dir) { try { return (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } }
async function describe(ws, userId, slug) {
  const dir = folderDir(ws, userId, slug);
  let meta: any = {};
  try { meta = JSON.parse(await fs.readFile(path.join(dir, 'folder.json'), 'utf8')); } catch { /* folder without a record */ }
  return { id: `${userId}/${slug}`, userId, userName: meta.userName || '', email: meta.email || '', repo: meta.repo || slug.replace('__', '/'), createdAt: meta.createdAt || null, path: dir };
}

/** The signed-in person's own folders only. */
export async function listMyFolders(user) {
  if (!user?.id) throw new HttpError(401, 'Sign in to continue.');
  const ws = wsOf(user);
  if (!SAFE.test(user.id)) return [];
  return Promise.all((await readDirs(inside(ws, user.id))).map((s) => describe(ws, user.id, s)));
}

/** Every person's folders in the workspace (administrators). */
export async function listAllFolders(user) {
  const ws = wsOf(user);
  const out: any[] = [];
  for (const uid of await readDirs(inside(ws))) {
    if (!SAFE.test(uid)) continue;
    for (const s of await readDirs(inside(ws, uid))) out.push(await describe(ws, uid, s));
  }
  return out.sort((a, b) => `${a.userName}${a.repo}`.localeCompare(`${b.userName}${b.repo}`));
}

/** Deletes one folder for good (administrators only; the route checks the permission). */
export async function purgeFolder(user, id) {
  const [uid, slug] = String(id || '').split('/');
  if (!uid || !slug) throw new HttpError(400, 'Choose a folder to purge.');
  const dir = folderDir(wsOf(user), uid, slug);
  try { await fs.access(dir); } catch { throw new HttpError(404, 'That folder was not found.'); }
  await fs.rm(dir, { recursive: true, force: true });
}

const kindOf = (kind) => { if (!SETTING_KINDS.includes(kind)) throw new HttpError(400, `Settings must be one of: ${SETTING_KINDS.join(', ')}.`); return kind; };
/** Writes settings into the signed-in person's own folder only. */
export async function saveFolderSettings(user, repo, kind, data) {
  const f = await ensureFolder(user, repo);
  const v = { ...(data && typeof data === 'object' ? data : {}), updatedAt: new Date().toISOString() };
  await fs.writeFile(path.join(f.path, 'settings', `${kindOf(kind)}.json`), JSON.stringify(v, null, 2), { mode: 0o600 });
  return v;
}
/** The signed-in person's settings of that kind, or null. */
export async function readFolderSettings(user, repo, kind) {
  if (!user?.id) throw new HttpError(401, 'Sign in to continue.');
  const dir = folderDir(wsOf(user), user.id, slugOf(repo));
  try { return JSON.parse(await fs.readFile(path.join(dir, 'settings', `${kindOf(kind)}.json`), 'utf8')); } catch { return null; }
}
