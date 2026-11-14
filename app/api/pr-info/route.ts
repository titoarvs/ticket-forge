import { api, perm, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { prInfo } from '@/lib/github.js';
import { getProjectSecret } from '@/lib/secrets.js';

// Looks up a pull/merge request for the Development panel. With ?projectId, the project's GitLab token reads private merge requests.
export const GET = api(async (req) => {
  const user = await perm('issue.edit');
  const sp = new URL(req.url).searchParams;
  const projectId = sp.get('projectId');
  let gitlabToken = '';
  if (projectId) { await store.requireProject(user, projectId); gitlabToken = await getProjectSecret(projectId, 'gitlabToken'); }
  try { return await prInfo(sp.get('url'), { gitlabToken }); } catch (e: any) { throw new HttpError(400, e.message); }
});
