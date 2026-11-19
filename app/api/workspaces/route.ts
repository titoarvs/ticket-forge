import { api, authed, body, HttpError, startSession } from '@/lib/server/http';
import * as auth from '@/lib/auth';
import { isSaas } from '@/lib/platform';

// The workspaces you belong to, and creating a new one (you own it, then switch to it).
export const GET = api(async () => {
  const u: any = await authed();
  return { current: u.workspace_id, workspaces: await auth.listMyWorkspaces(u.id) };
});
export const POST = api(async (req) => {
  const u: any = await authed();
  // Self-hosted, one company runs TicketForge for itself: only its owners may add workspaces. On
  // the hosted service, anyone signed in can start a workspace for another company or team.
  if (!isSaas() && !u.is_owner)
    throw new HttpError(403, 'Only an owner can create workspaces on this TicketForge.');
  const b = await body(req);
  const ws = await auth.createWorkspace(u, { name: b.name });
  await startSession(u.id, ws.id); // a fresh sign-in for the new workspace (the old one simply expires)
  return { workspace: ws };
});
