import { api, authed, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { linkRepo, syncIssues } from '@/lib/github-sync';

export const maxDuration = 300;

// Project settings → Code & GitHub → GitHub issues (TF-130): links a GitHub repository, and imports
// or syncs its issues as tickets. Only the project owner and the Super Admin can (checked in
// lib/github-sync.ts). Everyone with access sees the link in the project's `githubSync` section.

export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  const b = await body(req);
  if (b.action === 'link') return linkRepo(user, p.id, b.repo);
  if (b.action === 'import') return syncIssues(user, p.id, 'import');
  if (b.action === 'sync') return syncIssues(user, p.id, 'sync');
  throw new HttpError(400, 'Send an action: link, import or sync.');
});
