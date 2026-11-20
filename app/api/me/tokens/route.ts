import { api, authed, body } from '@/lib/server/http';
import * as auth from '@/lib/auth';

// Your own API tokens, for programs that act as you through the MCP server (/api/mcp). The token is
// in the answer of the POST only, once; it carries your role and project access as they are at each
// call.
export const GET = api(async () => {
  const user = await authed();
  return { tokens: await auth.listApiTokens(user) };
});

export const POST = api(async (req) => {
  const user = await authed();
  const b = await body(req);
  return auth.createApiToken(user, { name: b.name, expiresInDays: b.expiresInDays });
});
