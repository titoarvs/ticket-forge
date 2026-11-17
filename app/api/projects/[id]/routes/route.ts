import { api, authed, perm, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { currentContext, SERVERLESS } from '@/lib/db';
import { scanCodebase } from '@/lib/routes';
import { localReader, githubReader } from '@/lib/codebase';
import { setProjectSecret, getProjectSecret, hasProjectSecret } from '@/lib/secrets';

// Page routes from the web app's source code (Test automation → App setup → Source code).

export const GET = api(async (_req, p) => {
  store.requireAccess(await authed(), p.id);
  return { hasToken: await hasProjectSecret(p.id, 'githubToken'), canReadFolders: !SERVERLESS && Boolean((currentContext() as any).local) };
});

// { action: 'scan', kind: 'github' | 'folder', location, branch } · { action: 'saveToken', token } · { action: 'clearToken' }
export const POST = api(async (req, p) => {
  const user = await perm('project.settings');
  store.requireAccess(user, p.id);
  const b = await body(req);
  if (b.action === 'saveToken' || b.action === 'clearToken') {
    const token = b.action === 'saveToken' ? String(b.token || '').trim() : '';
    if (token.length > 400) throw new HttpError(400, 'That token is too long.');
    await setProjectSecret(p.id, 'githubToken', token, user);
    return { hasToken: Boolean(token) };
  }
  const location = String(b.location || '').trim();
  if (!location) throw new HttpError(400, b.kind === 'folder' ? 'Enter the folder path.' : 'Enter the repository.');
  let reader;
  if (b.kind === 'folder') {
    // Reading folders is only for the computer TicketForge runs on, opened there (localhost).
    if (SERVERLESS || !(currentContext() as any).local) throw new HttpError(400, 'Folders can only be scanned when TicketForge runs on your own computer and is opened at localhost. Use a GitHub repository instead.');
    reader = localReader(location);
  } else {
    reader = await githubReader(location, { branch: String(b.branch || '').trim(), token: await getProjectSecret(p.id, 'githubToken') });
  }
  const files = await reader.list();
  const res = await scanCodebase(files, reader.read);
  return { ...res, label: reader.label, files: files.length, truncated: Boolean((reader as any).truncated), at: new Date().toISOString() };
});
