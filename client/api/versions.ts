// API client for issue versions: the only place the Versions tab's requests are built.
import { api, type Any } from '../core';

const base = (pid: string, issueId: string) => `/api/projects/${encodeURIComponent(pid)}/issues/${encodeURIComponent(issueId)}/versions`;

/** The saved versions of an issue (newest first) and whether the person may restore one. */
export const listVersions = (pid: Any, issueId: string): Promise<Any> => api(base(pid, issueId));
/** Sets the issue back to a version; the server saves the restore as a new version. */
export const restoreVersion = (pid: Any, issueId: string, number: number): Promise<Any> =>
  api(`${base(pid, issueId)}/${number}/restore`, { method: 'POST' });
