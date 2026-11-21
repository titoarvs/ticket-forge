import { api, authed, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { liveIssues, liveProjects } from '@/lib/github-live';

// Project → Code & GitHub → Issues and Projects (TF-140): ?section=issues lists the linked
// repository's issues and ?section=projects its GitHub Projects, both read live from the GitHub
// API on every call. Needs the Code & GitHub permission (project.repo, checked in
// lib/github-live.ts). { connected: false } when the workspace has no GitHub connection.
export const GET = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  const section = new URL(req.url).searchParams.get('section');
  if (section === 'issues') return liveIssues(user, p.id);
  if (section === 'projects') return liveProjects(user, p.id);
  throw new HttpError(400, 'Send section=issues or section=projects.');
});
