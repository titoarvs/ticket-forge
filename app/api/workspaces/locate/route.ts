import { api, authed } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import * as auth from '@/lib/auth.js';

// A project link from another of your workspaces: which one it's in, so the app can offer to switch there.
// Answers only for workspaces you belong to; otherwise { workspace: null }, the same as for a project that doesn't exist.
export const GET = api(async (req) => {
  const u: any = await authed();
  const id = String(new URL(req.url).searchParams.get('project') || '');
  const w = /^[\w-]{1,64}$/.test(id) ? await store.projectWorkspace(id) : null;
  if (!w || w === u.workspace_id) return { workspace: null };
  const mine = (await auth.listMyWorkspaces(u.id)).find((x: any) => x.id === w);
  return { workspace: mine ? { id: mine.id, name: mine.name } : null };
});
