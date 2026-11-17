import { api, perm, HttpError } from '@/lib/server/http';
import { listAllFolders, purgeFolder } from '@/lib/userfolders';

// Every person's local repository folders, for administrators. Folders stay until purged here.
export const GET = api(async () => listAllFolders(await perm('users.manage')));

export const DELETE = api(async (req) => {
  const user = await perm('users.manage');
  const id = new URL(req.url).searchParams.get('id');
  if (!id) throw new HttpError(400, 'Choose a folder to purge.');
  await purgeFolder(user, id);
  return { ok: true };
});
