import { api, authed, body } from '@/lib/server/http';
import { listMyFolders, ensureFolder } from '@/lib/userfolders.js';

// Your own local folders (one per repository). Nobody else's folders are ever returned here.
export const GET = api(async () => listMyFolders(await authed()));

/** Prepares local storage for a repository you connected: { repo: 'owner/name' }. */
export const POST = api(async (req) => {
  const user = await authed();
  const b = await body(req);
  return ensureFolder(user, b.repo);
});
