import { api, authed, body } from '@/lib/server/http';
import { readFolderSettings, saveFolderSettings } from '@/lib/userfolders';

// Your AI, browser, email and template settings for one repository, kept in your own folder.
export const GET = api(async (req) => {
  const user = await authed();
  const u = new URL(req.url);
  return { data: await readFolderSettings(user, u.searchParams.get('repo'), u.searchParams.get('kind')) };
});

export const PUT = api(async (req) => {
  const user = await authed();
  const b = await body(req);
  return { data: await saveFolderSettings(user, b.repo, b.kind, b.data) };
});
