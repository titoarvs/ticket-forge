import { api, authed, body } from '@/lib/server/http';
import { createProjectIssue } from '@/lib/issue-create';

// Create an issue in a project the person can access (TF-132).
export const POST = api(async (req, p) => {
  const user = await authed();
  const b = await body(req);
  return createProjectIssue(user, p.id, b);
});
