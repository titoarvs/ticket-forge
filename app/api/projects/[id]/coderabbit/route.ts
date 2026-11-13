import { api, authed, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { getProjectSecret } from '@/lib/secrets.js';
import { codeRabbitPrFindings } from '@/lib/coderabbit-pr.js';

// CodeRabbit's review comments on a pull/merge request linked to an issue, as findings. The browser merges them into
// the issue's saved code reviews (keeping each finding's status), so they show in the issue and in Reports.
export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  const b = await body(req);
  const project = await store.getProject(p.id);
  const ticket = project.tickets.find((t: any) => t.id === b.ticketId);
  const pr = ticket?.prs?.find((x: any) => x.id === b.prId);
  if (!pr) throw new HttpError(404, 'That pull request isn’t linked to this issue any more.');
  const [githubToken, gitlabToken] = await Promise.all([getProjectSecret(p.id, 'githubToken'), getProjectSecret(p.id, 'gitlabToken')]);
  const r = await codeRabbitPrFindings(pr.url, { githubToken: githubToken || '', gitlabToken: gitlabToken || '' });
  return { ...r, readAt: new Date().toISOString() };
});
