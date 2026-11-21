import { api, perm } from '@/lib/server/http';
import { connectionStatus } from '@/lib/github-live';

// Administration → GitHub (TF-140): whether the workspace has a GitHub connection. Never the token.
export const GET = api(async () => {
  const u = await perm('users.manage');
  return connectionStatus(u);
});
