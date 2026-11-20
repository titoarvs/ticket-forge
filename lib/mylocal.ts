// Each person's own local copy of a project's repositories. The project shares which repository it
// is (name, base branch, branch prefix…) but the folder on disk is the person's own: a teammate's
// path doesn't exist on your computer.
// Stored per person (user_prefs), so everyone can set theirs up without changing the project.
import fs from 'node:fs';
import { currentContext, SERVERLESS } from './db';
import { getPrefs } from './prefs';

const exists = (p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** This person's own setup for a project: { frontend?: { path, source }, backend?: {…} }. */
export async function myLocal(projectId: string, userId = currentContext().user?.id) {
  if (!userId) return {} as any;
  return ((await getPrefs(userId)).local?.[projectId] || {}) as any;
}

/**
 * The project as this person's computer sees it: dev.localPath / devBackend.localPath are their own
 * folder; when they haven't set one, the project's shared path counts only if it exists on this
 * computer (so the person who set the project up keeps working, and nobody is pointed at someone
 * else's folder).
 */
export async function withMyLocal(project: any, userId = currentContext().user?.id) {
  if (SERVERLESS || !userId || !project) return project;
  const mine: any = await myLocal(project.id, userId);
  const pick = (side: 'frontend' | 'backend', dev: any) => {
    if (!dev) return dev;
    const own = mine[side];
    if (own?.path)
      return { ...dev, localPath: own.path, ...(own.source ? { source: own.source } : {}) };
    return dev.localPath && !exists(dev.localPath) ? { ...dev, localPath: '' } : dev;
  };
  const out = { ...project };
  if (project.dev) out.dev = pick('frontend', project.dev);
  if (project.devBackend) out.devBackend = pick('backend', project.devBackend);
  return out;
}
/** Whether the project's shared path exists on this computer (for the settings page). */
export const sharedUsable = (dev: any) => Boolean(dev?.localPath && exists(dev.localPath));
