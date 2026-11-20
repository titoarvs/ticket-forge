import fs from 'node:fs/promises';
import path from 'node:path';
import { api, authed, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { SERVERLESS, currentContext } from '@/lib/db';
import { whoAmI } from '@/lib/github-connect';

// Project settings → Code & GitHub → Repository setup (TF-110): checks a local repository path or a
// GitHub token for one project. Nothing is saved here: the client saves the checked values on the
// project.
export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  if (!store.has(user, 'project.repo'))
    throw new HttpError(
      403,
      'Setting up the repository needs the Set up the repository permission.',
    );
  const b = await body(req);
  if (typeof b.localPath === 'string') {
    if (SERVERLESS || !(currentContext() as any).local)
      throw new HttpError(
        400,
        'Linking a local repository works only when TicketForge runs on your computer (opened at localhost).',
      );
    const dir = b.localPath.trim();
    if (!dir || !path.isAbsolute(dir))
      throw new HttpError(
        400,
        'That path is invalid: enter the full path of the repository folder.',
      );
    const isDir = await fs.stat(dir).then(
      (s) => s.isDirectory(),
      () => false,
    );
    if (!isDir) throw new HttpError(400, `That path is invalid: ${dir} does not exist.`);
    const git = await fs.stat(path.join(dir, '.git')).then(
      () => true,
      () => false,
    );
    if (!git)
      throw new HttpError(
        400,
        `That path is invalid: ${dir} is not a git repository (no .git folder).`,
      );
    return { localPath: path.resolve(dir) };
  }
  if (typeof b.githubToken === 'string') {
    const token = b.githubToken.trim();
    if (!token) throw new HttpError(400, 'Enter a GitHub token.');
    const account = await whoAmI(token).catch((e: any) => {
      throw new HttpError(400, `Couldn’t connect GitHub: ${e.message}`);
    });
    return { account };
  }
  throw new HttpError(400, 'Send a localPath or a githubToken.');
});
